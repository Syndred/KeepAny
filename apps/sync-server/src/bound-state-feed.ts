import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, SignJWT } from 'jose';
import type { VerifiedBoundState } from './bound-state-record';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{64}$/;
const B64 = /^[A-Za-z0-9_-]+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CLAIMS = 'aud,binding_id,epoch,exp,iat,instance_id_hash,iss,jkt,jti,scopes,state_expires_at,state_observed_at,status,sub,token_valid_after';
const MAX_RESPONSE_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 4000;
const BOOTSTRAP_WINDOW_MS = 1000;
const MAX_BOOTSTRAPS_PER_WINDOW = 8;
/** Pilot capacity. One slot per admitted binding prevents slow peers from stealing renewal capacity. */
export const BOUND_STATE_FEED_CAPACITY = 32;
const RENEW_BEFORE_EXPIRY_MS = REQUEST_TIMEOUT_MS + 1000;

type KnownBinding = { deadlineMs: number | null; nextAttemptMs: number; failures: number };
type FeedFailure = 'capacity' | 'discovery' | 'refresh';

export interface BoundStateFeedStore {
  hasState(bindingId: string): Promise<boolean>;
  listKnownNonRevokedIds(): Promise<string[]>;
  upsertVerifiedState(state: VerifiedBoundState): Promise<'applied' | 'ignored'>;
}

export interface BoundStateFeedConfig {
  readerIssuer: string;
  readerPrivatePem: string;
  readerKid: string;
  commercialOrigin: string;
  commercialIssuer: string;
  commercialJwks: unknown;
  store: BoundStateFeedStore;
  /** A transport hook for isolated HTTP tests; production uses global fetch. */
  fetchFn?: typeof fetch;
  /** Must stay at or below five seconds. */
  intervalMs?: number;
  /** Receives only a category, never binding IDs, tokens, or error contents. */
  onError?: (reason: FeedFailure) => void;
}

function fixedOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== value || (url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw Error('bound-state-feed-origin-configuration');
  }
  return url.origin;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rsaBits(encoded: string): number {
  const bytes = Buffer.from(encoded, 'base64url');
  const first = bytes.findIndex(byte => byte !== 0);
  return first < 0 ? 0 : (bytes.length - first - 1) * 8 + Math.floor(Math.log2(bytes[first])) + 1;
}

function publicKeys(value: unknown) {
  const set = record(value);
  if (!set || Object.keys(set).join(',') !== 'keys' || !Array.isArray(set.keys) ||
    set.keys.length < 1 || set.keys.length > 8) throw Error('bound-state-feed-jwks-configuration');
  const kids = new Set<string>();
  const moduli = new Set<string>();
  const keys = set.keys.map(item => {
    const key = record(item);
    if (key?.kty !== 'RSA' || key.alg !== 'RS256' || key.use !== 'sig' ||
      typeof key.kid !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(key.kid) || kids.has(key.kid) ||
      typeof key.n !== 'string' || !B64.test(key.n) ||
      Buffer.from(key.n, 'base64url').toString('base64url') !== key.n || rsaBits(key.n) < 2048 ||
      key.e !== 'AQAB' || Object.keys(key).some(name => !['kty', 'n', 'e', 'kid', 'alg', 'use'].includes(name))) {
      throw Error('bound-state-feed-jwks-configuration');
    }
    kids.add(key.kid);
    moduli.add(key.n);
    return { kty: 'RSA' as const, n: key.n, e: key.e, kid: key.kid, alg: 'RS256' as const, use: 'sig' as const };
  });
  return { verifier: createLocalJWKSet({ keys }), moduli };
}

function privateKey(pem: string) {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw Error('bound-state-feed-reader-key-configuration');
  }
  return key;
}

function signedDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !ISO.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? date : null;
}

function validScopes(value: unknown): value is Array<'sync:read' | 'sync:write'> {
  return Array.isArray(value) && value.length >= 1 && value.length <= 2 &&
    value.includes('sync:read') && new Set(value).size === value.length &&
    value.every(scope => scope === 'sync:read' || scope === 'sync:write');
}

async function readLimited(response: Response): Promise<unknown> {
  const size = Number(response.headers.get('content-length'));
  if (Number.isFinite(size) && size > MAX_RESPONSE_BYTES) throw Error('bound-state-feed-response-too-large');
  if (!response.body) throw Error('bound-state-feed-empty-response');
  const reader = response.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw Error('bound-state-feed-response-too-large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** Reads one signed commercial observation. The database is the only durable state authority. */
export function createBoundStateFeed(config: BoundStateFeedConfig) {
  const readerIssuer = fixedOrigin(config.readerIssuer);
  const commercialOrigin = fixedOrigin(config.commercialOrigin);
  const commercialIssuer = fixedOrigin(config.commercialIssuer);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(config.readerKid)) throw Error('bound-state-feed-reader-kid-configuration');
  const intervalMs = config.intervalMs ?? 5000;
  if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 5000) throw Error('bound-state-feed-interval-configuration');
  const keys = publicKeys(config.commercialJwks);
  const key = privateKey(config.readerPrivatePem);
  const readerJwk = createPublicKey(key).export({ format: 'jwk' });
  if (readerJwk.kty !== 'RSA' || !readerJwk.n || keys.moduli.has(readerJwk.n)) {
    throw Error('bound-state-feed-reader-key-not-independent');
  }
  const fetchFn = config.fetchFn ?? fetch;
  const known = new Map<string, KnownBinding>();
  const inFlight = new Map<string, Promise<void>>();
  const bootstrapChecks = new Map<string, Promise<void>>();
  const controllers = new Set<AbortController>();
  const bootstrapTimes: number[] = [];
  const reportedAt = new Map<FeedFailure, number>();
  let closed = false;
  let schedulerTimer: ReturnType<typeof setInterval> | undefined;
  let discoveryTimer: ReturnType<typeof setInterval> | undefined;
  let discoveryInFlight: Promise<void> | undefined;
  let starting: Promise<void> | undefined;

  function report(reason: FeedFailure): void {
    const now = Date.now();
    if ((reportedAt.get(reason) ?? 0) > now - 5000) return;
    reportedAt.set(reason, now);
    if (config.onError) {
      try { config.onError(reason); } catch { /* Observability must not change the lease decision. */ }
    } else {
      console.error(`KeepAny bound state feed ${reason} failed`);
    }
  }

  function retryKnown(bindingId: string): void {
    const entry = known.get(bindingId);
    if (!entry) return;
    entry.failures = Math.min(entry.failures + 1, 4);
    entry.nextAttemptMs = Date.now() + Math.min(1000 * (2 ** (entry.failures - 1)), 5000);
  }

  function acceptedState(state: VerifiedBoundState, applied: 'applied' | 'ignored'): void {
    if (state.status === 'revoked') {
      if (applied === 'applied') known.delete(state.bindingId);
      else retryKnown(state.bindingId);
      return;
    }
    if (applied === 'ignored') { retryKnown(state.bindingId); return; }
    const entry = known.get(state.bindingId);
    if (!entry && known.size >= BOUND_STATE_FEED_CAPACITY) {
      report('capacity');
      return;
    }
    known.set(state.bindingId, {
      deadlineMs: state.stateExpiresAt.getTime(),
      nextAttemptMs: Math.max(Date.now() + 250, state.stateExpiresAt.getTime() - RENEW_BEFORE_EXPIRY_MS),
      failures: 0,
    });
  }

  async function verifyAssertion(assertion: string, bindingId: string): Promise<VerifiedBoundState> {
    if (assertion.length < 1 || assertion.length > 8192) throw Error('bound-state-feed-assertion-size');
    const header = decodeProtectedHeader(assertion);
    if (Object.keys(header).sort().join(',') !== 'alg,kid,typ' || header.alg !== 'RS256' ||
      header.typ !== 'keepany-bound-state+jwt' || typeof header.kid !== 'string' || !header.kid) {
      throw Error('bound-state-feed-assertion-header');
    }
    const { payload } = await jwtVerify(assertion, keys.verifier, {
      issuer: commercialIssuer, audience: 'keepany-bound-state-writer', algorithms: ['RS256'],
    });
    const observedAt = signedDate(payload.state_observed_at);
    const signedExpiresAt = signedDate(payload.state_expires_at);
    const now = Date.now();
    if (Object.keys(payload).sort().join(',') !== CLAIMS ||
      payload.iss !== commercialIssuer || payload.aud !== 'keepany-bound-state-writer' ||
      typeof payload.sub !== 'string' || !/^keepanyadm:[^\s]{1,128}$/.test(payload.sub) ||
      payload.binding_id !== bindingId ||
      typeof payload.instance_id_hash !== 'string' || !HEX.test(payload.instance_id_hash) ||
      typeof payload.jkt !== 'string' || payload.jkt.length !== 43 || !B64.test(payload.jkt) ||
      Buffer.from(payload.jkt, 'base64url').toString('base64url') !== payload.jkt ||
      !validScopes(payload.scopes) ||
      typeof payload.status !== 'string' ||
      !['active', 'inactive', 'device_limit', 'credential_expired', 'revoked'].includes(payload.status) ||
      !Number.isSafeInteger(payload.epoch) || Number(payload.epoch) < 1 ||
      !Number.isSafeInteger(payload.token_valid_after) || Number(payload.token_valid_after) < 0 ||
      !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
      !observedAt || !signedExpiresAt || observedAt.getTime() > now + 2000 ||
      signedExpiresAt.getTime() <= observedAt.getTime() ||
      signedExpiresAt.getTime() > observedAt.getTime() + 10_000 ||
      payload.iat !== Math.floor(observedAt.getTime() / 1000) || payload.exp !== payload.iat + 10 ||
      typeof payload.jti !== 'string' || !UUID.test(payload.jti)) {
      throw Error('bound-state-feed-assertion-claims');
    }
    const expiresAt = new Date(Math.min(signedExpiresAt.getTime(), Number(payload.exp) * 1000));
    if (expiresAt.getTime() <= now) throw Error('bound-state-feed-assertion-expired');
    return {
      bindingId, subject: payload.sub, instanceIdHash: payload.instance_id_hash,
      jkt: payload.jkt, scopes: payload.scopes, status: payload.status as VerifiedBoundState['status'],
      epoch: Number(payload.epoch), tokenValidAfter: Number(payload.token_valid_after),
      stateObservedAt: observedAt, stateExpiresAt: expiresAt,
    };
  }

  async function request(bindingId: string): Promise<VerifiedBoundState> {
    const path = `/api/keepany/v1/bound-state/${bindingId}`;
    const endpointUrl = `${commercialOrigin}${path}`;
    const publicEndpointUrl = `${commercialIssuer}${path}`;
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ binding_id: bindingId, htm: 'GET', htu: publicEndpointUrl })
      .setProtectedHeader({ alg: 'RS256', typ: 'bound-state-reader+jwt', kid: config.readerKid })
      .setIssuer(readerIssuer).setAudience('keepany-bound-state-read')
      .setSubject('keepany-sync-state-writer').setJti(randomUUID())
      .setIssuedAt(now).setExpirationTime(now + 20).sign(key);
    if (closed) throw Error('bound-state-feed-closed');
    const controller = new AbortController();
    controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchFn(endpointUrl, {
        method: 'GET', headers: { Authorization: `Bearer ${assertion}`, Accept: 'application/json' },
        cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
      if (response.status !== 200 || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json') ||
        !response.headers.get('cache-control')?.toLowerCase().split(',').some(part => part.trim() === 'no-store')) {
        throw Error('bound-state-feed-http');
      }
      const body = record(await readLimited(response));
      const data = record(body?.data);
      if (!body || Object.keys(body).sort().join(',') !== 'code,data,message' ||
        body.code !== 0 || body.message !== 'ok' || !data ||
        Object.keys(data).join(',') !== 'assertion' || typeof data.assertion !== 'string') {
        throw Error('bound-state-feed-response');
      }
      return verifyAssertion(data.assertion, bindingId);
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }

  function refresh(bindingId: string): Promise<void> {
    if (closed) return Promise.reject(Error('bound-state-feed-closed'));
    if (!UUID.test(bindingId)) return Promise.reject(Error('bound-state-feed-binding-id'));
    const existing = inFlight.get(bindingId);
    if (existing) return existing;
    if (inFlight.size >= BOUND_STATE_FEED_CAPACITY) return Promise.reject(Error('bound-state-feed-capacity-exceeded'));
    const current = (async () => {
      try {
        const state = await request(bindingId);
        if (closed) throw Error('bound-state-feed-closed');
        const applied = await config.store.upsertVerifiedState(state);
        if (!closed) acceptedState(state, applied);
      } catch (error) {
        retryKnown(bindingId);
        throw error;
      }
    })();
    inFlight.set(bindingId, current);
    void current.finally(() => { if (inFlight.get(bindingId) === current) inFlight.delete(bindingId); }).catch(() => {});
    return current;
  }

  function bootstrapIfMissing(bindingId: string): Promise<void> {
    if (closed || !UUID.test(bindingId) || bindingId !== bindingId.toLowerCase()) return Promise.resolve();
    const existing = bootstrapChecks.get(bindingId);
    if (existing) return existing;
    if (known.size >= BOUND_STATE_FEED_CAPACITY && !known.has(bindingId)) {
      report('capacity');
      return Promise.resolve();
    }
    if (bootstrapChecks.size >= 16) return Promise.resolve();
    const current = (async () => {
      if (await config.store.hasState(bindingId) || closed) return;
      const ongoing = inFlight.get(bindingId);
      if (ongoing) { await ongoing; return; }
      const now = Date.now();
      while (bootstrapTimes[0] !== undefined && bootstrapTimes[0] <= now - BOOTSTRAP_WINDOW_MS) bootstrapTimes.shift();
      if (bootstrapTimes.length >= MAX_BOOTSTRAPS_PER_WINDOW) return;
      bootstrapTimes.push(now);
      await refresh(bindingId);
    })().catch(() => { /* No state is safer than a new lease. */ });
    bootstrapChecks.set(bindingId, current);
    void current.finally(() => { if (bootstrapChecks.get(bindingId) === current) bootstrapChecks.delete(bindingId); });
    return current;
  }

  function dispatchDue(): void {
    if (closed || inFlight.size >= BOUND_STATE_FEED_CAPACITY) return;
    const now = Date.now();
    const due = [...known.entries()]
      .filter(([id, entry]) => entry.nextAttemptMs <= now && !inFlight.has(id))
      .sort((a, b) => (a[1].deadlineMs ?? Number.POSITIVE_INFINITY) -
        (b[1].deadlineMs ?? Number.POSITIVE_INFINITY) || a[1].nextAttemptMs - b[1].nextAttemptMs);
    for (const [id] of due) {
      if (inFlight.size >= BOUND_STATE_FEED_CAPACITY) break;
      void refresh(id).catch(() => report('refresh'));
    }
  }

  async function discover(): Promise<void> {
    if (closed || discoveryInFlight) return;
    discoveryInFlight = (async () => {
      const ids = [...new Set(await config.store.listKnownNonRevokedIds())];
      if (closed) return;
      const available = new Set(ids);
      for (const id of known.keys()) if (!available.has(id)) known.delete(id);
      for (const id of ids) {
        if (!UUID.test(id) || id !== id.toLowerCase()) { report('discovery'); continue; }
        if (known.has(id)) continue;
        if (known.size >= BOUND_STATE_FEED_CAPACITY) { report('capacity'); continue; }
        known.set(id, { deadlineMs: null, nextAttemptMs: Date.now(), failures: 0 });
      }
      dispatchDue();
    })();
    try { await discoveryInFlight; } finally { discoveryInFlight = undefined; }
  }

  function start(): Promise<void> {
    if (closed) return Promise.reject(Error('bound-state-feed-closed'));
    if (starting) return starting;
    starting = (async () => {
      const ids = [...new Set(await config.store.listKnownNonRevokedIds())];
      if (closed) throw Error('bound-state-feed-closed');
      if (ids.length > BOUND_STATE_FEED_CAPACITY) throw Error('bound-state-feed-capacity-exceeded');
      for (const id of ids) {
        if (!UUID.test(id) || id !== id.toLowerCase()) throw Error('bound-state-feed-invalid-known-binding');
        known.set(id, { deadlineMs: null, nextAttemptMs: Date.now(), failures: 0 });
      }
      const schedulerMs = Math.min(250, intervalMs);
      schedulerTimer = setInterval(dispatchDue, schedulerMs);
      discoveryTimer = setInterval(() => { void discover().catch(() => report('discovery')); }, intervalMs);
      schedulerTimer.unref?.();
      discoveryTimer.unref?.();
      dispatchDue();
    })();
    return starting;
  }

  async function close(): Promise<void> {
    closed = true;
    if (schedulerTimer) clearInterval(schedulerTimer);
    if (discoveryTimer) clearInterval(discoveryTimer);
    schedulerTimer = undefined;
    discoveryTimer = undefined;
    for (const controller of controllers) controller.abort();
    await Promise.allSettled([...inFlight.values(), ...bootstrapChecks.values(),
      ...(discoveryInFlight ? [discoveryInFlight] : []), ...(starting ? [starting] : [])]);
  }

  return { bootstrapIfMissing, refresh, start, close };
}
