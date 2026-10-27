import 'fake-indexeddb/auto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { newAsset } from '../../domain/src';
import { openLocalRepository, openRepositoryFromBackend } from '../../local-db/src';
import { encryptBackup, decryptBackup } from '../../local-db/src/backup-crypto';
import { stageReviewedCandidates } from '../../local-db/src/intake-review';
import { VaultSession } from '../../password-vault/src';
import type { PersistentFiles } from '../../platform-native/src';
import { NativeStore } from './store';
import { NativeFileStore } from './repository-storage';
import type { SqlDriver, SqlRow } from './driver';

it('restores Web KA1 into SQLite and exports it back to a clean Web repository with IDs, review drafts, images and KDBX unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'keepany-compat-'));
  const web = await openLocalRepository(`compat-web-${crypto.randomUUID().slice(0, 8)}`);
  const returnedWeb = await openLocalRepository(`compat-return-${crypto.randomUUID().slice(0, 8)}`);
  const db = new DatabaseSync(join(root, 'native.db'));
  const files: PersistentFiles = {
    async rootUri() { return pathToFileURL(root).href; },
    async write(path, bytes) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); },
    async read(path) { return new Uint8Array(await readFile(join(root, path))); },
    async remove(path) { await rm(join(root, path)); },
    async list() {
      const paths: string[] = [];
      for (const folder of ['files', 'vaults', 'recovery']) for (const name of await readdir(join(root, folder)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; })) paths.push(`${folder}/${name}`);
      return paths;
    },
  };
  const driver: SqlDriver = {
    uri: pathToFileURL(join(root, 'native.db')).href,
    async execute(sql) { db.exec(sql); },
    async query<T extends SqlRow>(sql: string, values = []) { return db.prepare(sql).all(...values) as T[]; },
    async run(sql, values = []) { return Number(db.prepare(sql).run(...values).changes); },
    async close() { db.close(); },
  };
  const store = await NativeStore.open(driver, files), side = new NativeFileStore('compat-native', store);
  const native = await openRepositoryFromBackend(side.records, side);
  try {
    const bytes = Uint8Array.of(137, 80, 78, 71, 9, 8, 7);
    const imageId = await web.putFile(new File([bytes], 'original.png', { type: 'image/png' }));
    const asset = { ...newAsset('project'), name: 'Existing Web project', attachments: [imageId] };
    await web.save('asset', asset);
    const reviewHash = 'c'.repeat(64);
    await stageReviewedCandidates(web.fileStore, [{ id: `pdf-${reviewHash}`, fileHash: reviewHash, fileName: 'original.pdf', rowNumber: 1, source: 'pdf', sourceText: 'Original text to review',
      asset: { ...newAsset('subscription'), id: `pdf-${reviewHash.slice(0, 48)}`, name: 'Pending draft' }, status: 'pending', kindSelected: false }]);
    const session = new VaultSession({ read: () => web.readPasswordVault(), write: (value, revision) => web.savePasswordVault(value, revision) });
    await session.initialize(); await session.create('Compatibility-master');
    const uuid = await session.saveEntry({ title: 'Original KDBX entry', username: 'synthetic@example.test', password: 'Synthetic-compat-secret!', url: '', notes: '', linkedAssetIds: [asset.id] });
    const originalVault = await web.readPasswordVault(); session.lock();
    const rows = await web.allRecords();
    const originalEncrypted = await encryptBackup(await web.exportArchive(), 'Compatibility-backup');
    await native.restoreArchive(await decryptBackup(originalEncrypted, 'Compatibility-backup'));
    expect(await native.allRecords()).toEqual(rows);
    expect(await native.readPasswordVault()).toEqual(originalVault);
    expect(await native.fileStore.intakeReview.toArray()).toEqual(await web.fileStore.intakeReview.toArray());
    const nativeEncrypted = await encryptBackup(await native.exportArchive(), 'Compatibility-return');
    await returnedWeb.restoreArchive(await decryptBackup(nativeEncrypted, 'Compatibility-return'));
    expect(await returnedWeb.allRecords()).toEqual(rows);
    expect(await returnedWeb.fileStore.intakeReview.toArray()).toEqual(await web.fileStore.intakeReview.toArray());
    expect(await returnedWeb.readPasswordVault()).toEqual(originalVault);
    const image = await returnedWeb.fileStore.blobs.get(imageId);
    expect(image?.name).toBe('original.png');
    if (!image) throw Error('restored-image-missing');
    expect(new Uint8Array(await image.blob.arrayBuffer())).toEqual(bytes);
    const returnedVault = new VaultSession({ read: () => returnedWeb.readPasswordVault(), write: (value, revision) => returnedWeb.savePasswordVault(value, revision) });
    await returnedVault.initialize(); await returnedVault.unlock('Compatibility-master');
    expect(returnedVault.readEntry(uuid).linkedAssetIds).toEqual([asset.id]); returnedVault.lock();
  } finally {
    await native.close(); await web.close(); await returnedWeb.close();
    if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}keepany-compat-`)) throw Error('unsafe-test-cleanup');
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
