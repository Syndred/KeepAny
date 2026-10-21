import { gzipSync } from 'fflate';
import { Consts, Int64, Kdbx, ProtectedValue, VarDictionary, XmlUtils } from 'kdbxweb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkHeader, configureDatabase, credentials, VAULT_AI_KEY_BINDING_FIELD, VAULT_IMPORT_DRAFT_FIELD, VAULT_LINK_FIELD, VAULT_USERNAME_ALIASES_FIELD } from './engine';
import { generatePassword, VAULT_IMPORT_DRAFT_MAX_BYTES, VAULT_IMPORT_MAX_ENTRIES, VAULT_MAX_BYTES, VaultSession } from './index';
import type { VaultEntryDraft, VaultPersistence, VaultRecord } from './types';

const master = 'synthetic-master-v1';
const nextMaster = 'synthetic-master-v2';
const draft: VaultEntryDraft = {
  title: 'Synthetic mail', username: 'synthetic@example.test', password: 'synthetic-secret-P4ss!',
  url: 'https://example.test/login', notes: 'Synthetic private note', linkedAssetIds: ['synthetic-account-id'],
};

class MemoryStorage implements VaultPersistence {
  record: VaultRecord | null = null;
  writes = 0;
  async read(): Promise<VaultRecord | null> { return this.record ? { ...this.record, bytes: this.record.bytes.slice() } : null; }
  async write(bytes: Uint8Array, expectedRevision: string | null): Promise<VaultRecord> {
    if ((this.record?.revision ?? null) !== expectedRevision) throw new Error('vault-stale');
    this.writes += 1;
    this.record = { id: 'local', revision: `revision-${this.writes}`, updatedAt: new Date().toISOString(), bytes: bytes.slice() };
    return { ...this.record, bytes: this.record.bytes.slice() };
  }
}

async function created() {
  const storage = new MemoryStorage();
  const session = new VaultSession(storage);
  await session.initialize();
  await session.create(master);
  return { storage, session };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

describe('encrypted recoverable import drafts', () => {
  const payload = JSON.stringify({ version: 1, source: 'Synthetic source secret', candidates: [{ password: 'Synthetic unreviewed secret' }] });

  it('restores exact encrypted draft state after reopen, without exposing entries, and preserves it through rotation/export', async () => {
    const { session, storage } = await created();
    const before = session.getSnapshot();
    expect(session.readImportDraft()).toBeNull();
    const revision = await session.writeImportDraft(payload, before.revision as string);
    expect(revision).not.toBe(before.revision);
    expect(session.getSnapshot()).toMatchObject({ revision, contentRevision: before.contentRevision, entries: [], trash: [] });
    expect(session.readImportDraft()).toBe(payload);
    expect(new TextDecoder().decode(storage.record?.bytes)).not.toContain('Synthetic source secret');
    expect(JSON.stringify(session.getSnapshot())).not.toContain('Synthetic');
    const writes = storage.writes;
    expect(await session.writeImportDraft(payload, revision)).toBe(revision);
    expect(storage.writes).toBe(writes);
    const heldDb = (session as unknown as { db: Kdbx }).db;
    const heldItem = heldDb.meta.customData.get(VAULT_IMPORT_DRAFT_FIELD);
    session.lock();
    expect(heldItem?.value).toBeUndefined();
    expect(heldDb.meta.customData.has(VAULT_IMPORT_DRAFT_FIELD)).toBe(false);
    expect(() => session.readImportDraft()).toThrow('vault-locked');
    await expect(session.writeImportDraft(payload, revision)).rejects.toThrow('vault-locked');
    const reopened = new VaultSession(storage);
    await reopened.initialize();
    await reopened.unlock(master);
    expect(reopened.readImportDraft()).toBe(payload);
    expect(reopened.getSnapshot().contentRevision).toBe(before.contentRevision);
    await reopened.changeMasterPassword(master, nextMaster);
    expect(reopened.getSnapshot().contentRevision).not.toBe(before.contentRevision);
    const restored = new VaultSession(new MemoryStorage());
    await restored.initialize();
    await restored.importKdbx(await reopened.exportKdbx(), nextMaster);
    expect(restored.readImportDraft()).toBe(payload);
    expect(restored.getSnapshot()).toMatchObject({ entries: [], trash: [] });
    const stableContent = restored.getSnapshot().contentRevision;
    await restored.writeImportDraft(null, restored.getSnapshot().revision as string);
    expect(restored.readImportDraft()).toBeNull();
    expect(restored.getSnapshot().contentRevision).toBe(stableContent);
    restored.lock();
    await restored.unlock(nextMaster);
    expect(restored.readImportDraft()).toBeNull();
  }, 30_000);

  it('leaves the earlier draft intact after write failure and checks durable revisions even for no-ops', async () => {
    const { session, storage } = await created();
    const revision = await session.writeImportDraft(payload, session.getSnapshot().revision as string);
    const snapshot = session.getSnapshot();
    const bytes = storage.record?.bytes.slice();
    vi.spyOn(storage, 'write').mockRejectedValueOnce(new Error('synthetic failure'));
    await expect(session.writeImportDraft('replacement', revision)).rejects.toThrow('vault-invalid');
    expect(session.readImportDraft()).toBe(payload);
    expect(session.getSnapshot()).toBe(snapshot);
    expect(storage.record?.bytes).toEqual(bytes);
    const second = new VaultSession(storage);
    await second.initialize();
    await second.unlock(master);
    await second.writeImportDraft('other tab draft', revision);
    await expect(session.writeImportDraft(payload, revision)).rejects.toThrow('vault-stale');
    expect(session.readImportDraft()).toBe(payload);
    session.lock();
    await session.unlock(master);
    expect(session.readImportDraft()).toBe('other tab draft');
  }, 30_000);

  it('rejects lock or cross-tab CAS during encryption without replacing the prior draft', async () => {
    for (const interruptedBy of ['lock', 'other-tab']) {
      const { session, storage } = await created();
      const revision = await session.writeImportDraft(payload, session.getSnapshot().revision as string);
      const other = new VaultSession(storage);
      await other.initialize();
      await other.unlock(master);
      const reached = deferred();
      const resume = deferred();
      const originalSave = Kdbx.prototype.save;
      const spy = vi.spyOn(Kdbx.prototype, 'save').mockImplementationOnce(async function (this: Kdbx) {
        reached.resolve();
        await resume.promise;
        return originalSave.call(this);
      });
      const pending = session.writeImportDraft('losing replacement', revision);
      const rejected = expect(pending).rejects.toThrow(interruptedBy === 'lock' ? 'vault-locked' : 'vault-stale');
      await reached.promise;
      if (interruptedBy === 'lock') session.lock();
      else await other.writeImportDraft('winning replacement', revision);
      const bytes = storage.record?.bytes.slice();
      resume.resolve();
      await rejected;
      spy.mockRestore();
      expect(storage.record?.bytes).toEqual(bytes);
      if (interruptedBy === 'other-tab') expect(session.readImportDraft()).toBe(payload);
      session.lock();
      await session.unlock(master);
      expect(session.readImportDraft()).toBe(interruptedBy === 'lock' ? payload : 'winning replacement');
    }
  }, 30_000);

  it('preserves local draft or explicit deletion when merging a same-vault backup', async () => {
    const { session } = await created();
    await session.writeImportDraft('old backup draft', session.getSnapshot().revision as string);
    const backup = await session.exportKdbx();
    await session.writeImportDraft(payload, session.getSnapshot().revision as string);
    const beforeMerge = session.getSnapshot().contentRevision;
    await session.importKdbx(backup, master);
    expect(session.readImportDraft()).toBe(payload);
    expect(session.getSnapshot().contentRevision).not.toBe(beforeMerge);
    await session.writeImportDraft(null, session.getSnapshot().revision as string);
    await session.importKdbx(backup, master);
    expect(session.readImportDraft()).toBeNull();
    session.lock();
    await session.unlock(master);
    expect(session.readImportDraft()).toBeNull();
  }, 30_000);

  it('keeps a legacy content revision stable during draft writes but advances it for real entries', async () => {
    const { session, storage } = await created();
    const legacy = await Kdbx.load((await session.exportKdbx()).slice().buffer, credentials(master));
    legacy.meta.customData.delete('KeepAny.ContentRevision');
    if (!storage.record) throw Error('missing synthetic record');
    storage.record.bytes = new Uint8Array(await legacy.save());
    session.lock();
    await session.unlock(master);
    const legacyRevision = session.getSnapshot().revision;
    expect(session.getSnapshot().contentRevision).toBe(legacyRevision);
    await session.writeImportDraft(payload, legacyRevision as string);
    expect(session.getSnapshot().contentRevision).toBe(legacyRevision);
    session.lock();
    await session.unlock(master);
    expect(session.getSnapshot().contentRevision).toBe(legacyRevision);
    await session.saveEntry(draft);
    expect(session.getSnapshot().contentRevision).not.toBe(legacyRevision);
    expect(session.readImportDraft()).toBe(payload);
  }, 30_000);

  it('bounds payloads and validates saved envelopes without echoing any source content', async () => {
    const { session, storage } = await created();
    const revision = session.getSnapshot().revision as string;
    const writes = storage.writes;
    await expect(session.writeImportDraft('x'.repeat(VAULT_IMPORT_DRAFT_MAX_BYTES + 1), revision)).rejects.toThrow('vault-size');
    await expect(session.writeImportDraft('界'.repeat(Math.floor(VAULT_IMPORT_DRAFT_MAX_BYTES / 3) + 1), revision)).rejects.toThrow('vault-size');
    await expect(session.writeImportDraft(4 as unknown as string, revision)).rejects.toThrow('vault-invalid');
    await expect(session.writeImportDraft(payload, '')).rejects.toThrow('vault-invalid');
    expect(storage.writes).toBe(writes);
    const db = (session as unknown as { db: Kdbx }).db;
    for (const value of ['secret malformed JSON', JSON.stringify({ version: 2, payload: 'future' }), JSON.stringify({ version: 1, payload: 42 })]) {
      db.meta.customData.set(VAULT_IMPORT_DRAFT_FIELD, { value });
      expect(() => session.readImportDraft()).toThrow('vault-invalid');
    }
    db.meta.customData.set(VAULT_IMPORT_DRAFT_FIELD, { value: JSON.stringify({ version: 1, payload: 'x'.repeat(VAULT_IMPORT_DRAFT_MAX_BYTES + 1) }) });
    expect(() => session.readImportDraft()).toThrow('vault-size');
    db.meta.customData.delete(VAULT_IMPORT_DRAFT_FIELD);
    expect(session.getSnapshot()).toMatchObject({ entries: [], trash: [] });
  }, 30_000);
});

describe('real encrypted local KDBX session', () => {
  it('keeps exact additional login identifiers protected through editing, history and KDBX restore', async () => {
    const { storage, session } = await created();
    const id = await session.saveEntry(draft);
    expect(session.readEntry(id)).toEqual({ ...draft, id });
    expect(session.getSnapshot().entries[0]).not.toHaveProperty('usernameAliases');
    const legacy = await Kdbx.load((await session.exportKdbx()).slice().buffer, credentials(master));
    expect(legacy.getDefaultGroup().entries[0].fields.has(VAULT_USERNAME_ALIASES_FIELD)).toBe(false);

    const aliases = ['Synthetic@example.test', 'synthetic-alternate@example.test', '  Synthetic handle  ', '+15550123456'];
    await session.saveEntry({ ...draft, id, usernameAliases: [draft.username, ...aliases, aliases[1]] });
    expect(session.readEntry(id)).toEqual({ ...draft, id, usernameAliases: aliases });
    expect(session.getSnapshot().entries[0].usernameAliases).toEqual(aliases);
    expect(session.history(id)[0].draft).not.toHaveProperty('usernameAliases');
    const bytes = await session.exportKdbx();
    const plaintextProbe = new TextDecoder().decode(bytes);
    for (const alias of aliases) expect(plaintextProbe).not.toContain(alias);
    const upstream = await Kdbx.load(bytes.slice().buffer, credentials(master));
    const protectedAliases = upstream.getDefaultGroup().entries[0].fields.get(VAULT_USERNAME_ALIASES_FIELD);
    expect(protectedAliases).toBeInstanceOf(ProtectedValue);
    expect(JSON.parse((protectedAliases as ProtectedValue).getText())).toEqual(aliases);

    session.lock();
    expect(session.getSnapshot().entries).toEqual([]);
    const reopened = new VaultSession(storage);
    await reopened.initialize();
    await reopened.unlock(master);
    expect(reopened.readEntry(id).usernameAliases).toEqual(aliases);
    await reopened.saveEntry({ ...draft, id, usernameAliases: [] });
    expect(reopened.readEntry(id)).not.toHaveProperty('usernameAliases');
    expect(reopened.history(id)[1].draft.usernameAliases).toEqual(aliases);
    const removed = await Kdbx.load((await reopened.exportKdbx()).slice().buffer, credentials(master));
    expect(removed.getDefaultGroup().entries[0].fields.has(VAULT_USERNAME_ALIASES_FIELD)).toBe(false);
    expect(removed.getDefaultGroup().entries[0].history[1].fields.get(VAULT_USERNAME_ALIASES_FIELD)).toBeInstanceOf(ProtectedValue);
    await reopened.restoreHistory(id, 1);
    expect(reopened.readEntry(id).usernameAliases).toEqual(aliases);
    const restored = new VaultSession(new MemoryStorage());
    await restored.initialize();
    await restored.importKdbx(await reopened.exportKdbx(), master);
    expect(restored.readEntry(id)).toEqual({ ...draft, id, usernameAliases: aliases });
    expect(restored.history(id)[1].draft.usernameAliases).toEqual(aliases);
  }, 30_000);

  it('keeps separate platform accounts independent even when their login aliases overlap', async () => {
    const { session } = await created();
    const first = { ...draft, usernameAliases: ['synthetic-shared@example.test', 'second-user'] };
    const second = { ...draft, username: 'second-user', usernameAliases: [draft.username, 'synthetic-shared@example.test'] };
    const result = await session.importEntries([{ draft: first }, { draft: second }], session.getSnapshot().revision as string);
    expect(result).toMatchObject({ added: 2, updated: 0, skipped: 0 });
    expect(result.entryIds[0]).not.toBe(result.entryIds[1]);
    expect(session.getSnapshot().entries).toHaveLength(2);
    expect(session.readEntry(result.entryIds[0])).toMatchObject(first);
    expect(session.readEntry(result.entryIds[1])).toMatchObject(second);
    const preview = session.previewImport([{ ...second, password: 'Synthetic second-account replacement' }]);
    expect(preview.rows[0]).toEqual({ index: 0, status: 'conflict', existingIds: [result.entryIds[1]] });
    session.lock();
    await session.unlock(master);
    expect(session.readEntry(result.entryIds[0])).toMatchObject(first);
    expect(session.readEntry(result.entryIds[1])).toMatchObject(second);
  }, 30_000);

  it('requires an explicit same-password alias update and keeps exact repeats as no-ops', async () => {
    const { storage, session } = await created();
    const id = await session.saveEntry(draft);
    const revision = session.getSnapshot().revision as string;
    const next = { ...draft, usernameAliases: ['Synthetic second login', '+15550129876'] };
    expect(session.previewImport([next]).rows[0]).toMatchObject({ status: 'duplicate', existingIds: [id] });
    const implicit = await session.importEntries([{ draft: next }], revision);
    expect(implicit).toMatchObject({ added: 0, updated: 0, skipped: 1, revision });
    expect(session.readEntry(id)).not.toHaveProperty('usernameAliases');
    const explicit = await session.importEntries([{ draft: next, action: 'update', targetId: id }], revision);
    expect(explicit).toMatchObject({ added: 0, updated: 1, skipped: 0, entryIdsByRow: [id] });
    expect(session.getSnapshot().entries).toHaveLength(1);
    expect(session.readEntry(id)).toMatchObject(next);
    expect(session.history(id)[0].draft).not.toHaveProperty('usernameAliases');
    const writes = storage.writes;
    const repeat = await session.importEntries([{ draft: { ...next, usernameAliases: [draft.username, ...next.usernameAliases, next.usernameAliases[0]] }, action: 'update', targetId: id }], explicit.revision);
    expect(repeat).toMatchObject({ added: 0, updated: 0, skipped: 1, revision: explicit.revision });
    expect(storage.writes).toBe(writes);
    const removed = await session.importEntries([{ draft, action: 'update', targetId: id }], explicit.revision);
    expect(removed).toMatchObject({ added: 0, updated: 1, skipped: 0 });
    expect(session.readEntry(id)).not.toHaveProperty('usernameAliases');
    expect(session.history(id).at(-1)?.draft.usernameAliases).toEqual(next.usernameAliases);
  }, 30_000);

  it('rejects invalid additional login identifiers before cloning or mutating encrypted entries', async () => {
    const { storage, session } = await created();
    const before = storage.record?.bytes.slice();
    const revision = session.getSnapshot().revision as string;
    const writes = storage.writes;
    const load = vi.spyOn(Kdbx, 'load');
    for (const usernameAliases of [null, 'synthetic alias', [''], ['synthetic\0alias'], ['x'.repeat(1025)], [12], Array(1), Array(21).fill('same exact value')]) {
      const invalid = { ...draft, usernameAliases } as VaultEntryDraft;
      await expect(session.saveEntry(invalid)).rejects.toThrow('vault-invalid');
      await expect(session.importEntries([{ draft: invalid }], revision)).rejects.toThrow('vault-invalid');
      expect(() => session.previewImport([invalid])).toThrow('vault-invalid');
    }
    expect(load).not.toHaveBeenCalled();
    expect(storage.writes).toBe(writes);
    expect(storage.record?.bytes).toEqual(before);
    const aliases = Array.from({ length: 20 }, (_, index) => `Synthetic alias ${index}`);
    aliases[0] = 'x'.repeat(1024);
    const id = await session.saveEntry({ ...draft, usernameAliases: aliases });
    expect(session.readEntry(id).usernameAliases).toEqual(aliases);
  }, 30_000);

  it('keeps model-service authorization encrypted across refresh, key editing and KDBX export/restore', async () => {
    const { storage, session } = await created();
    const aiKeyBinding = { version: 1 as const, provider: 'deepseek', baseURL: 'https://api.deepseek.com' };
    const keyDraft = { ...draft, title: 'DeepSeek API Key', password: 'Synthetic-model-key-42', aiKeyBinding };
    const id = await session.saveEntry(keyDraft);
    const bytes = await session.exportKdbx();
    expect(new TextDecoder().decode(bytes)).not.toContain(keyDraft.password);
    expect(new TextDecoder().decode(bytes)).not.toContain(aiKeyBinding.baseURL);
    expect(JSON.stringify(session.getSnapshot())).not.toContain('aiKeyBinding');
    const upstream = await Kdbx.load(bytes.slice().buffer, credentials(master));
    const field = [...upstream.getDefaultGroup().allEntries()][0].fields.get(VAULT_AI_KEY_BINDING_FIELD);
    expect(field).toBeInstanceOf(ProtectedValue);
    expect(JSON.parse((field as ProtectedValue).getText())).toEqual(aiKeyBinding);
    session.lock();
    const reopened = new VaultSession(storage);
    await reopened.initialize();
    await reopened.unlock(master);
    expect(reopened.readEntry(id)).toEqual({ ...keyDraft, id });
    await reopened.saveEntry({ ...reopened.readEntry(id), password: 'Synthetic-rotated-key-43' });
    expect(reopened.history(id)[0].draft.aiKeyBinding).toEqual(aiKeyBinding);
    const target = new VaultSession(new MemoryStorage());
    await target.initialize();
    await target.importKdbx(await reopened.exportKdbx(), master);
    expect(target.readEntry(id)).toMatchObject({ password: 'Synthetic-rotated-key-43', aiKeyBinding });
    const { aiKeyBinding: removedBinding, id: importedId, ...ordinaryLogin } = reopened.readEntry(id);
    expect(removedBinding).toEqual(aiKeyBinding);
    expect(importedId).toBe(id);
    await reopened.importEntries([{ draft: { ...ordinaryLogin, password: 'Synthetic-imported-login-44' }, action: 'update', targetId: id }], reopened.getSnapshot().revision as string);
    expect(reopened.readEntry(id).aiKeyBinding).toBeUndefined();
    expect(reopened.history(id).at(-1)?.draft.aiKeyBinding).toEqual(aiKeyBinding);
    for (const invalid of [{ ...aiKeyBinding, baseURL: 'http://remote.example' }, { ...aiKeyBinding, version: 2 }, { ...aiKeyBinding, provider: '' }]) {
      await expect(reopened.saveEntry({ ...keyDraft, aiKeyBinding: invalid as typeof aiKeyBinding })).rejects.toThrow('vault-invalid');
    }
  }, 30_000);

  it('creates Argon2id KDBX4, keeps secrets out of persistence/summaries, and enforces lock and wrong master', async () => {
    const { storage, session } = await created();
    const unchangedSnapshot = session.getSnapshot();
    expect(session.getSnapshot()).toBe(unchangedSnapshot);
    const changed = vi.fn();
    const unsubscribe = session.subscribe(changed);
    const id = await session.saveEntry(draft);
    expect(changed).toHaveBeenCalledOnce();
    unsubscribe();
    const bytes = await session.exportKdbx();
    const plaintextProbe = new TextDecoder().decode(bytes);
    for (const secret of [master, draft.password, draft.notes, draft.linkedAssetIds[0]]) expect(plaintextProbe).not.toContain(secret);
    expect(JSON.stringify(session.getSnapshot())).not.toContain(draft.password);
    expect(JSON.stringify(session.getSnapshot())).not.toContain(draft.notes);
    const upstream = await Kdbx.load(bytes.slice().buffer, credentials(master));
    expect(upstream.versionMajor).toBe(4);
    expect(upstream.header.compression).toBe(Consts.CompressionAlgorithm.None);
    const params = upstream.header.kdfParameters;
    if (!params) throw new Error('missing synthetic KDF parameters');
    expect((params.get('M') as Int64).value).toBe(64 * 1024 * 1024);
    expect((params.get('I') as Int64).value).toBe(3);
    const entry = [...upstream.getDefaultGroup().allEntries()][0];
    expect(entry.fields.get('Password')).toBeInstanceOf(ProtectedValue);
    expect(entry.fields.get(VAULT_LINK_FIELD)).toBeInstanceOf(ProtectedValue);
    expect((entry.fields.get('Password') as ProtectedValue).getText()).toBe(draft.password);
    const persisted = storage.record?.bytes.slice();
    session.lock();
    expect(session.getSnapshot()).toMatchObject({ status: 'locked', entries: [], trash: [] });
    expect(() => session.readEntry(id)).toThrow('vault-locked');
    expect(() => session.history(id)).toThrow('vault-locked');
    await expect(session.exportKdbx()).rejects.toThrow('vault-locked');
    await expect(session.unlock('incorrect-master')).rejects.toThrow('vault-password');
    expect(storage.record?.bytes).toEqual(persisted);
    expect(session.getSnapshot().status).toBe('locked');
    await session.unlock(master);
    expect(session.readEntry(id)).toEqual({ ...draft, id });
  }, 30_000);

  it('edits and restores password history and recycle bin with stable UUIDs after reload', async () => {
    const { storage, session } = await created();
    const id = await session.saveEntry({ ...draft, linkedAssetIds: [] });
    await session.saveEntry({ ...draft, id, password: 'replacement-secret-02', title: 'Updated entry', linkedAssetIds: [] });
    expect(session.history(id)).toHaveLength(1);
    expect(session.history(id)[0].draft.password).toBe(draft.password);
    await session.restoreHistory(id, 0);
    expect(session.readEntry(id).password).toBe(draft.password);
    expect(session.history(id)).toHaveLength(2);
    await session.trashEntry(id);
    expect(session.getSnapshot().entries).toEqual([]);
    expect(session.getSnapshot().trash[0].id).toBe(id);
    session.lock();
    const reloaded = new VaultSession(storage);
    await reloaded.initialize();
    await reloaded.unlock(master);
    expect(reloaded.getSnapshot().trash[0].id).toBe(id);
    await reloaded.restoreEntry(id);
    expect(reloaded.getSnapshot().trash).toEqual([]);
    expect(reloaded.readEntry(id).password).toBe(draft.password);
    expect(reloaded.history(id)).toHaveLength(2);
  }, 30_000);

  it('imports an entire batch with one clone and one encrypted save while preserving password whitespace', async () => {
    const { storage, session } = await created();
    const values = Array.from({ length: 100 }, (_, index) => ({
      ...draft,
      username: `synthetic-${index}@example.test`,
      password: `  secret-${index}\t `,
    }));
    const load = vi.spyOn(Kdbx, 'load');
    const save = vi.spyOn(Kdbx.prototype, 'save');
    const preview = session.previewImport(values);
    expect(preview.rows).toHaveLength(100);
    expect(preview.rows.every((row) => row.status === 'new')).toBe(true);
    expect(JSON.stringify(preview)).not.toContain('secret-');
    expect(storage.writes).toBe(1);
    const result = await session.importEntries(
      values.map((value) => ({ draft: value })),
      preview.revision,
    );
    expect(result).toMatchObject({ added: 100, updated: 0, skipped: 0 });
    expect(result.entryIds).toHaveLength(100);
    expect(new Set(result.entryIds).size).toBe(100);
    expect(load).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(storage.writes).toBe(2);
    expect(session.readEntry(result.entryIds[0]).password).toBe(
      values[0].password,
    );
    session.lock();
    await session.unlock(master);
    expect(session.readEntry(result.entryIds[99]).password).toBe(
      values[99].password,
    );
  }, 30_000);

  it('skips exact credential duplicates, defaults conflicts to skip, and uses exact URL or title identity', async () => {
    const { storage, session } = await created();
    const id = await session.saveEntry(draft);
    const noUrl = {
      ...draft,
      url: '',
      title: 'Offline account',
      username: 'local',
    };
    const values = [
      { ...draft, title: 'AI renamed title', notes: 'different note' },
      { ...draft, password: 'different-password' },
      { ...draft, url: `${draft.url}/` },
      noUrl,
      { ...noUrl },
      { ...noUrl, password: 'other-local-password' },
    ];
    const preview = session.previewImport(values);
    expect(preview.rows.map((row) => row.status)).toEqual([
      'duplicate',
      'conflict',
      'new',
      'new',
      'duplicate',
      'conflict',
    ]);
    expect(preview.rows[0].duplicateOfIndex).toBeUndefined();
    expect(preview.rows[4].duplicateOfIndex).toBe(3);
    expect(preview.rows[1].existingIds).toEqual([id]);
    expect(preview.rows[5].existingIds).toEqual([]);
    const result = await session.importEntries(
      values.map((value) => ({ draft: value })),
      preview.revision,
    );
    expect(result).toMatchObject({ added: 2, updated: 0, skipped: 4 });
    expect(session.getSnapshot().entries).toHaveLength(3);
    expect(session.readEntry(id)).toEqual({ ...draft, id });
    const writes = storage.writes;
    const retry = await session.importEntries(
      values.map((value) => ({ draft: value })),
      result.revision,
    );
    expect(retry).toMatchObject({
      added: 0,
      updated: 0,
      skipped: 6,
      entryIds: [],
    });
    expect(storage.writes).toBe(writes);
  }, 30_000);

  it('keeps same-platform accounts distinct and points batch duplicates at their original row', async () => {
    const { session } = await created();
    const existingId = await session.saveEntry(draft);
    const another = { ...draft, username: 'second@example.test' };
    const third = { ...draft, username: 'third@example.test' };
    const preview = session.previewImport([another, draft, { ...another }, third]);
    expect(preview.rows.map(row => row.status)).toEqual(['new', 'duplicate', 'duplicate', 'new']);
    expect(preview.rows[1]).toMatchObject({ existingIds: [existingId] });
    expect(preview.rows[1].duplicateOfIndex).toBeUndefined();
    expect(preview.rows[2]).toMatchObject({ existingIds: [], duplicateOfIndex: 0 });
    const saved = await session.importEntries([another, draft, { ...another }, third].map(value => ({ draft: value })), preview.revision);
    expect(saved).toMatchObject({ added: 2, updated: 0, skipped: 2 });
    expect(session.getSnapshot().entries).toHaveLength(3);
  });

  it('requires an explicit matching target for conflict updates, preserves history, and allows keeping both', async () => {
    const { session, storage } = await created();
    const id = await session.saveEntry(draft);
    const otherId = await session.saveEntry({
      ...draft,
      username: 'different-account',
    });
    const next = {
      ...draft,
      password: '  new-password  ',
      notes: 'reviewed metadata',
    };
    const preview = session.previewImport([next]);
    const before = storage.record?.bytes.slice();
    await expect(
      session.importEntries(
        [{ draft: next, action: 'update' }],
        preview.revision,
      ),
    ).rejects.toThrow('vault-invalid');
    await expect(
      session.importEntries(
        [{ draft: next, action: 'update', targetId: otherId }],
        preview.revision,
      ),
    ).rejects.toThrow('vault-invalid');
    await expect(
      session.importEntries(
        [{ draft, action: 'update', targetId: otherId }],
        preview.revision,
      ),
    ).rejects.toThrow('vault-invalid');
    expect(storage.record?.bytes).toEqual(before);
    const updated = await session.importEntries(
      [{ draft: next, action: 'update', targetId: id }],
      preview.revision,
    );
    expect(updated).toMatchObject({
      added: 0,
      updated: 1,
      skipped: 0,
      entryIds: [id],
    });
    expect(session.readEntry(id).password).toBe(next.password);
    expect(session.history(id)[0].draft.password).toBe(draft.password);
    const kept = await session.importEntries(
      [{ draft, action: 'new' }],
      updated.revision,
    );
    expect(kept).toMatchObject({ added: 1, updated: 0, skipped: 0 });
    expect(session.getSnapshot().entries).toHaveLength(3);
    session.lock();
    await session.unlock(master);
    expect(session.history(id)[0].draft.password).toBe(draft.password);
    expect(session.readEntry(kept.entryIds[0]).password).toBe(draft.password);
  }, 30_000);

  it('updates explicit notes for the same password without duplicating the login and preserves history', async () => {
    const { session, storage } = await created();
    const id = await session.saveEntry(draft);
    const revision = session.getSnapshot().revision as string;
    const next = { ...draft, notes: 'Synthetic locally assigned source metadata\r\nkept exactly' };
    const implicit = await session.importEntries([{ draft: next }], revision);
    expect(implicit).toMatchObject({ added: 0, updated: 0, skipped: 1, revision });
    expect(session.readEntry(id).notes).toBe(draft.notes);
    const explicit = await session.importEntries([{ draft: next, action: 'update', targetId: id }], revision);
    expect(explicit).toMatchObject({ added: 0, updated: 1, skipped: 0, entryIds: [id] });
    expect(session.getSnapshot().entries).toHaveLength(1);
    expect(session.readEntry(id)).toMatchObject({ password: draft.password, notes: next.notes });
    expect(session.history(id)[0].draft.notes).toBe(draft.notes);
    const writes = storage.writes;
    const repeat = await session.importEntries([{ draft: next, action: 'update', targetId: id }], explicit.revision);
    expect(repeat).toMatchObject({ added: 0, updated: 0, skipped: 1, revision: explicit.revision });
    expect(storage.writes).toBe(writes);
  });

  it('aligns committed IDs with input rows through skipped rows and sequential updates of one target', async () => {
    const { session } = await created();
    const id = await session.saveEntry(draft);
    const distinct = { ...draft, username: 'second@example.test' };
    const result = await session.importEntries([
      { draft, action: 'skip' },
      { draft: { ...draft, password: 'Synthetic-replacement-password' }, action: 'update', targetId: id },
      { draft: distinct, action: 'new' },
      { draft, action: 'update', targetId: id },
      { draft, action: 'update', targetId: id },
    ], session.getSnapshot().revision as string);
    expect(result).toMatchObject({ added: 1, updated: 2, skipped: 2 });
    expect(result.entryIds).toEqual([id, result.entryIdsByRow[2], id]);
    expect(result.entryIdsByRow).toEqual([null, id, result.entryIds[1], id, null]);
    expect(session.readEntry(id).password).toBe(draft.password);
    expect(session.readEntry(result.entryIds[1])).toMatchObject(distinct);
    expect(session.history(id)).toHaveLength(2);
    session.lock();
    await session.unlock(master);
    expect(session.readEntry(id).password).toBe(draft.password);
    expect(session.getSnapshot().entries).toHaveLength(2);
  });

  it('validates the whole batch and aggregate limits before any encrypted mutation', async () => {
    const { session, storage } = await created();
    const revision = session.getSnapshot().revision as string;
    const load = vi.spyOn(Kdbx, 'load');
    const before = storage.record?.bytes.slice();
    await expect(
      session.importEntries(
        [{ draft }, { draft: { ...draft, url: 'javascript:invalid' } }],
        revision,
      ),
    ).rejects.toThrow('vault-invalid');
    await expect(
      session.importEntries(
        [{ draft: { ...draft, id: 'unreviewed-target' } }],
        revision,
      ),
    ).rejects.toThrow('vault-invalid');
    await expect(
      session.importEntries(
        Array.from({ length: VAULT_IMPORT_MAX_ENTRIES + 1 }, () => ({ draft })),
        revision,
      ),
    ).rejects.toThrow('vault-size');
    const heavy = { ...draft, notes: '界'.repeat(60_000) };
    await expect(
      session.importEntries(
        Array.from({ length: 25 }, () => ({ draft: heavy })),
        revision,
      ),
    ).rejects.toThrow('vault-size');
    expect(load).not.toHaveBeenCalled();
    expect(storage.record?.bytes).toEqual(before);
    expect(storage.writes).toBe(1);
    expect(session.getSnapshot().entries).toEqual([]);
  }, 30_000);

  it('keeps both the visible and persisted vault unchanged when a batch save fails', async () => {
    const { session, storage } = await created();
    const id = await session.saveEntry(draft);
    const preview = session.previewImport([
      { ...draft, password: 'changed-secret' },
      { ...draft, username: 'new-account' },
    ]);
    const snapshot = session.getSnapshot();
    const before = storage.record?.bytes.slice();
    const write = vi
      .spyOn(storage, 'write')
      .mockRejectedValueOnce(
        new Error('synthetic write failure contains no credentials'),
      );
    await expect(
      session.importEntries(
        [
          {
            draft: { ...draft, password: 'changed-secret' },
            action: 'update',
            targetId: id,
          },
          { draft: { ...draft, username: 'new-account' } },
        ],
        preview.revision,
      ),
    ).rejects.toThrow('vault-invalid');
    expect(write).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toBe(snapshot);
    expect(session.readEntry(id).password).toBe(draft.password);
    expect(session.history(id)).toEqual([]);
    expect(storage.record?.bytes).toEqual(before);
  }, 30_000);

  it('rejects changed previews and cross-tab revisions, and prevents two clicks from saving twice', async () => {
    const { session, storage } = await created();
    const preview = session.previewImport([draft]);
    const items = [{ draft }];
    const saved = await Promise.allSettled([
      session.importEntries(items, preview.revision),
      session.importEntries(items, preview.revision),
    ]);
    expect(
      saved.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(saved.find((result) => result.status === 'rejected')).toMatchObject({
      reason: new Error('vault-stale'),
    });
    expect(session.getSnapshot().entries).toHaveLength(1);
    expect(storage.writes).toBe(2);
    const second = new VaultSession(storage);
    await second.initialize();
    await second.unlock(master);
    const stale = second.previewImport([draft]);
    await session.saveEntry({ ...draft, username: 'other-tab-account' });
    const before = storage.record?.bytes.slice();
    // Even an all-duplicate no-op must reject a stale durable revision.
    await expect(second.importEntries(items, stale.revision)).rejects.toThrow(
      'vault-stale',
    );
    expect(storage.record?.bytes).toEqual(before);
    expect(second.getSnapshot().entries).toHaveLength(1);
  }, 30_000);

  it('rejects lock during batch encryption without writing or restoring unlocked state', async () => {
    const { session, storage } = await created();
    const reached = deferred();
    const resume = deferred();
    const originalSave = Kdbx.prototype.save;
    vi.spyOn(Kdbx.prototype, 'save').mockImplementationOnce(async function (
      this: Kdbx,
    ) {
      reached.resolve();
      await resume.promise;
      return originalSave.call(this);
    });
    const revision = session.previewImport([draft]).revision;
    const pending = session.importEntries([{ draft }], revision);
    const rejected = expect(pending).rejects.toThrow('vault-locked');
    await reached.promise;
    session.lock();
    resume.resolve();
    await rejected;
    expect(storage.writes).toBe(1);
    expect(session.getSnapshot()).toMatchObject({
      status: 'locked',
      entries: [],
    });
    expect(() => session.previewImport([draft])).toThrow('vault-locked');
  }, 30_000);

  it('rejects the durable CAS when another tab writes after batch validation and before encryption finishes', async () => {
    const { session: first, storage } = await created();
    const second = new VaultSession(storage);
    await second.initialize();
    await second.unlock(master);
    const revision = second.previewImport([draft]).revision;
    const snapshot = second.getSnapshot();
    const reached = deferred();
    const resume = deferred();
    const originalSave = Kdbx.prototype.save;
    vi.spyOn(Kdbx.prototype, 'save').mockImplementationOnce(async function (
      this: Kdbx,
    ) {
      reached.resolve();
      await resume.promise;
      return originalSave.call(this);
    });
    const pending = second.importEntries([{ draft }], revision);
    const rejected = expect(pending).rejects.toThrow('vault-stale');
    await reached.promise;
    const winner = await first.saveEntry({ ...draft, username: 'winning-tab' });
    const before = storage.record?.bytes.slice();
    resume.resolve();
    await rejected;
    expect(storage.writes).toBe(2);
    expect(storage.record?.bytes).toEqual(before);
    expect(second.getSnapshot()).toBe(snapshot);
    second.lock();
    await second.unlock(master);
    expect(second.getSnapshot().entries.map((entry) => entry.id)).toEqual([
      winner,
    ]);
  }, 30_000);

  it('rotates master credentials only after verifying the current password', async () => {
    const { session, storage } = await created();
    const id = await session.saveEntry(draft);
    const before = storage.record?.bytes.slice();
    await expect(session.changeMasterPassword('incorrect-master', nextMaster)).rejects.toThrow('vault-password');
    expect(storage.record?.bytes).toEqual(before);
    await session.changeMasterPassword(master, nextMaster);
    session.lock();
    await expect(session.unlock(master)).rejects.toThrow('vault-password');
    await session.unlock(nextMaster);
    expect(session.readEntry(id).password).toBe(draft.password);
    await expect(Kdbx.load((await session.exportKdbx()).slice().buffer, credentials(nextMaster))).resolves.toBeInstanceOf(Kdbx);
  }, 30_000);

  it('imports real Argon2d databases, preserves imported UUID/history/trash, and merges independent vaults without replacement', async () => {
    const source = await created();
    const sourceId = await source.session.saveEntry(draft);
    await source.session.saveEntry({ ...draft, id: sourceId, password: 'changed-before-export' });
    const trashId = await source.session.saveEntry({ ...draft, title: 'Imported trash' });
    await source.session.trashEntry(trashId);
    const upstream = await Kdbx.load((await source.session.exportKdbx()).slice().buffer, credentials(master));
    upstream.setKdf(Consts.KdfId.Argon2d);
    const importedBytes = new Uint8Array(await upstream.save());
    const storage = new MemoryStorage();
    const adopted = new VaultSession(storage);
    await adopted.initialize();
    await adopted.importKdbx(importedBytes, master);
    expect(adopted.readEntry(sourceId).password).toBe('changed-before-export');
    expect(adopted.history(sourceId)[0].draft.password).toBe(draft.password);
    expect(adopted.getSnapshot().trash[0].id).toBe(trashId);
    await source.session.saveEntry({ ...draft, id: sourceId, password: 'same-vault-newer-revision' });
    await adopted.importKdbx(await source.session.exportKdbx(), master);
    expect(adopted.readEntry(sourceId).password).toBe('same-vault-newer-revision');
    adopted.lock();
    await adopted.unlock(master);
    expect(adopted.readEntry(sourceId).password).toBe('same-vault-newer-revision');
    expect(adopted.getSnapshot().trash[0].id).toBe(trashId);
    const target = await created();
    const targetId = await target.session.saveEntry({ ...draft, title: 'Existing password' });
    await target.session.importKdbx(importedBytes, master);
    expect(target.session.getSnapshot().entries.map((entry) => entry.id)).toEqual(expect.arrayContaining([sourceId, targetId]));
    expect(target.session.getSnapshot().trash.map((entry) => entry.id)).toContain(trashId);
    expect(target.session.history(sourceId)[0].draft.password).toBe(draft.password);
    const snapshotBeforeCollision = target.session.getSnapshot();
    await expect(target.session.importKdbx(importedBytes, master)).rejects.toThrow('vault-stale');
    expect(target.session.getSnapshot()).toBe(snapshotBeforeCollision);
    expect(target.session.getSnapshot().entries).toHaveLength(2);
    const preserved = target.storage.record?.bytes.slice();
    await expect(target.session.importKdbx(importedBytes, 'incorrect-master')).rejects.toThrow('vault-password');
    await expect(target.session.importKdbx(new Uint8Array([1, 2, 3]), master)).rejects.toThrow('vault-invalid');
    expect(target.storage.record?.bytes).toEqual(preserved);
    target.session.lock();
    await expect(target.session.importKdbx(importedBytes, master)).rejects.toThrow('vault-locked');
  }, 60_000);

  it('rejects stale cross-tab writes without changing visible or persisted entries', async () => {
    const { session: first, storage } = await created();
    const id = await first.saveEntry(draft);
    const second = new VaultSession(storage);
    await second.initialize();
    await second.unlock(master);
    await first.saveEntry({ ...draft, id, password: 'first-tab-wins' });
    const before = storage.record?.bytes.slice();
    const snapshot = second.getSnapshot();
    await expect(second.saveEntry({ ...draft, id, password: 'stale-tab-value' })).rejects.toThrow('vault-stale');
    expect(second.getSnapshot()).toBe(snapshot);
    expect(second.readEntry(id).password).toBe(draft.password);
    expect(storage.record?.bytes).toEqual(before);
    await expect(second.exportKdbx()).rejects.toThrow('vault-stale');
    second.lock();
    await second.unlock(master);
    expect(second.readEntry(id).password).toBe('first-tab-wins');
    const saved = await Promise.all([
      second.saveEntry({ ...draft, title: 'Queued A' }), second.saveEntry({ ...draft, title: 'Queued B' }),
    ]);
    expect(second.getSnapshot().entries.map((entry) => entry.id)).toEqual(expect.arrayContaining(saved));
  }, 30_000);

  it('cannot resurrect an unlocked session or persist a mutation after lock during asynchronous encryption', async () => {
    const { storage, session } = await created();
    const reached = deferred();
    const resume = deferred();
    const originalSave = Kdbx.prototype.save;
    vi.spyOn(Kdbx.prototype, 'save').mockImplementationOnce(async function (this: Kdbx) {
      reached.resolve();
      await resume.promise;
      return originalSave.call(this);
    });
    const pending = session.saveEntry(draft);
    const rejected = expect(pending).rejects.toThrow('vault-locked');
    await reached.promise;
    session.lock();
    expect(session.getSnapshot()).toMatchObject({ status: 'locked', entries: [] });
    resume.resolve();
    await rejected;
    expect(storage.writes).toBe(1);
    expect(session.getSnapshot().status).toBe('locked');
    const loadReached = deferred();
    const loadResume = deferred();
    const originalLoad = Kdbx.load;
    vi.spyOn(Kdbx, 'load').mockImplementationOnce(async (...args) => {
      loadReached.resolve();
      await loadResume.promise;
      return originalLoad(...args);
    });
    const unlock = session.unlock(master);
    const unlockRejected = expect(unlock).rejects.toThrow('vault-locked');
    await loadReached.promise;
    session.lock();
    loadResume.resolve();
    await unlockRejected;
    expect(session.getSnapshot()).toMatchObject({ status: 'locked', entries: [], trash: [] });
  }, 30_000);

  it('also prevents late import and master rotation from unlocking or replacing a locked session', async () => {
    const { storage, session } = await created();
    const id = await session.saveEntry(draft);
    const exported = await session.exportKdbx();
    for (const operation of ['import', 'rotate']) {
      const reached = deferred();
      const resume = deferred();
      const original = Kdbx.load;
      const spy = vi.spyOn(Kdbx, 'load').mockImplementationOnce(async (...args) => {
        reached.resolve();
        await resume.promise;
        return original(...args);
      });
      const before = storage.record?.bytes.slice();
      const pending = operation === 'import' ? session.importKdbx(exported, master) : session.changeMasterPassword(master, nextMaster);
      const rejected = expect(pending).rejects.toThrow('vault-locked');
      await reached.promise;
      session.lock();
      resume.resolve();
      await rejected;
      spy.mockRestore();
      expect(session.getSnapshot()).toMatchObject({ status: 'locked', entries: [], trash: [] });
      expect(storage.record?.bytes).toEqual(before);
      await session.unlock(master);
      expect(session.readEntry(id).password).toBe(draft.password);
    }
  }, 30_000);

  it('clears held protected field and credential references on lock and isolates subscriber errors', async () => {
    const { session } = await created();
    session.subscribe(() => { throw new Error('synthetic subscriber rendering error'); });
    const id = await session.saveEntry(draft);
    expect(session.readEntry(id).password).toBe(draft.password);
    // Capture references only inside this test to prove the zeroing boundary, not just missing UI state.
    const db = (session as unknown as { db: Kdbx }).db;
    const secret = db.getDefaultGroup().entries[0].fields.get('Password') as ProtectedValue;
    const credential = db.credentials.passwordHash;
    session.lock();
    expect(secret.value.every((value) => value === 0)).toBe(true);
    expect(secret.salt.every((value) => value === 0)).toBe(true);
    expect(credential?.value.every((value) => value === 0)).toBe(true);
    expect(credential?.salt.every((value) => value === 0)).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ status: 'locked', entries: [], trash: [] });
  }, 30_000);

  it('bounds import bytes/KDF work and validates drafts without overwriting the vault', async () => {
    const { session, storage } = await created();
    const before = storage.record?.bytes.slice();
    await expect(session.importKdbx(new Uint8Array(VAULT_MAX_BYTES + 1), master)).rejects.toThrow('vault-size');
    for (const invalid of [
      { ...draft, url: 'javascript:alert(1)' }, { ...draft, url: 'https://user:secret@example.test/' }, { ...draft, title: '' },
      { ...draft, password: 'a'.repeat(65_537) }, { ...draft, linkedAssetIds: Array(101).fill('id') },
    ]) await expect(session.saveEntry(invalid)).rejects.toThrow('vault-invalid');
    const malicious = Kdbx.create(credentials(master), 'Oversized work factor');
    configureDatabase(malicious);
    malicious.header.kdfParameters?.set('M', VarDictionary.ValueType.UInt64, Int64.from(129 * 1024 * 1024));
    const header = new (await import('kdbxweb')).BinaryStream();
    malicious.header.generateSalts();
    malicious.header.write(header);
    expect(() => checkHeader(new Uint8Array(header.getWrittenBytes()))).toThrow('vault-kdf');
    malicious.header.kdfParameters?.set('M', VarDictionary.ValueType.UInt64, Int64.from(64 * 1024 * 1024));
    malicious.header.kdfParameters?.set('I', VarDictionary.ValueType.UInt64, Int64.from(11));
    const iterations = new (await import('kdbxweb')).BinaryStream();
    malicious.header.write(iterations);
    expect(() => checkHeader(new Uint8Array(iterations.getWrittenBytes()))).toThrow('vault-kdf');
    expect(storage.record?.bytes).toEqual(before);
  }, 30_000);

  it('reads ordinary compressed upstream KDBX3/4 and rejects a compressed XML bomb through the patched real parser', async () => {
    for (const version of [3, 4] as const) {
      const external = Kdbx.create(credentials(master), `Compressed KDBX${version}`);
      configureDatabase(external);
      external.setVersion(version);
      external.header.compression = Consts.CompressionAlgorithm.GZip;
      const entry = external.createEntry(external.getDefaultGroup());
      entry.fields.set('Title', 'Compressed external password');
      entry.fields.set('Password', ProtectedValue.fromString('external-compressed-secret'));
      entry.fields.set('URL', 'javascript:alert(1)');
      const bytes = new Uint8Array(await external.save());
      const decoded = await Kdbx.load(bytes.slice().buffer, credentials(master));
      expect((decoded.getDefaultGroup().entries[0].fields.get('Password') as ProtectedValue).getText()).toBe('external-compressed-secret');
      const store = new MemoryStorage();
      const importing = new VaultSession(store);
      await importing.initialize();
      await importing.importKdbx(bytes, master);
      expect(importing.getSnapshot().entries[0].url).toBe('');
      expect(importing.readEntry(entry.uuid.id).password).toBe('external-compressed-secret');
    }
    const malicious = Kdbx.create(credentials(master), 'Synthetic compressed size boundary');
    configureDatabase(malicious);
    malicious.header.compression = Consts.CompressionAlgorithm.GZip;
    const entry = malicious.createEntry(malicious.getDefaultGroup());
    // An unprotected repetitive XML field makes the encrypted file small while inflation exceeds 32 MiB.
    entry.fields.set('Notes', 'x'.repeat(33 * 1024 * 1024));
    const bytes = new Uint8Array(await malicious.save());
    expect(bytes.byteLength).toBeLessThan(VAULT_MAX_BYTES);
    await expect(Kdbx.load(bytes.slice().buffer, credentials(master))).rejects.toThrow('vault-size');
    const { storage, session } = await created();
    const id = await session.saveEntry(draft);
    const before = storage.record?.bytes.slice();
    await expect(session.importKdbx(bytes, master)).rejects.toThrow('vault-size');
    expect(storage.record?.bytes).toEqual(before);
    expect(session.readEntry(id).password).toBe(draft.password);
    await session.saveEntry({ ...draft, id, password: 'usable-after-bomb-rejection' });
    expect(session.readEntry(id).password).toBe('usable-after-bomb-rejection');
  }, 60_000);

  it('enforces the real upstream compressed binary aggregate budget per XML document', async () => {
    const external = Kdbx.create(credentials(master), 'Synthetic compressed binary aggregate');
    external.setVersion(3);
    const payload = Buffer.from(gzipSync(new Uint8Array(17 * 1024 * 1024).fill(7))).toString('base64');
    const originalBuild = external.buildXml;
    vi.spyOn(external, 'buildXml').mockImplementationOnce((context) => {
      originalBuild.call(external, context);
      const meta = external.xml?.getElementsByTagName('Meta')[0];
      if (!meta) throw new Error('missing synthetic Meta');
      const binaries = meta.getElementsByTagName('Binaries')[0];
      for (const id of ['0', '1']) {
        const binary = XmlUtils.addChildNode(binaries, 'Binary');
        binary.setAttribute('ID', id);
        binary.setAttribute('Compressed', 'True');
        binary.textContent = payload;
      }
    });
    const bomb = new Uint8Array(await external.save());
    expect(bomb.byteLength).toBeLessThan(VAULT_MAX_BYTES);
    await expect(Kdbx.load(bomb.slice().buffer, credentials(master))).rejects.toThrow('vault-size');
    const { session, storage } = await created();
    const before = storage.record?.bytes.slice();
    await expect(session.importKdbx(bomb, master)).rejects.toThrow('vault-size');
    expect(storage.record?.bytes).toEqual(before);
    // A failed document must not poison the next parser invocation's aggregate budget.
    const normal = new Uint8Array(await external.save());
    await expect(Kdbx.load(normal.slice().buffer, credentials(master))).resolves.toBeInstanceOf(Kdbx);
  }, 60_000);
});

it('generates cryptographic passwords of requested length with every enabled category and bounded inputs', () => {
  vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random is forbidden'); });
  for (let i = 0; i < 40; i++) {
    const password = generatePassword(24);
    expect(password).toHaveLength(24);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^a-zA-Z0-9]/);
    expect(generatePassword(12, false)).toMatch(/^[a-zA-Z0-9]{12}$/);
  }
  expect(generatePassword(128)).toHaveLength(128);
  for (const length of [0, 11, 129, NaN, 12.5]) expect(() => generatePassword(length)).toThrow('vault-invalid');
});

describe('reviewed account links', () => {
  it('writes a whole association batch once and preserves secrets, aliases, history and encrypted draft', async () => {
    const { session, storage } = await created();
    const a = await session.saveEntry({ ...draft, usernameAliases: ['other@example.test'] });
    const b = await session.saveEntry({ ...draft, title: 'Second' });
    await session.writeImportDraft('synthetic-private-draft', session.getSnapshot().revision!);
    const before = session.getSnapshot().contentRevision!;
    const writes = storage.writes;
    await session.linkAccounts([{ entryId: a, accountId: 'public-a' }, { entryId: b, accountId: 'public-b' }], before);
    expect(storage.writes).toBe(writes + 1);
    expect(session.readEntry(a)).toMatchObject({ password: draft.password, notes: draft.notes, usernameAliases: ['other@example.test'], linkedAssetIds: [...draft.linkedAssetIds, 'public-a'] });
    expect(session.readImportDraft()).toBe('synthetic-private-draft');
    expect(session.history(a)).toHaveLength(1);
    await expect(session.linkAccounts([{ entryId: a, accountId: 'wrong' }], before)).rejects.toThrow('vault-stale');
    expect(session.readEntry(a).linkedAssetIds).not.toContain('wrong');
    const current = session.getSnapshot().contentRevision!;
    await session.linkAccounts([{ entryId: a, accountId: 'public-a' }], current);
    expect(storage.writes).toBe(writes + 1);
    await expect(session.linkAccounts([{ entryId: a, accountId: 'wrong' }, { entryId: 'missing', accountId: 'other' }], current)).rejects.toThrow();
    expect(session.readEntry(a).linkedAssetIds).not.toContain('wrong');
    session.lock();
    await expect(session.linkAccounts([{ entryId: a, accountId: 'wrong' }], current)).rejects.toThrow('vault-locked');
  });
});
