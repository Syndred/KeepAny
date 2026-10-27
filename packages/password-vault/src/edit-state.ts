import type { Kdbx, KdbxEditState } from 'kdbxweb';
import { fail } from './header';

// kdbxweb's remove-win history merge requires these local tombstones after reload.
// Keep them in the encrypted XML body, never in an ordinary preference/database.
export const VAULT_EDIT_STATE_FIELD = 'KeepAny.LocalEditState';
export const VAULT_EDIT_STATE_MAX_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const MAX_MARKS = 200_000;
const MAX_ENTRY_MARKS = 20_000;
const META_KEYS = [
  'mntncHistoryDaysChanged', 'colorChanged', 'keyChangeRecChanged',
  'keyChangeForceChanged', 'historyMaxItemsChanged', 'historyMaxSizeChanged',
  'lastSelectedGroupChanged', 'lastTopVisibleGroupChanged', 'memoryProtectionChanged',
] as const;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('vault-invalid');
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('vault-invalid');
}

export function decodeLocalEditState(encoded: string): KdbxEditState {
  if (typeof encoded !== 'string') fail('vault-invalid');
  if (encoded.length > VAULT_EDIT_STATE_MAX_BYTES || new TextEncoder().encode(encoded).byteLength > VAULT_EDIT_STATE_MAX_BYTES) fail('vault-size');
  let parsed: unknown;
  try { parsed = JSON.parse(encoded); } catch { fail('vault-invalid'); }
  const envelope = object(parsed);
  keys(envelope, ['version', 'state']);
  if (envelope.version !== 1) fail('vault-invalid');
  const input = object(envelope.state);
  keys(input, ['entries', 'meta']);
  const state: KdbxEditState = { entries: Object.create(null) };
  let total = 0;
  if (input.entries !== undefined) {
    const entries = object(input.entries);
    if (Object.keys(entries).length > MAX_ENTRIES) fail('vault-size');
    for (const [id, value] of Object.entries(entries)) {
      if (!/^[A-Za-z0-9+/]{22}==$/.test(id)) fail('vault-invalid');
      const entry = object(value);
      keys(entry, ['added', 'deleted']);
      const marks = (value: unknown): number[] => {
        if (!Array.isArray(value)) fail('vault-invalid');
        total += value.length;
        if (value.length > MAX_ENTRY_MARKS || total > MAX_MARKS) fail('vault-size');
        if (value.some(time => typeof time !== 'number' || !Number.isSafeInteger(time) || Math.abs(time) > 8_640_000_000_000_000)) fail('vault-invalid');
        return [...new Set(value as number[])];
      };
      if (state.entries) state.entries[id] = { added: marks(entry.added), deleted: marks(entry.deleted) };
    }
  }
  if (input.meta !== undefined) {
    const meta = object(input.meta);
    keys(meta, META_KEYS);
    state.meta = {};
    for (const key of META_KEYS) {
      const value = meta[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.length > 27) fail('vault-invalid');
      const date = new Date(value);
      if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) fail('vault-invalid');
      state.meta[key] = date;
    }
  }
  return state;
}

export function restoreLocalEditState(db: Kdbx): void {
  const item = db.meta.customData.get(VAULT_EDIT_STATE_FIELD);
  // Files produced before this metadata existed retain upstream's legacy behavior.
  if (!item) return;
  if (typeof item.value !== 'string') fail('vault-invalid');
  db.setLocalEditState(decodeLocalEditState(item.value));
}

export function persistLocalEditState(db: Kdbx): void {
  const encoded = JSON.stringify({ version: 1, state: db.getLocalEditState() });
  const state = decodeLocalEditState(encoded);
  // Normalize/deduplicate only tombstones; never union or rewrite history entries.
  db.setLocalEditState(state);
  db.meta.customData.set(VAULT_EDIT_STATE_FIELD, { value: JSON.stringify({ version: 1, state }) });
}
