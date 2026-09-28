import { createHash } from 'node:crypto';
import { calculateJwkThumbprint, createLocalJWKSet, decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import type { Authenticate, AuthRequest } from './app';

type Scope = AuthRequest['scope'];
export type BoundBinding = {
  bindingId: string;
  subject: string;
  instanceIdHash: string;
  jkt: string;
  scopes: Scope[];
};
export type BoundAuthConfig = {
  issuer: string;
  publicOrigin: string;
  jwks: unknown;
  bindings: unknown;
};

const B64 = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{64}$/;

function fixedOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== value || !['http:', 'https:'].includes(url.protocol)) throw Error('bound-origin-configuration');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw Error('bound-origin-configuration');
  }
  return url.origin;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readJwks(value: unknown) {
  const set = record(value);
  if (!set || Object.keys(set).join(',') !== 'keys' || !Array.isArray(set.keys) || set.keys.length === 0) {
    throw Error('bound-jwks-configuration');
  }
  const kids = new Set<string>();
  const keys = set.keys.map(value => {
    const key = record(value);
    if (key?.kty !== 'RSA' || key.alg !== 'RS256' || key.use !== 'sig' ||
      typeof key.kid !== 'string' || !key.kid || kids.has(key.kid) ||
      typeof key.n !== 'string' || !B64.test(key.n) || Buffer.from(key.n, 'base64url').length < 256 ||
      key.e !== 'AQAB' || Object.keys(key).some(name => !['kty', 'n', 'e', 'kid', 'alg', 'use'].includes(name))) {
      throw Error('bound-jwks-configuration');
    }
    kids.add(key.kid);
    return { kty: 'RSA', n: key.n, e: key.e, kid: key.kid, alg: 'RS256', use: 'sig' };
  });
  return createLocalJWKSet({ keys });
}

function readBindings(value: unknown): Map<string, BoundBinding> {
  if (!Array.isArray(value) || value.length === 0) throw Error('bound-bindings-configuration');
  const bindings = new Map<string, BoundBinding>();
  for (const item of value) {
    const binding = record(item);
    if (!binding || typeof binding.bindingId !== 'string' || !UUID.test(binding.bindingId) ||
      bindings.has(binding.bindingId) || typeof binding.subject !== 'string' ||
      !/^keepanyadm:[^\s]{1,128}$/.test(binding.subject) ||
      typeof binding.instanceIdHash !== 'string' || !HEX.test(binding.instanceIdHash) ||
      typeof binding.jkt !== 'string' || binding.jkt.length !== 43 || !B64.test(binding.jkt) ||
      !Array.isArray(binding.scopes) || binding.scopes.length === 0 ||
      binding.scopes.some(scope => scope !== 'sync:read' && scope !== 'sync:write') ||
      !binding.scopes.includes('sync:read') ||
      Object.keys(binding).some(name => !['bindingId', 'subject', 'instanceIdHash', 'jkt', 'scopes'].includes(name))) {
      throw Error('bound-bindings-configuration');
    }
    bindings.set(binding.bindingId, binding as BoundBinding);
  }
  return bindings;
}

function publicDeviceJwk(value: unknown) {
  const key = record(value);
  if (!key || Object.keys(key).sort().join(',') !== 'crv,kty,x,y' || key.kty !== 'EC' ||
    key.crv !== 'P-256' || typeof key.x !== 'string' || key.x.length !== 43 || !B64.test(key.x) ||
    typeof key.y !== 'string' || key.y.length !== 43 || !B64.test(key.y)) return null;
  return { kty: 'EC' as const, crv: 'P-256' as const, x: key.x, y: key.y };
}

/** Fixed-issuer, locally pinned-key verifier. Binding mappings are operator controlled until state bridging exists. */
export function createBoundTokenAuthenticator(config: BoundAuthConfig): Authenticate {
  const issuer = fixedOrigin(config.issuer);
  const publicOrigin = fixedOrigin(config.publicOrigin);
  const keys = readJwks(config.jwks);
  const bindings = readBindings(config.bindings);
  const seenProofs = new Map<string, number>();
  return async (authorization, request) => {
    if (!authorization?.startsWith('DPoP ') || authorization.length > 4101 || !request?.dpop || request.dpop.length > 2048) return null;
    if (request.origin && request.origin !== publicOrigin) return null;
    const token = authorization.slice(5);
    try {
      const header = decodeProtectedHeader(token);
      if (header.alg !== 'RS256' || header.typ !== 'JWT' || typeof header.kid !== 'string' ||
        Object.keys(header).some(name => !['alg', 'typ', 'kid'].includes(name))) return null;
      const { payload } = await jwtVerify(token, keys, { issuer, audience: 'keepany-sync-bound', algorithms: ['RS256'] });
      const now = Math.floor(Date.now() / 1000);
      const binding = typeof payload.binding_id === 'string' ? bindings.get(payload.binding_id) : undefined;
      const confirmation = record(payload.cnf);
      const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
      if (!binding || payload.aud !== 'keepany-sync-bound' || payload.sub !== binding.subject ||
        payload.instance_id_hash !== binding.instanceIdHash || confirmation?.jkt !== binding.jkt ||
        Object.keys(confirmation).join(',') !== 'jkt' ||
        typeof payload.iat !== 'number' || !Number.isInteger(payload.iat) ||
        typeof payload.exp !== 'number' || !Number.isInteger(payload.exp) ||
        payload.iat > now + 60 || payload.exp > now + 60 ||
        payload.exp <= payload.iat || payload.exp - payload.iat > 60 ||
        typeof payload.jti !== 'string' || !UUID.test(payload.jti) ||
        scopes.length === 0 || scopes.some(scope => scope !== 'sync:read' && scope !== 'sync:write') ||
        !scopes.includes(request.scope) || !binding.scopes.includes(request.scope)) return null;

      const proofHeader = decodeProtectedHeader(request.dpop);
      const deviceJwk = publicDeviceJwk(proofHeader.jwk);
      if (!deviceJwk || proofHeader.alg !== 'ES256' || proofHeader.typ !== 'dpop+jwt' ||
        Object.keys(proofHeader).some(name => !['alg', 'typ', 'jwk'].includes(name)) ||
        await calculateJwkThumbprint(deviceJwk, 'sha256') !== binding.jkt) return null;
      const deviceKey = await importJWK(deviceJwk, 'ES256');
      const { payload: proof } = await jwtVerify(request.dpop, deviceKey, { algorithms: ['ES256'] });
      const path = new URL(request.url).pathname;
      const expectedHtu = `${publicOrigin}${path}`;
      const ath = createHash('sha256').update(token).digest('base64url');
      if (proof.htm !== request.method || proof.htu !== expectedHtu || proof.ath !== ath ||
        typeof proof.iat !== 'number' || !Number.isInteger(proof.iat) || Math.abs(now - proof.iat) > 60 ||
        typeof proof.jti !== 'string' || !B64.test(proof.jti) || proof.jti.length < 22 || proof.jti.length > 128) return null;
      for (const [id, expiry] of seenProofs) if (expiry <= now) seenProofs.delete(id);
      if (seenProofs.size >= 10000) return null;
      const replayKey = `${binding.jkt}:${proof.jti}`;
      if (seenProofs.has(replayKey)) return null;
      seenProofs.set(replayKey, now + 121);
      return binding.subject;
    } catch {
      return null;
    }
  };
}
