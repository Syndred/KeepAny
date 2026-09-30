import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { Credentials, Kdbx, ProtectedValue } from 'kdbxweb';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { newAsset } from '../../domain/src';
import { inspectArchive, LocalRepository, openLocalRepository, type DatasetBinding } from './index';
import { PASSWORD_VAULT_LIMIT } from './password-vault-storage';

const repositories: LocalRepository[] = [];
const extraStores: LocalRepository['fileStore'][] = [];
const master = 'vault-storage-test-master';
const secret = 'PRIVATE-STORAGE-PASSWORD-7';
async function repository() {
  const value = await openLocalRepository(`test-${crypto.randomUUID().slice(0, 12)}`);
  repositories.push(value); return value;
}
function secondHandle(first: LocalRepository) {
  const Store = first.fileStore.constructor as new (name: string) => LocalRepository['fileStore'];
  const store = new Store(first.db.name); extraStores.push(store);
  return new LocalRepository(first.db, store, first.recoveryState);
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of extraStores.splice(0)) store.close();
  for (const value of repositories.splice(0)) await value.close();
});
let encryptedFixture: Promise<Uint8Array> | undefined;
function encryptedVault() {
  encryptedFixture ??= (async () => {
    const db = Kdbx.create(new Credentials(ProtectedValue.fromString(master)), 'Private local vault');
    // KeePass 3 uses the library's AES KDF and avoids a test-only Argon2 hook.
    db.setVersion(3);
    const entry = db.createEntry(db.getDefaultGroup());
    entry.fields.set('Title', 'PRIVATE-STORAGE-TITLE');
    entry.fields.set('Password', ProtectedValue.fromString(secret));
    return new Uint8Array(await db.save());
  })();
  return encryptedFixture;
}
async function hash(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)),
    byte => byte.toString(16).padStart(2, '0')).join('');
}
async function owner(): Promise<DatasetBinding> {
  const endpoint = 'https://sync.example.test', accountId = 'vault-owner', workspaceId = crypto.randomUUID();
  const digest = await hash(strToU8(JSON.stringify([endpoint, accountId])));
  return { endpoint, accountId, workspaceId, scope: `${digest}:${workspaceId}` };
}
async function vaultArchive(withAsset = false) {
  const source = await repository(), bytes = await encryptedVault();
  const record = await source.savePasswordVault(bytes, null);
  if (withAsset) await source.save('asset', { ...newAsset('item'), name: 'Restore companion' });
  return { source, record, bytes, archive: await source.exportArchive() };
}

it('CAS persists cloned encrypted bytes without ordinary records, sync operations or plaintext', async () => {
  const target = await repository(), other = secondHandle(target);
  expect(await target.readPasswordVault()).toBeNull();
  const input = new Uint8Array(await encryptedVault()), original = new Uint8Array(input);
  const first = await target.savePasswordVault(input, null);
  input.fill(0); first.bytes.fill(0);
  const current = await target.readPasswordVault();
  if (!current) throw Error('missing saved vault');
  expect(current?.bytes).toEqual(original);
  expect(current?.revision).toMatch(/^[0-9a-f-]{36}$/);
  const next = await other.savePasswordVault(original, current.revision);
  await expect(target.savePasswordVault(original, current.revision)).rejects.toThrow('vault-stale');
  await expect(target.savePasswordVault(original, null)).rejects.toThrow('vault-stale');
  expect(await target.readPasswordVault()).toEqual(next);
  expect(await target.allRecords()).toEqual([]);
  expect(await target.fileStore.scopedOutbox.count()).toBe(0);
  expect(await target.fileStore.syncBase.count()).toBe(0);
  expect(new TextDecoder().decode(next.bytes)).not.toContain(secret);
  expect(JSON.stringify(await target.fileStore.passwordVault.toArray())).not.toContain(secret);
});

it('rejects invalid headers and oversize ciphertext without replacing a saved vault', async () => {
  const target = await repository(), first = await target.savePasswordVault(await encryptedVault(), null);
  for (const bad of [new Uint8Array(), strToU8('plaintext password'), new Uint8Array(12)])
    await expect(target.savePasswordVault(bad, first.revision)).rejects.toThrow('vault-invalid');
  await expect(target.savePasswordVault(new Uint8Array(PASSWORD_VAULT_LIMIT + 1), first.revision)).rejects.toThrow('vault-size');
  expect(await target.readPasswordVault()).toEqual(first);
});

it('serializes two actual cross-handle CAS writes and retains only the winning ciphertext', async () => {
  const target = await repository(), other = secondHandle(target), bytes = await encryptedVault();
  const current = await target.savePasswordVault(bytes, null);
  const first = new Uint8Array(bytes), second = new Uint8Array(bytes);
  first[first.length - 1] ^= 1; second[second.length - 1] ^= 2;
  const results = await Promise.allSettled([target.savePasswordVault(first, current.revision),
    other.savePasswordVault(second, current.revision)]);
  const saved = results.filter(result => result.status === 'fulfilled');
  expect(saved).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: Error('vault-stale') }]);
  expect(await target.readPasswordVault()).toEqual(saved[0].value);
});

it('rejects magic-only and truncated KDBX before storage or archive restore writes', async () => {
  const fixture = await vaultArchive(true), target = await repository();
  const entries = unzipSync(fixture.archive);
  for (const truncated of [fixture.bytes.slice(0, 12), fixture.bytes.slice(0, -1)]) {
    await expect(target.savePasswordVault(truncated, null)).rejects.toThrow('vault-invalid');
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    manifest.passwordVault.size = truncated.length;
    manifest.passwordVault.sha256 = await hash(truncated);
    const archive = zipSync({ ...entries, 'password-vault.kdbx': truncated,
      'manifest.json': strToU8(JSON.stringify(manifest)) });
    await expect(inspectArchive(archive)).rejects.toThrow('vault-invalid');
    await expect(target.restoreArchive(archive)).rejects.toThrow('vault-invalid');
    expect(await target.readPasswordVault()).toBeNull();
    expect(await target.allRecords()).toEqual([]);
    expect(await target.fileStore.journal.count()).toBe(0);
  }
});

it('exports, inspects and cleanly restores a real encrypted KeePass vault byte for byte', async () => {
  const fixture = await vaultArchive(), target = await repository();
  const inspected = await inspectArchive(fixture.archive);
  expect(inspected.manifest.passwordVault).toEqual({ revision: fixture.record.revision,
    updatedAt: fixture.record.updatedAt, size: fixture.bytes.length, sha256: await hash(fixture.bytes) });
  expect(inspected.passwordVault?.bytes).toEqual(fixture.bytes);
  expect(strFromU8(inspected.entries['records.json'])).not.toContain(secret);
  expect(strFromU8(inspected.entries['manifest.json'])).not.toContain('PRIVATE-STORAGE-TITLE');
  expect(await target.restoreArchive(fixture.archive)).toBe(0);
  expect(await target.readPasswordVault()).toEqual(fixture.record);
  const reopened = await Kdbx.load(fixture.bytes.slice().buffer,
    new Credentials(ProtectedValue.fromString(master)));
  expect((reopened.getDefaultGroup().entries[0].fields.get('Password') as ProtectedValue).getText()).toBe(secret);
  expect(await target.allRecords()).toEqual([]); expect(await target.fileStore.journal.count()).toBe(0);
});

it('keeps old archives compatible and preserves an existing local vault absent from the backup', async () => {
  const source = await repository(), target = await repository();
  const entries = unzipSync(await source.exportArchive());
  const manifest = JSON.parse(strFromU8(entries['manifest.json']));
  delete manifest.intakeReviewCount; delete manifest.intakeReviewHash;
  delete entries['intake-review.json']; entries['manifest.json'] = strToU8(JSON.stringify(manifest));
  const old = zipSync(entries), current = await target.savePasswordVault(await encryptedVault(), null);
  expect((await inspectArchive(old)).passwordVault).toBeNull();
  expect(await target.restoreArchive(old)).toBe(0);
  expect(await target.readPasswordVault()).toEqual(current);
  expect((await inspectArchive(await source.exportArchive())).manifest.passwordVault).toBeUndefined();
});

it('refuses a different vault before writes and preserves the local revision for identical bytes', async () => {
  const fixture = await vaultArchive(true), target = await repository();
  const changed = new Uint8Array(fixture.bytes); changed[changed.length - 1] ^= 1;
  const current = await target.savePasswordVault(changed, null), before = await target.allRecords();
  await expect(target.restoreArchive(fixture.archive)).rejects.toThrow('restore-vault-conflict');
  expect(await target.readPasswordVault()).toEqual(current); expect(await target.allRecords()).toEqual(before);
  expect(await target.fileStore.journal.count()).toBe(0);
  const equal = await target.savePasswordVault(fixture.bytes, current.revision);
  expect(await target.restoreArchive(fixture.archive)).toBe(1);
  expect(await target.readPasswordVault()).toEqual(equal);
});

it('retains ciphertext in an interrupted restore checkpoint, blocks vault writes and retries atomically', async () => {
  const fixture = await vaultArchive(true), target = await repository();
  const fault = vi.spyOn(target.db.records, 'insert').mockRejectedValueOnce(Error('injected-restore-write'));
  await expect(target.restoreArchive(fixture.archive)).rejects.toThrow('injected-restore-write'); fault.mockRestore();
  expect(await target.readPasswordVault()).toBeNull();
  const [pending] = await target.getPendingRestoreRecoveries();
  expect(pending).toMatchObject({ rowCount: 1, canRetry: true, canAbandon: true });
  expect(JSON.stringify(pending)).not.toContain(secret);
  await expect(target.savePasswordVault(fixture.bytes, null)).rejects.toThrow('restore-recovery-pending');
  await expect(target.exportArchive()).rejects.toThrow('restore-recovery-pending');
  expect((await target.fileStore.journal.toArray())[0].passwordVault?.bytes).toEqual(fixture.bytes);
  await target.retryRestoreRecovery(pending.token);
  expect(await target.readPasswordVault()).toEqual(fixture.record);
  expect(await target.allRecords()).toHaveLength(1); expect(await target.fileStore.journal.count()).toBe(0);
});

it('retries when the vault commit fails after ordinary records have already been restored', async () => {
  const fixture = await vaultArchive(true), target = await repository();
  const fault = vi.spyOn(target.fileStore.passwordVault, 'add').mockRejectedValueOnce(Error('injected-vault-write'));
  await expect(target.restoreArchive(fixture.archive)).rejects.toThrow('injected-vault-write'); fault.mockRestore();
  expect(await target.allRecords()).toHaveLength(1); expect(await target.readPasswordVault()).toBeNull();
  const [pending] = await target.getPendingRestoreRecoveries();
  expect(pending).toMatchObject({ presentEqual: 1, missing: 0, canRetry: true });
  await target.retryRestoreRecovery(pending.token);
  expect(await target.readPasswordVault()).toEqual(fixture.record);
  expect(await target.fileStore.journal.count()).toBe(0);
});

it('checks vault conflicts again inside restore staging when another handle wins the preflight race', async () => {
  const fixture = await vaultArchive(true), target = await repository(), other = secondHandle(target);
  const different = new Uint8Array(fixture.bytes); different[different.length - 1] ^= 1;
  const staleRead = vi.spyOn(target, 'readPasswordVault').mockImplementationOnce(async () => {
    await other.savePasswordVault(different, null); return null;
  });
  await expect(target.restoreArchive(fixture.archive)).rejects.toThrow('restore-vault-conflict'); staleRead.mockRestore();
  expect((await target.readPasswordVault())?.bytes).toEqual(different);
  expect(await target.allRecords()).toEqual([]); expect(await target.fileStore.journal.count()).toBe(0);
});

it('abandon keeps the current vault and recovery tokens detect a direct vault change', async () => {
  const target = await repository(), current = await target.savePasswordVault(await encryptedVault(), null);
  await target.fileStore.journal.put({ id: 'old-restore-checkpoint', rows: [], passwordVault: current });
  const [pending] = await target.getPendingRestoreRecoveries();
  const edited = { ...current, revision: crypto.randomUUID() };
  await target.fileStore.passwordVault.put(edited);
  await expect(target.retryRestoreRecovery(pending.token)).rejects.toThrow('restore-recovery-stale');
  await expect(target.abandonRestoreRecovery(pending.token)).rejects.toThrow('restore-recovery-stale');
  const [fresh] = await target.getPendingRestoreRecoveries();
  expect(await target.abandonRestoreRecovery(fresh.token)).toBe('kept-current');
  expect(await target.readPasswordVault()).toEqual(edited);
});

it('rejects corrupt hashes, missing/unlisted KDBX files and an invalid signed header', async () => {
  const fixture = await vaultArchive();
  const entries = unzipSync(fixture.archive), manifest = JSON.parse(strFromU8(entries['manifest.json']));
  const changed = new Uint8Array(entries['password-vault.kdbx']); changed[20] ^= 1;
  await expect(inspectArchive(zipSync({ ...entries, 'password-vault.kdbx': changed }))).rejects.toThrow('archive-hash');
  const missing = { ...entries }; delete missing['password-vault.kdbx'];
  await expect(inspectArchive(zipSync(missing))).rejects.toThrow('archive-hash');
  const invalid = new Uint8Array(entries['password-vault.kdbx']); invalid[0] ^= 1;
  manifest.passwordVault.sha256 = await hash(invalid);
  await expect(inspectArchive(zipSync({ ...entries, 'password-vault.kdbx': invalid,
    'manifest.json': strToU8(JSON.stringify(manifest)) }))).rejects.toThrow('vault-invalid');
  delete manifest.passwordVault;
  await expect(inspectArchive(zipSync({ ...entries, 'manifest.json': strToU8(JSON.stringify(manifest)) }))).rejects.toThrow('archive-entry');
});

it('fails an export when a second handle changes the vault while attachment bytes are read', async () => {
  const target = await repository(), other = secondHandle(target);
  const current = await target.savePasswordVault(await encryptedVault(), null);
  const imageId = await target.putFile(new File([new Uint8Array([1, 2, 3])], 'tiny.png', { type: 'image/png' }));
  await target.save('asset', { ...newAsset('item'), name: 'With image', attachments: [imageId] });
  const read = Blob.prototype.arrayBuffer;
  const pause = vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementationOnce(async function(this: Blob) {
    await other.savePasswordVault(current.bytes, current.revision);
    return read.call(this);
  });
  await expect(target.exportArchive()).rejects.toThrow('archive-export-stale'); pause.mockRestore();
  expect((await target.readPasswordVault())?.revision).not.toBe(current.revision);
});

it('explicitly refuses password vault migration in archive merge and gates category migration writes', async () => {
  const fixture = await vaultArchive(), target = await repository();
  await expect(target.previewArchiveMerge(fixture.archive)).rejects.toThrow('restore-vault-conflict');
  await target.claimDatasetBinding(await owner());
  await expect(target.applyArchiveMerge(fixture.archive, {}, 'stale')).rejects.toThrow('restore-vault-conflict');
  const current = await target.savePasswordVault(fixture.bytes, null);
  expect((await target.previewArchiveMerge(fixture.archive)).rows).toEqual([]);
  await target.fileStore.categoryEditJournal.add({ id: 'item', operationId: crypto.randomUUID(), phase: 'applying', changes: [] });
  await expect(target.savePasswordVault(fixture.bytes, current.revision)).rejects.toThrow('category-edit-pending');
  expect(await target.readPasswordVault()).toEqual(current);
});
