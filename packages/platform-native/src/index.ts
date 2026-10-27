import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

export type NativePlatform = 'android' | 'ios';
export function nativePlatform(): NativePlatform {
  const platform = Capacitor.getPlatform();
  if (!Capacitor.isNativePlatform() || (platform !== 'android' && platform !== 'ios')) throw Error('native-platform-required');
  return platform;
}

export function assertPersistentUri(uri: string): void {
  let parsed: URL;
  try { parsed = new URL(uri); } catch { throw Error('native-storage-location'); }
  const path = decodeURIComponent(parsed.pathname).replaceAll('\\', '/');
  if (parsed.protocol !== 'file:' || parsed.hostname || parsed.search || parsed.hash || !path.startsWith('/') || /\/(?:cache|caches|tmp|temp)(?:\/|$)/i.test(path)) throw Error('native-storage-location');
}

export interface PersistentFiles {
  rootUri(): Promise<string>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
  list(): Promise<string[]>;
}

const root = 'Application Support/KeepAny';
function checkedPath(path: string): string {
  if (!/^(?:files|vaults|recovery)\/[a-z0-9-]+(?:\.(?:bin|kdbx|ka1))?$/.test(path)) throw Error('native-file-path');
  return `${root}/${path}`;
}

export function nativeFiles(): PersistentFiles {
  nativePlatform();
  if (!Capacitor.isPluginAvailable('Filesystem')) throw Error('native-files-unavailable');
  // LIBRARY_NO_CLOUD maps to Library on iOS and internal filesDir on Android.
  // Independent exports provide recovery; app files do not promise iCloud backup.
  const directory = Directory.LibraryNoCloud;
  return {
    async rootUri() {
      await Filesystem.mkdir({ path: root, directory, recursive: true }).catch(async error => {
        const stat = await Filesystem.stat({ path: root, directory }).catch(() => null);
        if (stat?.type !== 'directory') throw error;
      });
      const { uri } = await Filesystem.getUri({ path: root, directory });
      assertPersistentUri(uri);
      for (const child of ['files', 'vaults', 'recovery']) {
        const path = `${root}/${child}`;
        await Filesystem.mkdir({ path, directory, recursive: true }).catch(async error => {
          if ((await Filesystem.stat({ path, directory }).catch(() => null))?.type !== 'directory') throw error;
        });
      }
      return uri;
    },
    async write(path, bytes) {
      let binary = '';
      for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
      await Filesystem.writeFile({ path: checkedPath(path), directory, data: btoa(binary), recursive: true });
    },
    async read(path) {
      const { data } = await Filesystem.readFile({ path: checkedPath(path), directory });
      if (typeof data !== 'string') throw Error('native-file-format');
      const binary = atob(data);
      return Uint8Array.from(binary, char => char.charCodeAt(0));
    },
    async remove(path) { await Filesystem.deleteFile({ path: checkedPath(path), directory }); },
    async list() {
      const result: string[] = [];
      for (const child of ['files', 'vaults', 'recovery']) {
        const { files } = await Filesystem.readdir({ path: `${root}/${child}`, directory });
        for (const file of files) if (file.type === 'file') {
          const path = `${child}/${file.name}`;
          checkedPath(path);
          result.push(path);
        }
      }
      return result;
    },
  };
}
