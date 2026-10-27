import { Capacitor, registerPlugin } from '@capacitor/core';

interface MetadataResponse { url: string; contentType: string; bodyBase64: string }
interface MetadataPlugin {
  read(input: { requestId: string; url: string }): Promise<MetadataResponse>;
  cancel(input: { requestId: string }): Promise<void>;
}
const plugin = registerPlugin<MetadataPlugin>('KeepAnyMetadata');
const maxBytes = 1024 * 1024;

function checkedResponse(value: MetadataResponse): { url: string; html: string } {
  if (!value || typeof value.url !== 'string' || value.url.length > 2048 ||
    typeof value.contentType !== 'string' || !/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(value.contentType) ||
    typeof value.bodyBase64 !== 'string' || value.bodyBase64.length > 4 * Math.ceil(maxBytes / 3) || value.bodyBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.bodyBase64)) throw Error('metadata-invalid');
  let url: URL;
  try { url = new URL(value.url); } catch { throw Error('metadata-invalid'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('metadata-invalid');
  const bytes = Uint8Array.from(atob(value.bodyBase64), character => character.charCodeAt(0));
  if (bytes.length > maxBytes) throw Error('metadata-limit');
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(value.contentType)?.[1] ?? 'utf-8';
  let html: string;
  try { html = new TextDecoder(charset, { fatal: true }).decode(bytes); }
  catch { throw Error('metadata-encoding'); }
  url.hash = '';
  return { url: url.href, html };
}

function checkedError(error: unknown): Error {
  const message = error && typeof error === 'object' && 'message' in error ? error.message : '';
  return Error(typeof message === 'string' && /^metadata-(?:url|private|redirect|http|type|limit|timeout|busy|body|network|encoding|unavailable|invalid)$/.test(message) ? message : 'metadata-network');
}

/** Native fetch is deliberately separate from CapacitorHttp and has no Web fallback. */
export async function readNativeMetadataHtml(url: string, options: { signal?: AbortSignal } = {}): Promise<{ url: string; html: string }> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('KeepAnyMetadata')) throw Error('metadata-unavailable');
  if (options.signal?.aborted) throw Error('metadata-timeout');
  let target: URL;
  try { target = new URL(url); } catch { throw Error('metadata-url'); }
  if (url.length > 2048 || !['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw Error('metadata-url');
  target.hash = '';
  const requestId = crypto.randomUUID();
  let abort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => {
      void plugin.cancel({ requestId }).catch(() => undefined);
      reject(Error('metadata-timeout'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    const response = await Promise.race([plugin.read({ requestId, url: target.href }), aborted]);
    return checkedResponse(response);
  } catch (error) { throw checkedError(error); }
  finally { options.signal?.removeEventListener('abort', abort); }
}
