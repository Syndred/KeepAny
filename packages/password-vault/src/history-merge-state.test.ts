import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kdbx } from 'kdbxweb';
import { expect, it } from 'vitest';
import { persistLocalEditState, restoreLocalEditState, VAULT_EDIT_STATE_FIELD } from './edit-state';
import { applyDraft, clearDatabase, configureDatabase, credentials, loadDatabase } from './engine';
import { VaultSession } from './session';
import type { VaultPersistence, VaultRecord } from './types';

class Storage implements VaultPersistence {
  record: VaultRecord | null = null;
  reject: 'vault-stale' | 'denied' | null = null;
  async read() { return this.record ? { ...this.record, bytes: this.record.bytes.slice() } : null; }
  async write(bytes: Uint8Array, expected: string | null) {
    if (this.reject) throw Error(this.reject);
    if ((this.record?.revision ?? null) !== expected) throw Error('vault-stale');
    this.record = { id: 'local' as const, revision: crypto.randomUUID(), updatedAt: new Date().toISOString(), bytes: bytes.slice() };
    return { ...this.record, bytes: this.record.bytes.slice() };
  }
}
const master = 'Synthetic-history-master-only';
const draft = { title: 'Synthetic merge entry', username: 'synthetic@example.test', password: 'Synthetic-history-secret', url: '', notes: 'version-0', linkedAssetIds: [] };
async function legacyFixture() {
  const db = Kdbx.create(credentials(master), 'Legacy synthetic history');
  configureDatabase(db);
  const entry = db.createEntry(db.getDefaultGroup());
  applyDraft(entry, draft);
  for (let i = 1; i <= 9; i++) { entry.pushHistory(); applyDraft(entry, { ...draft, notes: `version-${i}` }); }
  const bytes = new Uint8Array(await db.save()), id = entry.uuid.id;
  clearDatabase(db);
  return { bytes, id };
}

it('preserves every local history version when merging the older same-root file after an edit', async () => {
  const { bytes, id } = await legacyFixture();
  const storage = new Storage(), session = new VaultSession(storage);
  try {
    await session.initialize(); await session.importKdbx(bytes, master);
    expect(session.history(id).map(item => item.draft.notes)).toEqual(Array.from({ length: 9 }, (_, i) => `version-${i}`));
    await session.saveEntry({ ...session.readEntry(id), notes: 'local-current-version-10' });
    const before = session.history(id);
    expect(before.map(item => item.draft.notes)).toEqual(Array.from({ length: 10 }, (_, i) => `version-${i}`));
    await session.importKdbx(bytes, master);
    expect(session.readEntry(id).notes).toBe('local-current-version-10');
    expect(session.history(id)).toEqual(before);
  } finally { session.lock(); }
}, 60_000);

it('round-trips encrypted state through lock, a new session and a raw .kdbx file before repeated same-root merges', async () => {
  const { bytes, id } = await legacyFixture();
  const storage = new Storage(), session = new VaultSession(storage);
  const directory = await mkdtemp(join(tmpdir(), 'keepany-history-state-'));
  const reopened = new VaultSession(storage), restored = new VaultSession(new Storage());
  try {
    await session.initialize(); await session.importKdbx(bytes, master);
    // Adoption is still byte-for-byte; legacy absence does not fabricate marks.
    expect(await session.exportKdbx()).toEqual(bytes);
    await session.saveEntry({ ...session.readEntry(id), notes: 'local-current-version-10' });
    await session.writeImportDraft('Local encrypted draft survives old-file merge', session.getSnapshot().revision as string);
    const before = session.history(id), current = session.readEntry(id);
    session.lock(); await session.unlock(master);
    await session.importKdbx(bytes, master);
    expect(session.history(id)).toEqual(before);
    session.lock();
    await reopened.initialize(); await reopened.unlock(master);
    await reopened.importKdbx(bytes, master);
    expect(reopened.history(id)).toEqual(before);
    const exported = await reopened.exportKdbx();
    expect(new TextDecoder().decode(exported)).not.toContain(VAULT_EDIT_STATE_FIELD);
    await writeFile(join(directory, 'synthetic.kdbx'), exported);
    const fileBytes = new Uint8Array(await readFile(join(directory, 'synthetic.kdbx')));
    await restored.initialize(); await restored.importKdbx(fileBytes, master);
    expect(await restored.exportKdbx()).toEqual(fileBytes);
    for (let i = 0; i < 3; i++) {
      await restored.importKdbx(bytes, master);
      expect(restored.history(id)).toEqual(before);
      expect(restored.readEntry(id)).toEqual(current);
      expect(restored.readImportDraft()).toBe('Local encrypted draft survives old-file merge');
    }
    const decoded = await loadDatabase((await restored.exportKdbx()), credentials(master));
    try {
      expect(decoded.getLocalEditState().entries?.[id]?.added).toContain(new Date(before[9].at).getTime());
    } finally { clearDatabase(decoded); }
  } finally {
    session.lock(); reopened.lock(); restored.lock(); await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

it('honors persisted explicit history deletion and does not turn a remote history deletion into an unconditional union', async () => {
  const { bytes, id } = await legacyFixture();
  const local = await Kdbx.load(bytes.slice().buffer, credentials(master));
  const remote = await Kdbx.load(bytes.slice().buffer, credentials(master));
  const storage = new Storage(), session = new VaultSession(storage);
  try {
    const entry = local.getDefaultGroup().entries.find(value => value.uuid.id === id);
    if (!entry) throw Error('missing-synthetic-entry');
    entry.pushHistory(); applyDraft(entry, { ...draft, notes: 'local-current-version-10' });
    const deletedTime = entry.history[3].lastModTime;
    entry.removeHistory(3);
    local.meta.historyMaxItems = 77;
    persistLocalEditState(local);
    const encoded = new Uint8Array(await local.save());
    await session.initialize(); await session.importKdbx(encoded, master);
    session.lock(); await session.unlock(master);
    await session.importKdbx(bytes, master);
    expect(session.history(id).map(value => value.draft.notes)).toEqual(['version-0', 'version-1', 'version-2', 'version-4', 'version-5', 'version-6', 'version-7', 'version-8', 'version-9']);
    const decoded = await loadDatabase(await session.exportKdbx(), credentials(master));
    try {
      expect(decoded.meta.historyMaxItems).toBe(77);
      expect(decoded.getLocalEditState().meta?.historyMaxItemsChanged).toBeInstanceOf(Date);
      expect(decoded.getLocalEditState().entries?.[id]?.deleted).toContain(deletedTime);
    } finally { clearDatabase(decoded); }
    // Removing an unmarked legacy version remotely must still remove it locally.
    remote.getDefaultGroup().entries[0].removeHistory(4);
    const remoteBytes = new Uint8Array(await remote.save());
    await session.importKdbx(remoteBytes, master);
    expect(session.history(id).some(value => value.draft.notes === 'version-4')).toBe(false);
    expect(session.history(id).some(value => value.draft.notes === 'version-9')).toBe(true);
  } finally { session.lock(); clearDatabase(local); clearDatabase(remote); }
}, 60_000);

it('keeps a purged entry and its complete history deleted after reopen and importing an older file', async () => {
  const { bytes, id } = await legacyFixture();
  const storage = new Storage(), session = new VaultSession(storage), reopened = new VaultSession(storage);
  try {
    await session.initialize(); await session.importKdbx(bytes, master);
    const keep = await session.saveEntry({ ...draft, title: 'Keep independent active entry' });
    await session.saveEntry({ ...session.readEntry(id), notes: 'local-current-version-10' });
    await session.trashEntry(id);
    await session.purgeEntries([id], session.getSnapshot().contentRevision as string);
    session.lock(); await reopened.initialize(); await reopened.unlock(master);
    await reopened.importKdbx(bytes, master);
    expect(() => reopened.readEntry(id)).toThrow('vault-missing');
    expect(() => reopened.history(id)).toThrow('vault-missing');
    expect(reopened.getSnapshot().entries.map(value => value.id)).toEqual([keep]);
    expect(reopened.getSnapshot().trash).toEqual([]);
    const decoded = await loadDatabase(await reopened.exportKdbx(), credentials(master));
    try {
      expect(decoded.deletedObjects.some(value => value.uuid?.id === id)).toBe(true);
      expect(decoded.getLocalEditState().entries?.[id]).toBeUndefined();
    } finally { clearDatabase(decoded); }
  } finally { session.lock(); reopened.lock(); }
}, 60_000);

for (const rejection of ['vault-stale', 'denied'] as const) it(`preserves ciphertext, visible history and draft after ${rejection} and retries with the same history`, async () => {
  const { bytes, id } = await legacyFixture();
  const storage = new Storage(), session = new VaultSession(storage);
  try {
    await session.initialize(); await session.importKdbx(bytes, master);
    await session.saveEntry({ ...session.readEntry(id), notes: 'local-current-version-10' });
    await session.writeImportDraft('Local private draft retained', session.getSnapshot().revision as string);
    const before = session.history(id), current = session.readEntry(id), record = await storage.read();
    storage.reject = rejection;
    await expect(session.importKdbx(bytes, master)).rejects.toThrow(rejection === 'denied' ? 'vault-storage' : rejection);
    expect(await storage.read()).toEqual(record);
    expect(session.history(id)).toEqual(before);
    expect(session.readEntry(id)).toEqual(current);
    expect(session.readImportDraft()).toBe('Local private draft retained');
    storage.reject = null;
    await session.importKdbx(bytes, master);
    expect(session.history(id)).toEqual(before);
  } finally { session.lock(); }
}, 60_000);

it('loads old files without state unchanged and rejects corrupt state before replacing an existing vault', async () => {
  const { bytes } = await legacyFixture();
  const db = await Kdbx.load(bytes.slice().buffer, credentials(master));
  const session = new VaultSession(new Storage());
  try {
    restoreLocalEditState(db);
    expect(db.getLocalEditState()).toEqual({ entries: {} });
    await session.initialize(); await session.importKdbx(bytes, master);
    const before = await session.exportKdbx();
    db.meta.customData.set(VAULT_EDIT_STATE_FIELD, { value: '{"version":1,"state":{"entries":{"__proto__":{"added":[],"deleted":[]}}}}' });
    await expect(session.importKdbx(new Uint8Array(await db.save()), master)).rejects.toThrow('vault-invalid');
    expect(await session.exportKdbx()).toEqual(before);
  } finally { session.lock(); clearDatabase(db); }
}, 60_000);
