export interface SessionConnection {
  readonly origin: string;
  readonly fetch: typeof fetch;
  close(): Promise<void>;
}
export interface PlatformConnections {
  openSession(origin: string): Promise<SessionConnection>;
  backupFetch(targets: { url: string; method: 'GET' | 'PUT' }[]): typeof fetch;
}
let native: PlatformConnections | undefined;
export function registerPlatformConnections(adapter: PlatformConnections): () => void {
  if (native) throw Error('connections-platform-registered');
  native = adapter;
  return () => { if (native === adapter) native = undefined; };
}
export async function openPlatformSession(origin: string, nativeApp: boolean): Promise<SessionConnection> {
  if (nativeApp) {
    if (!native) throw Error('native-connections-unavailable');
    let url: URL;
    try { url = new URL(origin); } catch { throw Error('native-session-origin'); }
    if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password) throw Error('native-session-origin');
    return native.openSession(origin);
  }
  if (origin !== window.location.origin) throw Error('session-origin');
  return { origin, fetch, close: async () => {} };
}
export function backupPlatformFetch(targets: { url: string; method: 'GET' | 'PUT' }[]): typeof fetch {
  if (!native && Capacitor.isNativePlatform()) throw Error('native-connections-unavailable');
  return native ? native.backupFetch(targets) : fetch;
}
import { Capacitor } from '@capacitor/core';
