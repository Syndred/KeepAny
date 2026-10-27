import { nativeFiles } from '../../platform-native/src';
import { openNativeDriver, nativeDatabaseExists, deleteCandidateDatabase } from './driver';
import { NativeStore } from './store';
import { NativeFileStore } from './repository-storage';
export { NativeStore } from './store';
export type { NativeRecord, SideTableName } from './store';
export type { SqlDriver } from './driver';
export async function openNativeStore(name: string): Promise<NativeStore> {
  return NativeStore.open(await openNativeDriver(name), nativeFiles(name));
}
export async function openNativeRepository(name = 'keepany-v1') {
  const store = await openNativeStore(name);
  try {
    const { openRepositoryFromBackend } = await import('../../local-db/src');
    const side = new NativeFileStore(name, store);
    const repository = await openRepositoryFromBackend(side.records, side);
    // File collection is maintenance. A denied delete must not close a healthy
    // database or make local assets unavailable; the next pass retries it.
    await store.collectFileGarbage().catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    store.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { void store.collectFileGarbage().catch(() => { /* Retain files on a read failure; retry next launch. */ }); }, 15_000);
    });
    return repository;
  } catch (error) { await store.close(); throw error; }
}
export async function openNativeDatasetManager() {
  const { NativeDatasetManager } = await import('./datasets');
  return NativeDatasetManager.open(await openNativeDriver('keepany-control'), openNativeRepository, nativeDatabaseExists, async name => {
    await deleteCandidateDatabase(name);
    const files = nativeFiles(name);
    await files.rootUri();
    for (const path of await files.list()) await files.remove(path);
  });
}
