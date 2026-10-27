import { argon2d, argon2id } from 'hash-wasm';
import {
  Consts, CryptoEngine, Int64, Kdbx, KdbxCredentials, type KdbxEntry, ProtectedValue, VarDictionary,
} from 'kdbxweb';
import { checkHeader, fail, safeError } from './header';
import type { VaultEntryDraft, VaultEntrySummary } from './types';
import { MIN_MASTER_PASSWORD_LENGTH } from './policy';

export { checkBytes, checkHeader, fail, safeError, VAULT_MAX_BYTES } from './header';
export const VAULT_LINK_FIELD = 'KeepAny.LinkedAssetIds';
export const VAULT_AI_KEY_BINDING_FIELD = 'KeepAny.AiKeyBinding';
export const VAULT_USERNAME_ALIASES_FIELD = 'KeepAny.UsernameAliases';
export const VAULT_IMPORT_DRAFT_FIELD = 'KeepAny.ImportDraft';
export const VAULT_IMPORT_DRAFT_MAX_BYTES = 16 * 1024 * 1024;

/** Opaque application state lives only in the encrypted KDBX metadata body. */
export function encodeImportDraft(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') fail('vault-invalid');
  if (value.length > VAULT_IMPORT_DRAFT_MAX_BYTES || new TextEncoder().encode(value).byteLength > VAULT_IMPORT_DRAFT_MAX_BYTES) fail('vault-size');
  return JSON.stringify({ version: 1, payload: value });
}

export function readImportDraft(db: Kdbx): string | null {
  const item = db.meta.customData.get(VAULT_IMPORT_DRAFT_FIELD);
  if (!item) return null;
  if (typeof item.value !== 'string') fail('vault-invalid');
  // JSON escaping can expand a valid payload; bound it before JSON.parse.
  if (item.value.length > VAULT_IMPORT_DRAFT_MAX_BYTES * 6 + 128) fail('vault-size');
  let decoded: unknown;
  try { decoded = JSON.parse(item.value); } catch { fail('vault-invalid'); }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) fail('vault-invalid');
  const envelope = decoded as { version?: unknown; payload?: unknown };
  if (envelope.version !== 1 || typeof envelope.payload !== 'string') fail('vault-invalid');
  encodeImportDraft(envelope.payload);
  return envelope.payload;
}

const MAX_ENTRIES = 10_000;
const MAX_TEXT = 64 * 1024;

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

// kdbxweb delegates Argon2 to the application. hash-wasm implements both KeePass variants.
CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type, version) => {
  if (!integer(memory, 8 * parallelism, 128 * 1024) || !integer(iterations, 1, 10)
    || !integer(parallelism, 1, 4) || length !== 32 || version !== 0x13
    || (type !== CryptoEngine.Argon2TypeArgon2d && type !== CryptoEngine.Argon2TypeArgon2id)) fail('vault-kdf');
  const options = {
    password: new Uint8Array(password), salt: new Uint8Array(salt), memorySize: memory,
    iterations, parallelism, hashLength: length, outputType: 'binary' as const,
  };
  const result = await (type === CryptoEngine.Argon2TypeArgon2d ? argon2d(options) : argon2id(options));
  return result.slice().buffer;
});

export function credentials(password: string, creating = false): KdbxCredentials {
  if (typeof password !== 'string' || password.length > 1024 || password.length < (creating ? MIN_MASTER_PASSWORD_LENGTH : 1)) fail('vault-invalid');
  return new KdbxCredentials(ProtectedValue.fromString(password));
}

export function configureDatabase(db: Kdbx): void {
  db.setVersion(4);
  db.setKdf(Consts.KdfId.Argon2id);
  const params = db.header.kdfParameters;
  if (!params) fail('vault-invalid');
  params.set('M', VarDictionary.ValueType.UInt64, Int64.from(64 * 1024 * 1024));
  params.set('I', VarDictionary.ValueType.UInt64, Int64.from(3));
  params.set('P', VarDictionary.ValueType.UInt32, 1);
  params.set('V', VarDictionary.ValueType.UInt32, 0x13);
  db.header.compression = Consts.CompressionAlgorithm.None;
  db.meta.memoryProtection.password = true;
  db.meta.memoryProtection.notes = true;
  db.meta.recycleBinEnabled = true;
  db.createRecycleBin();
}

export async function loadDatabase(bytes: Uint8Array, key: KdbxCredentials): Promise<Kdbx> {
  checkHeader(bytes);
  let db: Kdbx | null = null;
  try {
    db = await Kdbx.load(bytes.slice().buffer, key);
    const entries = [...db.getDefaultGroup().allEntries()];
    if (entries.length > MAX_ENTRIES) fail('vault-size');
    for (const entry of entries) {
      if (entry.history.length > 1000) fail('vault-size');
      for (const item of [entry, ...entry.history]) {
        if (item.fields.size > 128) fail('vault-size');
        for (const value of item.fields.values()) {
          if ((typeof value === 'string' && value.length > MAX_TEXT)
            || (value instanceof ProtectedValue && value.byteLength > MAX_TEXT * 4)) fail('vault-size');
        }
      }
    }
    return db;
  } catch (error) { clearDatabase(db); clearCredentials(key); throw safeError(error); }
}

export function normalizeDraft(draft: VaultEntryDraft): VaultEntryDraft {
  if (!draft || typeof draft !== 'object') fail('vault-invalid');
  for (const field of ['title', 'username', 'password', 'url', 'notes'] as const) {
    if (typeof draft[field] !== 'string' || draft[field].length > MAX_TEXT || draft[field].includes('\0')) fail('vault-invalid');
  }
  if (!draft.title.trim() || draft.title.length > 256 || draft.username.length > 1024 || draft.url.length > 4096) fail('vault-invalid');
  if (draft.id !== undefined && (typeof draft.id !== 'string' || draft.id.length > 128)) fail('vault-invalid');
  if (draft.url) {
    try {
      const url = new URL(draft.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('vault-invalid');
    }
    catch { fail('vault-invalid'); }
  }
  if (!Array.isArray(draft.linkedAssetIds) || draft.linkedAssetIds.length > 100
    || draft.linkedAssetIds.some((id) => typeof id !== 'string' || id.length < 1 || id.length > 128 || id.includes('\0'))) fail('vault-invalid');
  if (draft.aiKeyBinding !== undefined && !validAiKeyBinding(draft.aiKeyBinding)) fail('vault-invalid');
  const { usernameAliases, ...fields } = draft;
  const aliases = normalizeUsernameAliases(usernameAliases, draft.username);
  return { ...fields, title: draft.title.trim(), linkedAssetIds: [...new Set(draft.linkedAssetIds)],
    ...(aliases ? { usernameAliases: aliases } : {}),
    ...(draft.aiKeyBinding ? { aiKeyBinding: { version: 1, provider: draft.aiKeyBinding.provider, baseURL: draft.aiKeyBinding.baseURL } } : {}) };
}

function normalizeUsernameAliases(value: unknown, username: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20
    || [...value].some((alias) => typeof alias !== 'string' || alias.length < 1 || alias.length > 1024 || alias.includes('\0'))) fail('vault-invalid');
  // Login identifiers are exact values: do not trim or case-fold them.
  const aliases = [...new Set(value.filter((alias) => alias !== username))];
  return aliases.length ? aliases : undefined;
}

function validAiKeyBinding(value: unknown): value is NonNullable<VaultEntryDraft['aiKeyBinding']> {
  if (!value || typeof value !== 'object') return false;
  const binding = value as Record<string, unknown>;
  if (binding.version !== 1 || typeof binding.provider !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(binding.provider)
    || typeof binding.baseURL !== 'string' || binding.baseURL.length > 2048) return false;
  try {
    const url = new URL(binding.baseURL);
    return (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      && !url.username && !url.password && !url.search && !url.hash && url.href.replace(/\/$/, '') === binding.baseURL;
  } catch { return false; }
}

function aiKeyBindingOf(entry: KdbxEntry): VaultEntryDraft['aiKeyBinding'] {
  try {
    const value: unknown = JSON.parse(text(entry, VAULT_AI_KEY_BINDING_FIELD));
    return validAiKeyBinding(value) ? { version: 1, provider: value.provider, baseURL: value.baseURL } : undefined;
  } catch { return undefined; }
}

function text(entry: KdbxEntry, field: string): string {
  const value = entry.fields.get(field);
  return value instanceof ProtectedValue ? value.getText() : value ?? '';
}

function links(entry: KdbxEntry): string[] {
  try {
    const parsed: unknown = JSON.parse(text(entry, VAULT_LINK_FIELD) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && id.length <= 128).slice(0, 100) : [];
  } catch { return []; }
}

function usernameAliasesOf(entry: KdbxEntry): string[] | undefined {
  const value = text(entry, VAULT_USERNAME_ALIASES_FIELD);
  if (!value) return undefined;
  try { return normalizeUsernameAliases(JSON.parse(value), text(entry, 'UserName')); }
  catch { return undefined; }
}

export function draftOf(entry: KdbxEntry): VaultEntryDraft {
  const aiKeyBinding = aiKeyBindingOf(entry);
  const usernameAliases = usernameAliasesOf(entry);
  return { id: entry.uuid.id, title: text(entry, 'Title'), username: text(entry, 'UserName'),
    password: text(entry, 'Password'), url: text(entry, 'URL'), notes: text(entry, 'Notes'), linkedAssetIds: links(entry),
    ...(usernameAliases ? { usernameAliases } : {}),
    ...(aiKeyBinding ? { aiKeyBinding } : {}) };
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? value : '';
  }
  catch { return ''; }
}

export function summaryOf(entry: KdbxEntry): VaultEntrySummary {
  const usernameAliases = usernameAliasesOf(entry);
  return { id: entry.uuid.id, title: text(entry, 'Title'), username: text(entry, 'UserName'),
    ...(usernameAliases ? { usernameAliases } : {}),
    url: safeUrl(text(entry, 'URL')), linkedAssetIds: links(entry),
    modifiedAt: (entry.times.lastModTime ?? new Date(0)).toISOString(), historyCount: entry.history.length };
}

export function applyDraft(entry: KdbxEntry, draft: VaultEntryDraft): void {
  entry.fields.set('Title', draft.title);
  entry.fields.set('UserName', draft.username);
  if (draft.usernameAliases?.length) entry.fields.set(VAULT_USERNAME_ALIASES_FIELD, ProtectedValue.fromString(JSON.stringify(draft.usernameAliases)));
  else entry.fields.delete(VAULT_USERNAME_ALIASES_FIELD);
  entry.fields.set('Password', ProtectedValue.fromString(draft.password));
  entry.fields.set('URL', draft.url);
  entry.fields.set('Notes', ProtectedValue.fromString(draft.notes));
  entry.fields.set(VAULT_LINK_FIELD, ProtectedValue.fromString(JSON.stringify(draft.linkedAssetIds)));
  if (draft.aiKeyBinding) entry.fields.set(VAULT_AI_KEY_BINDING_FIELD, ProtectedValue.fromString(JSON.stringify(draft.aiKeyBinding)));
  else entry.fields.delete(VAULT_AI_KEY_BINDING_FIELD);
  // KDBX dates have whole-second precision. Preserve distinct history/merge versions even
  // when users edit multiple times in one second and the file is serialized between edits.
  const previous = entry.lastModTime;
  entry.times.update();
  entry.times.lastModTime = nextKdbxTime(previous);
}

export function nextKdbxTime(previous: number): Date {
  return new Date(Math.max(Math.floor(Date.now() / 1000) * 1000, Math.floor(previous / 1000) * 1000 + 1000));
}

export function isTrash(db: Kdbx, entry: KdbxEntry): boolean {
  let group = entry.parentGroup;
  while (group) {
    if (group.uuid.id === db.meta.recycleBinUuid?.id) return true;
    group = group.parentGroup;
  }
  return false;
}

export function findEntry(db: Kdbx, id: string): KdbxEntry {
  const entry = [...db.getDefaultGroup().allEntries()].find((item) => item.uuid.id === id);
  if (!entry) fail('vault-missing');
  return entry;
}

export function clearDatabase(db: Kdbx | null): void {
  if (!db) return;
  for (const entry of db.getDefaultGroup().allEntries()) {
    for (const item of [entry, ...entry.history]) {
      for (const value of item.fields.values()) {
        if (value instanceof ProtectedValue) { value.value.fill(0); value.salt.fill(0); }
      }
      item.fields.clear();
    }
  }
  // CustomData strings cannot be zeroed, but release both the held item and map
  // references just as entry fields are released when the decrypted DB is discarded.
  const importDraft = db.meta.customData.get(VAULT_IMPORT_DRAFT_FIELD);
  if (importDraft) importDraft.value = undefined;
  db.meta.customData.delete(VAULT_IMPORT_DRAFT_FIELD);
  clearCredentials(db.credentials);
  db.xml = undefined;
}

export function clearCredentials(key: KdbxCredentials): void {
  for (const value of [key.passwordHash, key.keyFileHash]) {
    if (value) { value.value.fill(0); value.salt.fill(0); }
  }
  key.passwordHash = undefined;
  key.keyFileHash = undefined;
}

export function generatePassword(length = 24, symbols = true): string {
  if (!integer(length, 12, 128) || typeof symbols !== 'boolean') fail('vault-invalid');
  const categories = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789'];
  if (symbols) categories.push('!@#$%^&*()-_=+[]{};:,.?');
  const alphabet = categories.join('');
  const randomIndex = (size: number): number => {
    const byte = new Uint8Array(1);
    const limit = 256 - (256 % size);
    do { crypto.getRandomValues(byte); } while (byte[0] >= limit);
    return byte[0] % size;
  };
  // Rejection sampling over the entire alphabet preserves uniformity among valid passwords.
  for (;;) {
    const password = Array.from({ length }, () => alphabet[randomIndex(alphabet.length)]).join('');
    if (categories.every((category) => [...password].some((char) => category.includes(char)))) return password;
  }
}
