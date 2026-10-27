import { afterEach, expect, it, vi } from 'vitest';
import { createHydratedPreferences, hydrateNativePreferences } from './preferences';
import { getPlatformSetting, registerPlatformSettings, setPlatformSetting, validatePlatformSetting } from '../../../apps/web/src/platform-settings';

afterEach(() => vi.unstubAllGlobals());
function plugin(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { values, keys: vi.fn(async () => ({ keys: [...values.keys()] })),
    get: vi.fn(async ({ key }: { key: string }) => ({ value: values.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => { values.set(key, value); }),
    remove: vi.fn(async ({ key }: { key: string }) => { values.delete(key); }),
  };
}

it('hydrates only non-sensitive whitelisted keys without reading forbidden credentials or writing localStorage', async () => {
  const native = plugin({ 'keepany-language': 'zh-CN', 'keepany-selfhost-workspace': 'workspace-1',
    'keepany-official-workspace:user-1': 'workspace-2', 'device-private-key': 'must-not-read',
    'keepany-ai-settings-v1': JSON.stringify({ provider: 'deepseek', baseURL: 'https://api.deepseek.com', model: 'chat', keySource: 'session', apiKey: 'legacy-secret' }),
  });
  const web = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
  vi.stubGlobal('window', { localStorage: web });
  const storage = await createHydratedPreferences(native);
  const unregister = registerPlatformSettings(storage);
  try {
    expect(getPlatformSetting('keepany-language')).toBe('zh-CN');
    expect(getPlatformSetting('keepany-official-workspace:user-1')).toBe('workspace-2');
    expect(getPlatformSetting('keepany-ai-settings-v1')).toBeNull();
    expect(native.get).not.toHaveBeenCalledWith({ key: 'device-private-key' });
    await setPlatformSetting('keepany-language', 'en');
    expect(native.values.get('keepany-language')).toBe('en');
    expect(web.getItem).not.toHaveBeenCalled(); expect(web.setItem).not.toHaveBeenCalled();
  } finally { unregister(); }
});

it('publishes the confirmed snapshot only after a native write succeeds, and retains it after write/remove errors', async () => {
  const native = plugin({ 'keepany-language': 'en' });
  let finish!: () => void, fail!: (error: Error) => void;
  native.set.mockImplementation(({ key, value }) => new Promise<void>((resolve, reject) => {
    finish = () => { native.values.set(key, value); resolve(); }; fail = reject;
  }));
  const storage = await createHydratedPreferences(native);
  const pending = storage.setItem('keepany-language', 'zh-CN'); await Promise.resolve();
  expect(storage.getItem('keepany-language')).toBe('en');
  finish(); await pending; expect(storage.getItem('keepany-language')).toBe('zh-CN');
  const rejected = storage.setItem('keepany-language', 'en'); await Promise.resolve();
  fail(Error('synthetic-disk-full')); await expect(rejected).rejects.toThrow('synthetic-disk-full');
  expect(storage.getItem('keepany-language')).toBe('zh-CN');
  native.remove.mockRejectedValueOnce(Error('synthetic-remove-failure'));
  await expect(storage.removeItem('keepany-language')).rejects.toThrow('synthetic-remove-failure');
  expect(storage.getItem('keepany-language')).toBe('zh-CN');
});

it('rejects secret fields, tokens, invalid service URLs and unavailable native storage', async () => {
  for (const [key, value] of [['token', 'secret'], ['keepany-selfhost-endpoint', 'https://u:p@example.test'],
    ['keepany-selfhost-endpoint', 'https://example.test/?api_key=secret'], ['keepany-language', 'unsupported'],
    ['keepany-ai-settings-v1', JSON.stringify({ provider: 'deepseek', baseURL: 'https://api.deepseek.com', model: 'chat', keySource: 'session', password: 'secret' })]]) {
    expect(() => validatePlatformSetting(key, value)).toThrow('settings-invalid');
  }
  await expect(hydrateNativePreferences()).rejects.toThrow('native-platform-required');
  const native = plugin(); native.keys.mockRejectedValueOnce(Error('synthetic-preferences-unavailable'));
  await expect(createHydratedPreferences(native)).rejects.toThrow('synthetic-preferences-unavailable');
});
