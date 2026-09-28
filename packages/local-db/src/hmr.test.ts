import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';

it('reuses the open default RxDB after module reload and keeps file access working', async () => {
  const first = await import('./index');
  const db = await first.database();
  const fileId = await first.putFile(new File([new Uint8Array([4, 5])], 'hot.png', { type: 'image/png' }));
  try {
    vi.resetModules(); // Vite HMR evaluates the module again while the old database is still open.
    const reloaded = await import('./index');
    expect(await reloaded.database()).toBe(db);
    const url = await reloaded.fileUrl(fileId);
    expect(url).toMatch(/^blob:/);
    URL.revokeObjectURL(url);
    expect(await reloaded.cleanupUnreferencedFile(fileId)).toBe(true);
  } finally {
    await db.close();
    first.files.close();
    delete (globalThis as typeof globalThis & { __keepanyLocalDbState?: unknown }).__keepanyLocalDbState;
  }
}, 20_000);
