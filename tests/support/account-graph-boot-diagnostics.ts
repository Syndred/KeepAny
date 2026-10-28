import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { BrowserContext, CDPSession, Page, TestInfo } from '@playwright/test';

type Metadata = Record<string, unknown>;
type DiagnosticEvent = 'Network.requestWillBeSent' | 'Network.responseReceived' | 'Network.dataReceived' |
  'Network.loadingFinished' | 'Network.loadingFailed' | 'Page.frameNavigated' | 'Page.lifecycleEvent' |
  'ServiceWorker.workerVersionUpdated' | 'ServiceWorker.workerRegistrationUpdated';
const object = (value: unknown): Metadata => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Metadata : {};
const identifier = (value: unknown) => typeof value === 'string' && /^[\w.:-]{1,160}$/.test(value) ? value : null;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
const boolean = (value: unknown) => typeof value === 'boolean' ? value : null;
const allowed = (value: unknown, values: string[]) => typeof value === 'string' && values.includes(value) ? value : 'redacted';
const networkErrors = ['net::ERR_ABORTED', 'net::ERR_FAILED', 'net::ERR_CONNECTION_RESET', 'net::ERR_CONNECTION_CLOSED',
  'net::ERR_CONNECTION_REFUSED', 'net::ERR_CONTENT_LENGTH_MISMATCH', 'net::ERR_INSUFFICIENT_RESOURCES',
  'net::ERR_CACHE_MISS', 'net::ERR_BLOCKED_BY_CLIENT', 'net::ERR_FILE_NOT_FOUND', 'net::ERR_TIMED_OUT',
  'net::ERR_NETWORK_CHANGED', 'net::ERR_HTTP2_PROTOCOL_ERROR'];

export function documentPath(path: string): string {
  if (/^\/assets\/(account|project|item|subscription)\/[^/]+\/?$/.test(path)) return path.replace(/\/[^/]+\/?$/, '/:id');
  return ['/', '/assets', '/assets/account', '/accounts', '/intake', '/settings'].includes(path) ? path : '/:other';
}

/** Metadata only: never retain a protocol payload, header, body, query or business field. */
export class GraphBootRecorder {
  private origin: string;
  private started = performance.now();
  private events: Metadata[] = [];
  private requests = new Map<string, Metadata>();
  private frames = new Set<string>();
  private droppedEvents = 0;
  private droppedRequests = 0;
  constructor(origin: string) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('diagnostic-origin');
    this.origin = url.origin;
  }
  private path(value: unknown, document = false): string | null {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value, this.origin);
      if (url.origin !== this.origin || url.username || url.password) return null;
      if (document) return documentPath(url.pathname);
      return /^\/(?:assets\/[\w.-]+\.(?:m?js|css|wasm)|sw\.js|workbox-[\w.-]+\.js)$/.test(url.pathname) ? url.pathname : null;
    } catch { return null; }
  }
  private push(kind: string, data: Metadata) {
    if (this.events.length === 512) { this.events.shift(); this.droppedEvents++; }
    this.events.push({ kind, atMs: Math.round((performance.now() - this.started) * 1000) / 1000, ...data });
  }
  request(input: unknown) {
    const event = object(input), request = object(event.request), id = identifier(event.requestId);
    const path = this.path(request.url, event.type === 'Document');
    if (!id) return;
    if (!path || request.method !== 'GET') { this.requests.delete(id); return; }
    const frameId = identifier(event.frameId);
    if (event.type === 'Document' && frameId) {
      const oldest = this.frames.values().next().value;
      if (!this.frames.has(frameId) && this.frames.size === 256 && oldest !== undefined) this.frames.delete(oldest);
      this.frames.add(frameId);
    }
    const metadata = { requestId: id, path, type: allowed(event.type, ['Document', 'Script', 'Stylesheet', 'Wasm', 'Other']),
      loaderId: identifier(event.loaderId), frameId: identifier(event.frameId),
      browserTimestamp: number(event.timestamp), initiator: allowed(object(event.initiator).type, ['parser', 'script', 'preload', 'other', 'preflight']),
      redirect: !!event.redirectResponse, dataEvents: 0, observedEncodedDataLength: 0 };
    if (!this.requests.has(id) && this.requests.size === 256) {
      const oldest = this.requests.keys().next().value;
      if (oldest !== undefined) this.requests.delete(oldest);
      this.droppedRequests++;
    }
    this.requests.set(id, metadata); this.push('request', metadata);
  }
  response(input: unknown) {
    const event = object(input), id = identifier(event.requestId), request = id ? this.requests.get(id) : undefined;
    if (!request) return;
    const response = object(event.response), mime = response.mimeType;
    this.push('response', { requestId: id, path: request.path, loaderId: identifier(event.loaderId), frameId: identifier(event.frameId),
      browserTimestamp: number(event.timestamp), status: number(response.status),
      mime: typeof mime === 'string' && /^[a-z\d.+-]{1,64}\/[a-z\d.+-]{1,80}$/i.test(mime) ? mime : 'redacted',
      fromServiceWorker: boolean(response.fromServiceWorker), fromDiskCache: boolean(response.fromDiskCache),
      encodedDataLength: number(response.encodedDataLength) });
  }
  data(input: unknown) {
    const event = object(input), id = identifier(event.requestId), request = id ? this.requests.get(id) : undefined;
    if (!request) return;
    request.dataEvents = Number(request.dataEvents) + 1;
    request.observedEncodedDataLength = Math.min(Number.MAX_SAFE_INTEGER,
      Number(request.observedEncodedDataLength) + (number(event.encodedDataLength) ?? 0));
    // Do not inspect or keep event.data, even if a future protocol exposes it.
  }
  complete(input: unknown, failed: boolean) {
    const event = object(input), id = identifier(event.requestId), request = id ? this.requests.get(id) : undefined;
    if (!id || !request) return;
    this.push(failed ? 'loading-failed' : 'loading-finished', { ...request, browserTimestamp: number(event.timestamp),
      ...(failed ? { errorCode: allowed(event.errorText, networkErrors), canceled: boolean(event.canceled),
        blockedReason: allowed(event.blockedReason, ['other', 'csp', 'mixed-content', 'origin', 'inspector', 'subresource-filter',
          'content-type', 'coep-frame-resource-needs-coep-header', 'coop-sandboxed-iframe-cannot-navigate-to-coop-page', 'corp-not-same-origin', 'corp-not-same-site', 'corp-not-same-origin-after-defaulted-to-same-origin-by-coep']) }
        : { encodedDataLength: number(event.encodedDataLength) }) });
    this.requests.delete(id);
  }
  frame(input: unknown, lifecycle = false) {
    const event = object(input), frame = lifecycle ? event : object(event.frame);
    if (lifecycle) {
      if (!this.frames.has(identifier(event.frameId) ?? '')) return;
      const name = allowed(event.name, ['init', 'DOMContentLoaded', 'load']);
      if (name !== 'redacted') this.push('frame-lifecycle', {
        name, frameId: identifier(event.frameId), loaderId: identifier(event.loaderId), browserTimestamp: number(event.timestamp) });
      return;
    }
    const path = this.path(frame.url, true);
    const frameId = identifier(frame.id);
    if (!frameId) return;
    if (!path) { this.frames.delete(frameId); return; }
    const oldest = this.frames.values().next().value;
    if (!this.frames.has(frameId) && this.frames.size === 256 && oldest !== undefined) this.frames.delete(oldest);
    this.frames.add(frameId);
    this.push('frame-navigation', { path, frameId, parentFrameId: identifier(frame.parentId), loaderId: identifier(frame.loaderId) });
  }
  workers(input: unknown, registration = false) {
    const event = object(input), items = registration ? event.registrations : event.versions;
    if (!Array.isArray(items)) return;
    for (const value of items.slice(0, 8)) {
      const row = object(value), path = this.path(registration ? row.scopeURL : row.scriptURL, registration);
      if (!path) continue;
      this.push(registration ? 'worker-registration' : 'worker-version', { path, registrationId: identifier(row.registrationId),
        ...(registration ? { deleted: boolean(row.isDeleted) } : { versionId: identifier(row.versionId),
          status: allowed(row.status, ['new', 'installing', 'installed', 'activating', 'activated', 'redundant']),
          runningStatus: allowed(row.runningStatus, ['stopped', 'starting', 'running', 'stopping']),
          controlledClients: Array.isArray(row.controlledClients) ? row.controlledClients.slice(0, 8).map(identifier) : [] }) });
    }
  }
  controller(input: unknown) {
    const event = object(input);
    const name = allowed(event.event, ['installed', 'pageshow', 'controllerchange', 'observer-unavailable']);
    if (name === 'redacted') return;
    if (typeof event.documentPath !== 'string' || event.documentPath.includes('?') || event.documentPath.includes('#')) return;
    this.push('page-controller', { event: name, path: documentPath(event.documentPath),
      controllerPresent: boolean(event.controllerPresent), controllerPath: this.path(event.controllerPath),
      readyState: allowed(event.readyState, ['loading', 'interactive', 'complete']), persisted: boolean(event.persisted) });
  }
  snapshot() { return { events: this.events.map(row => ({ ...row })), droppedEvents: this.droppedEvents,
    droppedRequests: this.droppedRequests, pendingRequests: this.requests.size }; }
}

/** Runs only in the instrumented test page. No DOM/cache/network modifications. */
export function installControllerObserver({ bindingName, cleanupName, origin }: { bindingName: string; cleanupName: string; origin: string }) {
  try {
    if (window !== window.top || location.origin !== origin) return;
    const serviceWorker = 'serviceWorker' in navigator ? navigator.serviceWorker : undefined;
    const emit = (event: string, persisted: boolean | null = null) => {
      try {
        const callback: unknown = Reflect.get(window, bindingName);
        if (typeof callback !== 'function') return;
        const controller = serviceWorker?.controller, url = controller ? new URL(controller.scriptURL) : null;
        void Promise.resolve(callback({ event, documentPath: location.pathname, controllerPresent: !!controller,
          controllerPath: url?.origin === origin ? url.pathname : null, readyState: document.readyState, persisted })).catch(() => {});
      } catch { /* Observations must not introduce a pageError. */ }
    };
    const onController = () => emit('controllerchange');
    const onPageShow = (event: PageTransitionEvent) => emit('pageshow', event.persisted);
    Reflect.set(window, cleanupName, () => {
      window.removeEventListener('pageshow', onPageShow);
      serviceWorker?.removeEventListener('controllerchange', onController);
      Reflect.deleteProperty(window, cleanupName);
    });
    window.addEventListener('pageshow', onPageShow);
    serviceWorker?.addEventListener('controllerchange', onController);
    emit('installed');
  } catch {
    // A denied SW getter must be distinguishable from observing no changes.
    try {
      const callback: unknown = Reflect.get(window, bindingName);
      if (window === window.top && location.origin === origin && typeof callback === 'function') {
        void Promise.resolve(callback({ event: 'observer-unavailable', documentPath: location.pathname })).catch(() => {});
      }
    } catch { /* about:blank/unsupported access cannot introduce a pageError. */ }
  }
}

export async function observeGraphBoot(context: BrowserContext, page: Page, info: TestInfo) {
  const baseURL = info.project.use.baseURL;
  if (typeof baseURL !== 'string') throw Error('diagnostic-origin');
  const started = performance.now(), recorder = new GraphBootRecorder(new URL(baseURL).origin);
  const origin = new URL(baseURL).origin, unavailable = new Set<string>();
  const capabilities: Record<string, boolean> = {};
  const cleanupName = `__keepanyGraphBootCleanup_${randomUUID().replaceAll('-', '')}`;
  const bindingName = cleanupName.replace('Cleanup', 'Binding');
  let client: CDPSession | undefined, stopped = false;
  const removeListeners: Array<() => void> = [];
  const bounded = async <T>(promise: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('diagnostic-deadline')), 2000); })]); }
    finally { clearTimeout(timer); }
  };
  try {
    const connecting = context.newCDPSession(page);
    try { client = await bounded(connecting); }
    catch { void connecting.then(session => session.detach()).catch(() => {}); throw Error('cdp-unavailable'); }
    const session = client;
    const listen = (name: DiagnosticEvent, consume: (value: unknown) => void) => {
      const callback = (value: unknown) => { if (!stopped) { try { consume(value); } catch { unavailable.add('event-unavailable'); } } };
      session.on(name, callback); removeListeners.push(() => session.off(name, callback));
    };
    listen('Network.requestWillBeSent', value => recorder.request(value));
    listen('Network.responseReceived', value => recorder.response(value));
    listen('Network.dataReceived', value => recorder.data(value));
    listen('Network.loadingFinished', value => recorder.complete(value, false));
    listen('Network.loadingFailed', value => recorder.complete(value, true));
    listen('Page.frameNavigated', value => recorder.frame(value));
    listen('Page.lifecycleEvent', value => recorder.frame(value, true));
    listen('ServiceWorker.workerVersionUpdated', value => recorder.workers(value));
    listen('ServiceWorker.workerRegistrationUpdated', value => recorder.workers(value, true));
    for (const domain of ['Network', 'Page', 'ServiceWorker'] as const) {
      try { await bounded(client.send(`${domain}.enable`)); capabilities[domain] = true; }
      catch { capabilities[domain] = false; unavailable.add(`${domain.toLowerCase()}-unavailable`); }
    }
    try { await bounded(client.send('Page.setLifecycleEventsEnabled', { enabled: true })); }
    catch { unavailable.add('lifecycle-events-unavailable'); }
  } catch { unavailable.add('cdp-unavailable'); }
  try {
    await bounded(page.exposeBinding(bindingName, (source, value: unknown) => {
      if (!stopped && source.page === page && source.frame === page.mainFrame()) {
        try {
          if (new URL(source.frame.url()).origin === origin) {
            if (object(value).event === 'observer-unavailable') unavailable.add('controller-api-unavailable');
            recorder.controller(value);
          }
        } catch { /* Ignore an invalid/blank frame. */ }
      }
    }));
    await bounded(page.addInitScript(installControllerObserver, { bindingName, cleanupName, origin }));
    await bounded(page.evaluate(installControllerObserver, { bindingName, cleanupName, origin }));
    capabilities.controller = true;
  } catch { capabilities.controller = false; unavailable.add('controller-observer-unavailable'); }
  const setupMs = performance.now() - started;
  return {
    async finish(failed = false) {
      if (stopped) return;
      stopped = true;
      let finalPage: Metadata = { available: false };
      try {
        finalPage = await bounded(page.evaluate(({ cleanupName, origin }) => {
          if (location.origin !== origin) return { available: false, outsideScope: true };
          const cleanup: unknown = Reflect.get(window, cleanupName);
          if (typeof cleanup === 'function') cleanup();
          return { available: true, readyState: document.readyState,
            rootChildElementCount: document.getElementById('root')?.childElementCount ?? null };
        }, { cleanupName, origin }));
      } catch { unavailable.add('final-page-unavailable'); }
      if (failed) {
        try {
          if (new URL(page.mainFrame().url()).origin === origin) await bounded(page.screenshot({
            path: info.outputPath('account-graph-boot-failed.png'), timeout: 2000, fullPage: false, animations: 'allow', caret: 'initial' }));
          else unavailable.add('failure-screenshot-outside-scope');
        }
        catch { unavailable.add('failure-screenshot-unavailable'); }
      }
      for (const remove of removeListeners) { try { remove(); } catch { unavailable.add('listener-cleanup-unavailable'); } }
      try { if (client) await bounded(client.detach()); } catch { unavailable.add('detach-unavailable'); }
      const result = { schema: 'keepany-graph-boot-diagnostics-v1', observerAffectsTiming: true,
        scope: 'case-main-page-only-no-worker-target-attachment', passiveMetadataOnly: true,
        networkOrCacheInterventions: false, originalCaseFailed: failed, setupMs, capabilities,
        unavailable: [...unavailable], finalPage, ...recorder.snapshot() };
      try {
        const body = Buffer.from(JSON.stringify(result, null, 2));
        await writeFile(info.outputPath('account-graph-boot-diagnostics.json'), body);
        await info.attach('account-graph-boot-diagnostics', { body, contentType: 'application/json' });
      } catch { /* Diagnostic attachment failure must not replace the original test result. */ }
    },
  };
}
