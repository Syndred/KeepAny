import { Consts, Int64, Kdbx, VarDictionary } from 'kdbxweb';
import { expect, it } from 'vitest';
import { applyDraft, clearDatabase, configureDatabase, credentials } from './engine';
import { VaultSession } from './session';
import type { VaultPersistence, VaultRecord } from './types';

class Storage implements VaultPersistence {
	record: VaultRecord | null = null;
	async read() { return this.record ? { ...this.record, bytes: this.record.bytes.slice() } : null; }
	async write(bytes: Uint8Array, expected: string | null) {
		if ((this.record?.revision ?? null) !== expected) throw Error('vault-stale');
		this.record = { id: 'local' as const, revision: crypto.randomUUID(), updatedAt: new Date().toISOString(), bytes: bytes.slice() };
		return { ...this.record, bytes: this.record.bytes.slice() };
	}
}
const master = 'Synthetic-supported-KDF-v1';
const next = 'Synthetic-supported-KDF-v2';
const shape = (db: Kdbx) => ({ version: db.header.versionMajor, minor: db.header.versionMinor, cipher: db.header.dataCipherUuid?.id,
	compression: db.header.compression, rounds: db.header.versionMajor === 3 ? db.header.keyEncryptionRounds : undefined,
	kdf: ['$UUID', 'M', 'I', 'P', 'V', 'R'].map(key => {
		const value = db.header.kdfParameters?.get(key);
		return value instanceof Int64 ? value.value : value instanceof ArrayBuffer ? Array.from(new Uint8Array(value)) : value;
	}),
});

for (const kind of ['argon2id-128MiB', 'argon2d', 'kdbx3-aes'] as const) it(`keeps supported ${kind} ciphertext on adoption and work factors after edits, merge and password rotation`, async () => {
	const source = Kdbx.create(credentials(master), 'Synthetic supported import');
	configureDatabase(source);
	if (kind === 'kdbx3-aes') { source.setVersion(3); source.header.keyEncryptionRounds = 250_000; }
	else {
		source.setKdf(kind === 'argon2d' ? Consts.KdfId.Argon2d : Consts.KdfId.Argon2id);
		source.header.kdfParameters?.set('M', VarDictionary.ValueType.UInt64, Int64.from((kind === 'argon2d' ? 32 : 128) * 1024 * 1024));
		source.header.kdfParameters?.set('I', VarDictionary.ValueType.UInt64, Int64.from(4));
	}
	source.header.compression = Consts.CompressionAlgorithm.GZip;
	const entry = source.createEntry(source.getDefaultGroup());
	applyDraft(entry, { title: 'Synthetic KDF record', username: 'synthetic@example.test', password: 'Synthetic-KDF-entry-secret', url: '', notes: 'Original private note', linkedAssetIds: [] });
	entry.fields.set('StackPerch.LegacyFixture', 'Compatibility field');
	const original = new Uint8Array(await source.save()), parameters = shape(source), id = entry.uuid.id;
	const storage = new Storage(), session = new VaultSession(storage);
	try {
		await session.initialize(); await session.importKdbx(original, master);
		expect(await session.exportKdbx()).toEqual(original);
		expect(storage.record?.bytes).toEqual(original);
		const beforeDraft = session.getSnapshot();
		if (!beforeDraft.revision) throw Error('missing-adopted-revision');
		await session.writeImportDraft('Synthetic encrypted review state', beforeDraft.revision);
		expect(session.getSnapshot().contentRevision).toBe(beforeDraft.contentRevision);
		await session.saveEntry({ ...session.readEntry(id), notes: 'Explicitly edited note' });
		let loaded = await Kdbx.load((await session.exportKdbx()).slice().buffer, credentials(master));
		expect(shape(loaded)).toEqual(parameters);
		expect(loaded.getDefaultGroup().entries.find(item => item.uuid.id === id)?.fields.get('StackPerch.LegacyFixture')).toBe('Compatibility field');
		clearDatabase(loaded);
		// A weaker unrelated input must not reset the destination's existing KDF.
		const other = Kdbx.create(credentials(master), 'Independent import'); configureDatabase(other);
		const otherEntry = other.createEntry(other.getDefaultGroup());
		applyDraft(otherEntry, { title: 'Independent synthetic entry', username: '', password: 'Independent-synthetic-secret', url: '', notes: '', linkedAssetIds: [] });
		const extra = new Uint8Array(await other.save()); clearDatabase(other);
		await session.importKdbx(extra, master);
		await session.changeMasterPassword(master, next);
		session.lock(); await expect(session.unlock(master)).rejects.toThrow('vault-password'); await session.unlock(next);
		loaded = await Kdbx.load((await session.exportKdbx()).slice().buffer, credentials(next));
		expect(shape(loaded)).toEqual(parameters);
		expect(session.readEntry(id).notes).toBe('Explicitly edited note');
		expect(session.history(id)).toHaveLength(1);
		expect(session.readImportDraft()).toBe('Synthetic encrypted review state');
		expect(session.getSnapshot().entries).toHaveLength(2);
		clearDatabase(loaded);
	} finally { session.lock(); clearDatabase(source); }
}, 90_000);
