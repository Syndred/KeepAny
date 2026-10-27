export interface PlatformSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export const platformSettingKeys = [
  'keepany-language', 'keepany-ai-settings-v1', 'keepany-sync-access-mode',
  'keepany-selfhost-access-mode', 'keepany-selfhost-endpoint', 'keepany-selfhost-workspace',
] as const;
const aiProviders = ['openai', 'anthropic', 'google', 'deepseek', 'qwen', 'doubao', 'moonshot', 'minimax', 'openrouter', 'ollama', 'compatible'];
const aiMetadataFields = new Set(['provider', 'baseURL', 'model', 'keySource', 'vaultEntryId', 'autoActivate']);
let registered: PlatformSettingsStorage | undefined;
const containsControl = (value: string) => Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

export function isPlatformSettingKey(key: string): boolean {
  return (platformSettingKeys as readonly string[]).includes(key) ||
    key.startsWith('keepany-official-workspace:') && key.length > 'keepany-official-workspace:'.length &&
    key.length <= 240 && !containsControl(key);
}
function validServiceUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return !url.username && !url.password && !url.search && !url.hash &&
      (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}

/** Strict whitelist. This layer never accepts credentials, tokens or arbitrary JSON. */
export function validatePlatformSetting(key: string, value: string): void {
  if (!isPlatformSettingKey(key) || typeof value !== 'string' || value.length > 4096 || value.includes('\0')) throw Error('settings-invalid');
  if (key === 'keepany-language') {
    if (!['zh-CN', 'en'].includes(value)) throw Error('settings-invalid');
  } else if (key === 'keepany-sync-access-mode' || key === 'keepany-selfhost-access-mode') {
    if (!['token', 'session', ...(key === 'keepany-sync-access-mode' ? ['official'] : [])].includes(value)) throw Error('settings-invalid');
  } else if (key === 'keepany-selfhost-endpoint') {
    if (value.length > 2048 || !validServiceUrl(value)) throw Error('settings-invalid');
  } else if (key === 'keepany-ai-settings-v1') {
    let metadata: Record<string, unknown>;
    try { metadata = JSON.parse(value); } catch { throw Error('settings-invalid'); }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
      Object.keys(metadata).some(field => !aiMetadataFields.has(field)) || !aiProviders.includes(metadata.provider as string) ||
      typeof metadata.baseURL !== 'string' || metadata.baseURL.length > 2048 || !validServiceUrl(metadata.baseURL) ||
      typeof metadata.model !== 'string' || !metadata.model.trim() || metadata.model.length > 200 ||
      !['session', 'vault', 'none'].includes(metadata.keySource as string) ||
      metadata.vaultEntryId !== undefined && (typeof metadata.vaultEntryId !== 'string' || !metadata.vaultEntryId || metadata.vaultEntryId.length > 200) ||
      metadata.keySource === 'vault' && !metadata.vaultEntryId ||
      metadata.autoActivate !== undefined && typeof metadata.autoActivate !== 'boolean') throw Error('settings-invalid');
  } else if (!value || value.length > 512 || containsControl(value)) throw Error('settings-invalid');
}

/** Native installs an already hydrated snapshot before i18n or any page is imported. */
export function registerPlatformSettings(storage: PlatformSettingsStorage): () => void {
  if (registered) throw Error('settings-already-registered');
  registered = storage;
  return () => { if (registered === storage) registered = undefined; };
}
export function getPlatformSetting(key: string): string | null {
  if (!isPlatformSettingKey(key)) throw Error('settings-key');
  if (registered) return registered.getItem(key);
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key); }
  catch { return null; }
}
export function setPlatformSetting(key: string, value: string): void | Promise<void> {
  validatePlatformSetting(key, value);
  if (registered) return registered.setItem(key, value);
  if (typeof window === 'undefined') throw Error('settings-unavailable');
  window.localStorage.setItem(key, value);
}
export function removePlatformSetting(key: string): void | Promise<void> {
  if (!isPlatformSettingKey(key)) throw Error('settings-key');
  if (registered) return registered.removeItem(key);
  if (typeof window === 'undefined') throw Error('settings-unavailable');
  window.localStorage.removeItem(key);
}
export const platformSettingsStorage: PlatformSettingsStorage = {
  getItem: getPlatformSetting, setItem: setPlatformSetting, removeItem: removePlatformSetting,
};
