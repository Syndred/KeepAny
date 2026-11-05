import { Capacitor } from '@capacitor/core';
import { Preferences, type PreferencesPlugin } from '@capacitor/preferences';
import { nativePlatform } from './index';
import { isPlatformSettingKey, validatePlatformSetting, type PlatformSettingsStorage } from '../../../apps/web/src/platform-settings';

/** Native Preferences is the sole persistent owner; this map is a confirmed read snapshot. */
export async function createHydratedPreferences(plugin: Pick<PreferencesPlugin, 'keys' | 'get' | 'set' | 'remove'>): Promise<PlatformSettingsStorage> {
  const values = new Map<string, string>();
  for (const key of (await plugin.keys()).keys.filter(isPlatformSettingKey)) {
    const { value } = await plugin.get({ key });
    if (value === null) continue;
    try { validatePlatformSetting(key, value); values.set(key, value); }
    catch { /* Invalid/legacy metadata stays disabled. No values are logged or copied to Web storage. */ }
  }
  let tail: Promise<void> = Promise.resolve();
  function enqueue(action: () => Promise<void>): Promise<void> {
    const next = tail.then(action);
    tail = next.catch(() => {});
    return next;
  }
  return {
    getItem(key) {
      if (!isPlatformSettingKey(key)) throw Error('settings-key');
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      validatePlatformSetting(key, value);
      return enqueue(async () => { await plugin.set({ key, value }); values.set(key, value); });
    },
    removeItem(key) {
      if (!isPlatformSettingKey(key)) throw Error('settings-key');
      return enqueue(async () => { await plugin.remove({ key }); values.delete(key); });
    },
  };
}

export async function hydrateNativePreferences(): Promise<PlatformSettingsStorage> {
  nativePlatform();
  if (!Capacitor.isPluginAvailable('Preferences')) throw Error('native-preferences-unavailable');
  return createHydratedPreferences(Preferences);
}
