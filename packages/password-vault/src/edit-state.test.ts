import { KdbxUuid } from 'kdbxweb';
import { expect, it } from 'vitest';
import { decodeLocalEditState, VAULT_EDIT_STATE_MAX_BYTES } from './edit-state';

const id = 'AAAAAAAAAAAAAAAAAAAAAA==';
const encode = (state: unknown) => JSON.stringify({ version: 1, state });
it('decodes all supported meta Date markers and keeps distinct added/deleted marks without aliasing', () => {
  const dates = Object.fromEntries([
    'mntncHistoryDaysChanged', 'colorChanged', 'keyChangeRecChanged', 'keyChangeForceChanged',
    'historyMaxItemsChanged', 'historyMaxSizeChanged', 'lastSelectedGroupChanged',
    'lastTopVisibleGroupChanged', 'memoryProtectionChanged',
  ].map(key => [key, '2026-10-27T00:00:00.000Z']));
  const state = decodeLocalEditState(encode({ entries: { [id]: { added: [1000, 1000, 2000], deleted: [3000, 3000] } }, meta: dates }));
  expect(Object.getPrototypeOf(state.entries)).toBeNull();
  expect(state.entries?.[id]).toEqual({ added: [1000, 2000], deleted: [3000] });
  for (const value of Object.values(state.meta ?? {})) {
    expect(value).toBeInstanceOf(Date);
    expect(value.toISOString()).toBe('2026-10-27T00:00:00.000Z');
  }
});

it.each([
  'null', '[]', '{}', '{', '{"version":2,"state":{}}',
  '{"version":1,"state":{},"other":1}',
  encode({ entries: [], meta: {} }), encode({ entries: { [id]: [] } }),
  encode({ entries: { [id]: { added: [], deleted: [], secret: 'unexpected' } } }),
  encode({ entries: { [id]: { added: [1.5], deleted: [] } } }),
  encode({ entries: { [id]: { added: [Number.MAX_SAFE_INTEGER], deleted: [] } } }),
  encode({ entries: { [id]: { added: ['1000'], deleted: [] } } }),
  encode({ entries: { [id]: { added: [], deleted: null } } }),
  encode({ meta: { colorChanged: 'invalid-date' } }),
  encode({ meta: { colorChanged: '2026-10-27' } }),
  encode({ meta: { colorChanged: 1000 } }), encode({ meta: { unexpected: '2026-10-27T00:00:00.000Z' } }),
  '{"version":1,"state":{"entries":{"__proto__":{"added":[],"deleted":[]}}}}',
])('rejects invalid or unsupported encrypted state %#', encoded => {
  expect(() => decodeLocalEditState(encoded)).toThrow('vault-invalid');
});

it('bounds UTF-8 bytes, entries, per-entry markers and total markers before applying state', () => {
  expect(() => decodeLocalEditState(' '.repeat(VAULT_EDIT_STATE_MAX_BYTES + 1))).toThrow('vault-size');
  expect(() => decodeLocalEditState('界'.repeat(Math.floor(VAULT_EDIT_STATE_MAX_BYTES / 3) + 1))).toThrow('vault-size');
  expect(() => decodeLocalEditState(encode({ entries: { [id]: { added: Array(20_001).fill(1), deleted: [] } } }))).toThrow('vault-size');
  const manyEntries = Object.fromEntries(Array.from({ length: 10_001 }, () => [KdbxUuid.random().id, { added: [], deleted: [] }]));
  expect(() => decodeLocalEditState(encode({ entries: manyEntries }))).toThrow('vault-size');
  const manyMarks = Object.fromEntries(Array.from({ length: 11 }, () => [KdbxUuid.random().id, { added: Array(20_000).fill(1), deleted: [] }]));
  expect(() => decodeLocalEditState(encode({ entries: manyMarks }))).toThrow('vault-size');
});
