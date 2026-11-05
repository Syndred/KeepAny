import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newAsset, type Asset } from "../../../packages/domain/src";
import { openLocalRepository } from "../../../packages/local-db/src";
import {
	VaultSession,
	type VaultEntryDraft,
	type VaultPersistence,
	type VaultRecord,
} from "../../../packages/password-vault/src";
import {
	saveAccountEntry,
	accountFromTemplate,
	type AccountEntryProgress,
} from "./account-entry-save";

const master = "Synthetic combined master!2026";
const draft: VaultEntryDraft = {
	title: "Synthetic combined service",
	username: "owner@example.test",
	usernameAliases: ["alias@example.test"],
	password: "Synthetic combined secret!2026",
	url: "https://example.test",
	notes: "Synthetic confidential note",
	linkedAssetIds: [],
};
const profile = (): Asset => ({
	...newAsset("account"),
	category: "other",
	accountProvider: "Synthetic provider",
	contact: "Synthetic contact",
	description: "Work",
	tags: ["synthetic"],
	status: "paused",
	accountProfileVerifiedAt: "2026-10-29",
	notes: "Ordinary account note",
});
const progress = (): AccountEntryProgress => ({
	account: null,
	needsVault: false,
});
const label = () => "Login email";
class Storage implements VaultPersistence {
	record: VaultRecord | null = null;
	fail = false;
	afterWrite?: () => void;
	async read() {
		return this.record;
	}
	async write(
		bytes: Uint8Array,
		revision: string | null,
	): Promise<VaultRecord> {
		if (this.fail) throw Error("Synthetic storage failure");
		if ((this.record?.revision ?? null) !== revision)
			throw Error("vault-stale");
		this.record = {
			id: "local",
			bytes: bytes.slice(),
			revision: crypto.randomUUID(),
			updatedAt: new Date().toISOString(),
		};
		this.afterWrite?.();
		return this.record;
	}
}
afterEach(() => vi.restoreAllMocks());
async function fixture() {
	const repository = await openLocalRepository(
		`test-combined-${crypto.randomUUID().slice(0, 8)}`,
	);
	const storage = new Storage(),
		session = new VaultSession(storage);
	await session.initialize();
	await session.create(master);
	return { repository, storage, session };
}
describe("single account and optional credential save", () => {
	it("records explicit template provenance only in the encrypted draft", () => {
		const copied = accountFromTemplate({ name: "Example service", url: "https://example.test/", category: "other", sourceEntryId: "source-id" });
		expect(copied.draft.templateSourceId).toBe("source-id");
		expect(copied.profile).not.toHaveProperty("templateSourceId");
		expect(copied.profile).not.toHaveProperty("sourceEntryId");
		expect(copied.draft).toMatchObject({ username: "", password: "", notes: "", linkedAssetIds: [] });
	});
	it("records explicit card provenance ahead of legacy entry provenance only in KDBX", async () => {
        const sourceCardId = crypto.randomUUID();
        const copied = accountFromTemplate({name:"Example service",url:"https://example.test/",category:"other",sourceCardId,sourceEntryId:"shared-entry"});
        expect(copied.draft.templateSourceId).toBe(`card:${sourceCardId}`);
        expect(copied.profile).not.toHaveProperty("sourceCardId");
        expect(copied.profile).not.toHaveProperty("templateSourceId");
        const {session,repository,storage}=await fixture();
        const target=new VaultSession(new Storage());
        try {
            await saveAccountEntry({...copied,draft:{...copied.draft,username:"copy@example.test"},session,progress:progress(),label,repository});
            const id=session.getSnapshot().entries[0].id;
            const bytes=await session.exportKdbx();
            await target.initialize();await target.importKdbx(bytes,master);
            expect(target.readEntry(id).templateSourceId).toBe(`card:${sourceCardId}`);
            session.lock();await session.unlock(master);
            expect(session.getSnapshot().entries[0].templateSourceId).toBe(`card:${sourceCardId}`);
            const ordinary=await repository.list<Asset>("asset");
            expect(JSON.stringify(ordinary)).not.toContain(sourceCardId);
            expect(storage.record).not.toBeNull();
        } finally {session.lock();target.lock();await repository.close();}
    },60000);
	it("creates an independent account from only the three template fields", async () => {
		const source = { ...profile(), ...draft, name: draft.title, username: "source@example.test", notes: "Do not copy" };
		const first = accountFromTemplate(source), second = accountFromTemplate(source);
		expect(first.profile.id).not.toBe(source.id);
		expect(second.profile.id).not.toBe(first.profile.id);
		expect(first.profile).toMatchObject({ name: source.name, url: source.url, category: source.category, username: "", notes: "", tags: [] });
		expect(first.draft).toEqual({ title: source.name, url: source.url, username: "", usernameAliases: [], password: "", notes: "", linkedAssetIds: [] });
		const { repository, session } = await fixture();
		try {
			await repository.save("asset", source);
			const state = progress();
			await saveAccountEntry({ ...first, draft: { ...first.draft, username: "new@example.test", password: "New synthetic secret" }, session, progress: state, label, repository });
			expect(await repository.get("asset", source.id)).toMatchObject({ username: "source@example.test", notes: "Do not copy" });
			expect(await repository.list("asset")).toHaveLength(2);
			expect(session.getSnapshot().entries[0].linkedAssetIds).toEqual([first.profile.id]);
		} finally { session.lock(); await repository.close(); }
	});
	it("saves every ordinary field and only puts password, aliases and private notes in KDBX", async () => {
		const { repository, session } = await fixture();
		try {
			const account = profile(),
				state = progress();
			await saveAccountEntry({
				profile: account,
				draft,
				session,
				progress: state,
				label,
				repository,
			});
			const rows = await repository.list<Asset>("asset");
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({
				...account,
				name: draft.title,
				username: draft.username,
				url: draft.url,
				updatedAt: expect.any(String),
			});
			for (const confidential of [
				draft.password,
				draft.notes,
				...(draft.usernameAliases ?? []),
			])
				expect(JSON.stringify(rows)).not.toContain(confidential);
			const entries = session.getSnapshot().entries;
			expect(entries).toHaveLength(1);
			expect(session.readEntry(entries[0].id)).toMatchObject({
				...draft,
				linkedAssetIds: [account.id],
			});
			session.lock();
			await session.unlock(master);
			expect(session.readEntry(entries[0].id).password).toBe(draft.password);
		} finally {
			session.lock();
			await repository.close();
		}
	});
	it("permits a minimal account with no vault and rejects private fields while locked before any write", async () => {
		const { repository, session } = await fixture();
		try {
			session.lock();
			await expect(
				saveAccountEntry({
					profile: profile(),
					draft,
					session,
					progress: progress(),
					label,
					repository,
				}),
			).rejects.toThrow("vault-locked");
			expect(await repository.list("asset")).toHaveLength(0);
			await saveAccountEntry({
				profile: profile(),
				draft: { ...draft, password: "", notes: "", usernameAliases: [] },
				session: null,
				progress: progress(),
				label,
				repository,
			});
			expect(await repository.list("asset")).toHaveLength(1);
		} finally {
			session.lock();
			await repository.close();
		}
	});
	it("keeps the same account on a failed encrypted write and retry, without an orphan credential", async () => {
		const { repository, storage, session } = await fixture();
		try {
			const account = profile(),
				state = progress();
			storage.fail = true;
			// VaultSession deliberately maps unknown persistence failures to its public error code.
			await expect(
				saveAccountEntry({
					profile: account,
					draft,
					session,
					progress: state,
					label,
					repository,
				}),
			).rejects.toThrow("vault-invalid");
			expect(await repository.list("asset")).toHaveLength(1);
			expect(state.account?.id).toBe(account.id);
			expect(session.getSnapshot().entries).toHaveLength(0);
			storage.fail = false;
			await saveAccountEntry({
				profile: account,
				draft,
				session,
				progress: state,
				label,
				repository,
			});
			expect(await repository.list("asset")).toHaveLength(1);
			expect(session.getSnapshot().entries).toHaveLength(1);
		} finally {
			session.lock();
			await repository.close();
		}
	});
	it("recovers an encrypted write that reached disk immediately before locking without creating another entry", async () => {
		const { repository, storage, session } = await fixture();
		try {
			const account = profile(),
				state = progress();
			storage.afterWrite = () => session.lock();
			await expect(
				saveAccountEntry({
					profile: account,
					draft,
					session,
					progress: state,
					label,
					repository,
				}),
			).rejects.toThrow();
			storage.afterWrite = undefined;
			await session.unlock(master);
			expect(session.getSnapshot().entries).toHaveLength(1);
			await saveAccountEntry({
				profile: account,
				draft,
				session,
				progress: state,
				label,
				repository,
			});
			expect(await repository.list("asset")).toHaveLength(1);
			expect(session.getSnapshot().entries).toHaveLength(1);
		} finally {
			session.lock();
			await repository.close();
		}
	});
	it("validates ordinary and encrypted boundaries before creating an account", async () => {
		const { repository, session } = await fixture();
		try {
			for (const [account, entry] of [
				[{ ...profile(), accountProfileVerifiedAt: "2026-02-30" }, draft],
				[profile(), { ...draft, title: "" }],
				[profile(), { ...draft, url: "javascript:alert(1)" }],
				[profile(), { ...draft, url: "https://user:secret@example.test" }],
				[
					profile(),
					{
						...draft,
						usernameAliases: Array.from({ length: 21 }, (_, i) => `alias${i}`),
					},
				],
			] as [Asset, VaultEntryDraft][])
				await expect(
					saveAccountEntry({
						profile: account,
						draft: entry,
						session,
						progress: progress(),
						label,
						repository,
					}),
				).rejects.toThrow();
			expect(await repository.list("asset")).toHaveLength(0);
			expect(session.getSnapshot().entries).toHaveLength(0);
		} finally {
			session.lock();
			await repository.close();
		}
	});
	it("does not touch KDBX when an ordinary account save fails or becomes stale", async () => {
		const { repository, session } = await fixture();
		try {
			const spy = vi
				.spyOn(repository, "saveBatchIfAssetsCurrent")
				.mockRejectedValueOnce(Error("Synthetic ordinary storage failure"));
			await expect(
				saveAccountEntry({
					profile: profile(),
					draft,
					session,
					progress: progress(),
					label,
					repository,
				}),
			).rejects.toThrow("Synthetic ordinary storage failure");
			expect(session.getSnapshot().entries).toHaveLength(0);
			expect(await repository.list("asset")).toHaveLength(0);
			spy.mockRestore();
		} finally {
			session.lock();
			await repository.close();
		}
	});
});
