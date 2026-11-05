import { describe, expect, it } from "vitest";
import { Kdbx, ProtectedValue } from "kdbxweb";
import { normalizeDraft, sameVaultDraft, credentials, VAULT_TEMPLATE_SOURCE_FIELD } from "./engine";
import { VaultSession } from "./session";
import type { VaultEntryDraft, VaultPersistence, VaultRecord } from "./types";

const master = "SyntheticTemplateMaster2026!";
const draft: VaultEntryDraft = { title: "Template account", username: "synthetic@example.test", password: "SyntheticExampleSecret", notes: "Synthetic note", url: "https://example.test/", linkedAssetIds: [] };
class MemoryStorage implements VaultPersistence {
	record: VaultRecord | null = null;
	async read() { return this.record ? { ...this.record, bytes: this.record.bytes.slice() } : null; }
	async write(bytes: Uint8Array, expectedRevision: string | null): Promise<VaultRecord> {
		if ((this.record?.revision ?? null) !== expectedRevision) throw Error("vault-stale");
		this.record = { id: "local", revision: crypto.randomUUID(), bytes: bytes.slice(), updatedAt: new Date().toISOString() };
		return this.record;
	}
}
async function created() { const storage = new MemoryStorage(), session = new VaultSession(storage); await session.initialize(); await session.create(master); return { storage, session }; }

describe("account detail provenance and guarded version restore", () => {
	it("validates exact template references and includes them in stale comparison", () => {
		for (const templateSourceId of ["", " ", " x", "a\0b", "x".repeat(129), 1]) expect(() => normalizeDraft({ ...draft, templateSourceId: templateSourceId as string })).toThrow("vault-invalid");
		expect(sameVaultDraft(draft, { ...draft, templateSourceId: "source-id" })).toBe(false);
		expect(normalizeDraft(draft)).not.toHaveProperty("templateSourceId");
	});
	it("keeps provenance protected through disk reload, history and KDBX export/import", async () => {
		const { storage, session } = await created();
		try {
			const id = await session.saveEntry({ ...draft, templateSourceId: "source-id" });
			await session.saveEntry({ ...session.readEntry(id), notes: "Changed synthetic note" });
			expect(session.history(id)[0].draft.templateSourceId).toBe("source-id");
			const exported = await session.exportKdbx();
			const key = credentials(master), db = await Kdbx.load(exported.slice().buffer, key);
			const entry = [...db.getDefaultGroup().allEntries()].find(row => row.uuid.id === id)!;
			expect(entry.fields.get(VAULT_TEMPLATE_SOURCE_FIELD)).toBeInstanceOf(ProtectedValue);
			const reloaded = new VaultSession(storage); await reloaded.initialize(); await reloaded.unlock(master);
			expect(reloaded.readEntry(id).templateSourceId).toBe("source-id");
			expect(reloaded.getSnapshot().entries.find(row => row.id === id)?.templateSourceId).toBe("source-id");
			await reloaded.restoreHistory(id, 0, { contentRevision: reloaded.getSnapshot().contentRevision!, at: reloaded.history(id)[0].at });
			expect(reloaded.readEntry(id)).toMatchObject({ notes: draft.notes, templateSourceId: "source-id" });
			expect(reloaded.history(id).at(-1)?.draft.notes).toBe("Changed synthetic note");
			const target = await created(); await target.session.importKdbx(exported, master);
			expect(target.session.readEntry(id).templateSourceId).toBe("source-id"); target.session.lock();
			reloaded.lock(); expect(reloaded.getSnapshot().entries).toEqual([]);
		} finally { session.lock(); }
	}, 60000);
	it("keeps template origin during ordinary text import updates that omit it", async () => {
		const { session } = await created();
		try {
			const id = await session.saveEntry({ ...draft, templateSourceId: "source-id" });
			await session.importEntries([{ draft: { ...draft, notes: "Imported change" }, action: "update", targetId: id }], session.getSnapshot().revision!);
			expect(session.readEntry(id)).toMatchObject({ notes: "Imported change", templateSourceId: "source-id" });
		} finally { session.lock(); }
	}, 60000);
	it("rejects stale history revision and timestamp without overwriting newer content", async () => {
		const { storage, session } = await created();
		try {
			const id = await session.saveEntry(draft);
			await session.saveEntry({ ...session.readEntry(id), notes: "Second version" });
			const selected = { contentRevision: session.getSnapshot().contentRevision!, at: session.history(id)[0].at };
			await session.saveEntry({ ...session.readEntry(id), notes: "Third version" });
			const revision = storage.record!.revision;
			await expect(session.restoreHistory(id, 0, selected)).rejects.toThrow("vault-stale");
			await expect(session.restoreHistory(id, 0, { contentRevision: session.getSnapshot().contentRevision!, at: "2020-01-01T00:00:00Z" })).rejects.toThrow("vault-stale");
			expect(storage.record!.revision).toBe(revision); expect(session.readEntry(id).notes).toBe("Third version");
			session.lock(); await expect(session.restoreHistory(id, 0, selected)).rejects.toThrow("vault-locked");
		} finally { session.lock(); }
	}, 60000);
});
