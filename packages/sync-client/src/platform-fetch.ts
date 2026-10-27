export type SyncFetchFactory = (endpoint: string) => typeof fetch;
let nativeFactory: SyncFetchFactory | undefined;
export function registerSyncFetchFactory(factory: SyncFetchFactory): () => void {
  if (nativeFactory) throw Error('sync-platform-registered');
  nativeFactory = factory;
  return () => { if (nativeFactory === factory) nativeFactory = undefined; };
}
export function fetchSync(endpoint: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return nativeFactory ? nativeFactory(endpoint)(input, init) : fetch(input, init);
}
