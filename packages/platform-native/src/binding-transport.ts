import { createRemoteJWKSet, customFetch } from 'jose';
import { BindingTransport } from '../../binding/src/remote';
import type { PlatformBindingAdapter } from '../../../apps/web/src/platform-binding';
import { createNativeServiceFetch, serviceOrigin } from './service-fetch';

const bindingPaths = new Set(['/api/keepany/v1/bindings/device', '/api/keepany/v1/bindings/poll', '/api/keepany/v1/bindings/refresh', '/api/keepany/v1/bindings/state']);
const syncPaths = new Set(['/sync/identity', '/sync/devices', '/sync/preflight', '/sync/push', '/sync/pull']);
const attachment = /^\/workspaces\/[0-9a-f-]{36}\/attachments\/[0-9a-f-]{36}$/i;
const keyEnvelopes = /^\/workspaces\/[0-9a-f-]{36}\/key-envelopes(?:\/[0-9a-f-]{36}(?:\/revoke)?)?$/i;

export function allowSyncRoute(path: string, method: string): boolean {
  if (syncPaths.has(path)) return path === '/sync/devices' ? method === 'GET' : method === 'POST';
  if (path === '/workspaces') return method === 'GET' || method === 'POST';
  if (attachment.test(path)) return method === 'GET' || method === 'PUT';
  if (keyEnvelopes.test(path)) return path.endsWith('/revoke') ? method === 'POST' : method === 'GET' || method === 'POST' && path.endsWith('/key-envelopes');
  return false;
}

/** The build fixes the issuer/resource; a returned challenge cannot change them. */
export function createNativeBindingPlatform(issuer: unknown, resource: unknown): PlatformBindingAdapter {
  const fixedIssuer = typeof issuer === 'string' ? serviceOrigin(issuer) : undefined;
  const fixedResource = typeof resource === 'string' ? serviceOrigin(resource) : undefined;
  const fetchIssuer = fixedIssuer ? createNativeServiceFetch(fixedIssuer, (path, method) => path === '/.well-known/jwks.json' ? method === 'GET' : bindingPaths.has(path) && method === 'POST') : undefined;
  const transport = fixedIssuer && fetchIssuer ? new BindingTransport(fixedIssuer, fetchIssuer) : undefined;
  const keys = fixedIssuer && fetchIssuer ? createRemoteJWKSet(new URL('/.well-known/jwks.json', fixedIssuer), {
    cacheMaxAge: 30000, cooldownDuration: 5000, timeoutDuration: 5000,
    [customFetch]: (url, options) => fetchIssuer(url, { method: options.method, signal: options.signal }),
  }) : undefined;
  const resourceFetch = fixedResource ? createNativeServiceFetch(fixedResource, allowSyncRoute) : (async () => { throw Error('binding-unconfigured'); }) as typeof fetch;
  return {
    configured(value) { return Boolean(fixedIssuer && value === fixedIssuer); },
    client(value) { if (value !== fixedIssuer || !transport || !keys) throw Error('binding-unconfigured'); return { transport, keys }; },
    allowsResource(value) { return Boolean(fixedIssuer && fixedResource && value === fixedResource); },
    resourceFetch,
  };
}

/** Each explicitly configured self-host origin gets its own pinned transport. */
export function createNativeSyncFetchFactory(sessionFetch?: (origin: string) => typeof fetch | undefined) {
  const clients = new Map<string, typeof fetch>();
  return (endpoint: string): typeof fetch => {
    const origin = serviceOrigin(endpoint);
    let client = clients.get(origin);
    if (!client) {
      const service = createNativeServiceFetch(origin, allowSyncRoute);
      client = (input, init) => {
        const credentials = init?.credentials ?? (input instanceof Request ? input.credentials : undefined);
        if (credentials === 'include') {
          const session = sessionFetch?.(origin);
          if (!session) return Promise.reject(Error('native-session-required'));
          return session(input, init);
        }
        return service(input, init);
      };
      if (clients.size >= 16) clients.delete(clients.keys().next().value as string);
      clients.set(origin, client);
    }
    return client;
  };
}
