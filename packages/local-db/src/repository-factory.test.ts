import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';

const state = globalThis as typeof globalThis & { __keepanyLocalDbState?: unknown };
afterEach(() => { delete state.__keepanyLocalDbState; vi.resetModules(); });

it('imports shared backup/repository code without opening the default Web store', async () => {
  delete state.__keepanyLocalDbState;
  vi.resetModules();
  const api = await import('./index');
  expect(api.inspectArchive).toBeTypeOf('function');
  expect(state.__keepanyLocalDbState).toEqual({});
});

it('keeps Native initialization errors visible and retries only that factory, without a Web fallback', async () => {
  delete state.__keepanyLocalDbState;
  vi.resetModules();
  const api = await import('./index');
  const factory = vi.fn(async () => { throw Error('native-sqlite-unavailable'); });
  api.registerRepositoryFactory(factory);
  await expect(api.localRepository()).rejects.toThrow('native-sqlite-unavailable');
  await expect(api.localRepository()).rejects.toThrow('native-sqlite-unavailable');
  expect(factory).toHaveBeenCalledTimes(2);
  expect(state.__keepanyLocalDbState).toEqual({ factory });
  expect(() => api.files.name).toThrow('web-files-unavailable');
});

it('uses the installed repository instance and rejects changing factories after reads start', async () => {
  delete state.__keepanyLocalDbState;
  vi.resetModules();
  const api = await import('./index');
  const repository = await api.openLocalRepository(`factory-${crypto.randomUUID()}`);
  try {
    const factory = vi.fn(async () => repository);
    api.registerRepositoryFactory(factory);
    expect(await api.localRepository()).toBe(repository);
    expect(await api.localRepository()).toBe(repository);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(() => api.registerRepositoryFactory(factory)).toThrow('repository-already-started');
    expect(state.__keepanyLocalDbState).toEqual({ factory });
  } finally { await repository.close(); }
});
