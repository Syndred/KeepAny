import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { nativePlatform } from './index';

export interface NativeExportRequest { name: string; mimeType: string; bytes: Uint8Array }
export interface NativeExportResult { status: 'opened' | 'cancelled' }

const directory = Directory.Cache;
const root = 'exports';
const maxAge = 24 * 60 * 60 * 1000;
let inFlight = false;

function base64(bytes: Uint8Array): string {
  let text = '';
  for (let start = 0; start < bytes.length; start += 8192) text += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(text);
}

async function digest(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function shareCancelled(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'message' in error && error.message === 'Share canceled';
}

// Only old files created by this module are eligible. Recent files may still be
// read by the receiving app after Share resolves, so never delete them on return.
async function removeExpiredExports(): Promise<void> {
  const files = await Filesystem.readdir({ path: root, directory }).catch(() => null);
  if (!files) return;
  for (const file of files.files) {
    if (file.type !== 'directory' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(file.name) ||
      !Number.isFinite(file.mtime) || file.mtime > Date.now() - maxAge) continue;
    await Filesystem.rmdir({ path: `${root}/${file.name}`, directory, recursive: true }).catch(() => undefined);
  }
}

/** User initiated only. Cache exports never become the core data or vault store. */
export async function exportNativeFile(request: NativeExportRequest): Promise<NativeExportResult> {
  nativePlatform();
  if (!Capacitor.isPluginAvailable('Filesystem') || !Capacitor.isPluginAvailable('Share')) throw Error('native-export-unavailable');
  if (inFlight) throw Error('native-export-busy');
  if (!request.name || request.name.length > 180 || /[/\\:*?"<>|]/.test(request.name) ||
    Array.from(request.name).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    !/\.(?:ka1|kdbx|json)$/i.test(request.name) || !(request.bytes instanceof Uint8Array) || !request.bytes.length ||
    !['application/octet-stream', 'application/json', 'application/x-keepass2'].includes(request.mimeType)) throw Error('native-export-invalid');
  inFlight = true;
  const folder = `${root}/${crypto.randomUUID()}`;
  const path = `${folder}/${request.name}`;
  let shared = false;
  try {
    // Snapshot before the first await: callers may update their generated file.
    const bytes = new Uint8Array(request.bytes);
    if (!(await Share.canShare()).value) throw Error('native-export-unavailable');
    await removeExpiredExports();
    const expectedHash = await digest(bytes);
    await Filesystem.writeFile({ path, directory, data: base64(bytes), recursive: true });
    const readback = await Filesystem.readFile({ path, directory });
    if (typeof readback.data !== 'string') throw Error('native-export-readback');
    const binary = atob(readback.data);
    const actual = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (actual.length !== bytes.length || await digest(actual) !== expectedHash) throw Error('native-export-readback');
    const { uri } = await Filesystem.getUri({ path, directory });
    if (!/^file:\/\//.test(uri)) throw Error('native-export-location');
    try {
      await Share.share({ title: request.name, files: [uri] });
      shared = true;
      return { status: 'opened' };
    } catch (error) {
      if (shareCancelled(error)) return { status: 'cancelled' };
      throw Error('native-export-share');
    }
  } finally {
    // A cancellation or pre-share failure has no recipient. Do not erase files
    // after a completed share activity: that is not a durable-save receipt.
    if (!shared) await Filesystem.rmdir({ path: folder, directory, recursive: true }).catch(() => undefined);
    inFlight = false;
  }
}
