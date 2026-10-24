import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";
import { newAsset, type Asset, type Relation } from "../../../packages/domain/src";
import { buildImpactTasks } from "../../../packages/domain/src/impact";
import { openLocalRepository, type LocalRepository } from "../../../packages/local-db/src";
import { decideReviewedCandidate, stageReviewedCandidates, type ReviewedCandidate } from "../../../packages/local-db/src/intake-review";
import { ensureReviewedAccountLinks, previewAccountIdentity } from "./intake-account-links";

const labels = { email: "Login email", phone: "Login phone", provider: "Login account" };
const repoName = () => `test-${crypto.randomUUID().slice(0, 12)}`;
const fixture = (rowNumber: number, username = "reader@example.test", evidence = ""): ReviewedCandidate & { ai: NonNullable<ReviewedCandidate["ai"]> } => ({
	id: `ai-${"a".repeat(64)}-${rowNumber}`, fileHash: "a".repeat(64), fileName: "accounts.txt", rowNumber,
	source: "ai", sourceText: "Synthetic source", kindSelected: true, status: "pending",
	asset: { ...newAsset("account"), id: `ai-${"a".repeat(48)}-${rowNumber}`, name: `Service ${rowNumber}`, username, url: `https://service${rowNumber}.example.test` },
	ai: { provider: "deepseek", model: "synthetic", evidence: evidence || username || "Unknown account", missingFields: [], relatedName: "Unconfirmed related name" },
});
async function accept(repository: LocalRepository, rows: ReviewedCandidate[]) {
	await stageReviewedCandidates(repository.fileStore, rows);
	await repository.saveBatch(rows.map((row) => ({ type: "asset" as const, value: row.asset })));
	for (const row of rows) await decideReviewedCandidate(repository.fileStore, row.id, "accepted", async (id) => Boolean(await repository.get("asset", id)));
}
const ensure = (repository: LocalRepository, rows: ReviewedCandidate[]) => ensureReviewedAccountLinks(rows, { labels, repository });

describe("reviewed account identity links", () => {
	it("recognizes complete identifiers and per-record login evidence without guessing from another batch record", () => {
		const row = fixture(1, " Reader@Example.test ");
		expect(previewAccountIdentity(row.asset, row)).toEqual([{ kind: "email", identifier: "reader@example.test", provider: "example.test", unknownUsername: false }]);
		expect(previewAccountIdentity({ ...row.asset, username: "+86 155-0000-1234" })).toEqual([{ kind: "phone", identifier: "15500001234", provider: "", unknownUsername: false }]);
		expect(previewAccountIdentity({ ...row.asset, username: "+15551234567" })[0].identifier).toBe("+15551234567");
		expect(previewAccountIdentity({ ...row.asset, username: "123456789", description: "Our GitHub repository" })).toEqual([]);
		expect(previewAccountIdentity({ ...row.asset, username: "", description: "GitHub 登录" }, row)).toEqual([{ kind: "provider", identifier: "", provider: "GitHub", unknownUsername: true }]);
		expect(previewAccountIdentity({ ...row.asset, username: "" }, { ai: { ...row.ai, evidence: "service (github)" } })[0].unknownUsername).toBe(true);
		expect(previewAccountIdentity({ ...row.asset, username: "" }, row)).toEqual([]);
	});

	it("creates shared identity nodes once, preserves the review snapshot and records the service dependency direction", async () => {
		const repository = await openLocalRepository(repoName()), restored = await openLocalRepository(repoName());
		const rows = [fixture(1), fixture(2, "Reader@example.test"), fixture(3, "15500001234")];
		try {
			await accept(repository, rows);
			const snapshot = await repository.fileStore.intakeReview.toArray();
			const first = await ensure(repository, rows);
			expect(first).toMatchObject({ createdAssets: 2, createdRelations: 3, existingRelations: 0, unresolved: [] });
			const email = first.links[0].target;
			expect(email).toMatchObject({ kind: "account", category: "email", name: "reader@example.test", username: "reader@example.test" });
			expect(first.links[1].target.id).toBe(email.id);
			expect(first.links.map((link) => link.relation)).toEqual(expect.arrayContaining([
				expect.objectContaining({ from: rows[0].asset.id, to: email.id, label: labels.email, source: "accounts.txt", verifiedAt: "" }),
			]));
			expect(await repository.fileStore.intakeReview.toArray()).toEqual(snapshot);
			const assets = await repository.list<Asset>("asset"), relations = await repository.list<Relation>("relation");
			expect(buildImpactTasks(email, relations, assets, [], new Date().toISOString(), (asset) => asset.name)).toHaveLength(2);
			const second = await ensure(repository, rows);
			expect(second).toMatchObject({ createdAssets: 0, createdRelations: 0, existingRelations: 3 });
			expect(await repository.list("asset")).toHaveLength(5);
			await restored.restoreArchive(await repository.exportArchive());
			expect(await ensure(restored, rows)).toMatchObject({ createdAssets: 0, createdRelations: 0, existingRelations: 3 });
			expect((await restored.list<Relation>("relation")).map((relation) => relation.id).sort()).toEqual(relations.map((relation) => relation.id).sort());
		} finally { await repository.close(); await restored.close(); }
	});

	it("uses current saved identifiers and uniquely reuses existing email accounts without overwriting profile fields", async () => {
		const repository = await openLocalRepository(repoName()), row = fixture(1);
		try {
			await accept(repository, [row]);
			await repository.save("asset", { ...row.asset, username: "edited@example.test" });
			const hub = { ...newAsset("account"), name: "My existing email", category: "email", username: "edited@example.test", notes: "Keep this note", accountProvider: "Custom mail" };
			await repository.save("asset", hub);
			const result = await ensure(repository, [row]);
			expect(result).toMatchObject({ createdAssets: 0, createdRelations: 1, unresolved: [] });
			expect(result.links[0].target.id).toBe(hub.id);
			expect(await repository.get("asset", hub.id)).toEqual(hub);
			expect((await repository.list<Asset>("asset")).some((asset) => asset.username === row.asset.username)).toBe(false);
		} finally { await repository.close(); }
	});

	it("leaves an unknown GitHub username unresolved until there is exactly one existing identified GitHub account", async () => {
		const repository = await openLocalRepository(repoName()), row = fixture(1, "", "service (github)");
		try {
			await accept(repository, [row]);
			expect(await ensure(repository, [row])).toMatchObject({ createdAssets: 0, createdRelations: 0, unresolved: [{ candidateId: row.id, kind: "provider", reason: "unknown-username" }] });
			const hub = { ...newAsset("account"), name: "Existing GitHub", category: "social", accountProvider: "GitHub", username: "known-user", notes: "Keep GitHub notes" };
			await repository.save("asset", hub);
			expect((await ensure(repository, [row])).links[0].target.id).toBe(hub.id);
			expect(await repository.get("asset", hub.id)).toEqual(hub);
			await repository.save("asset", { ...hub, id: crypto.randomUUID(), username: "other-user" });
			expect(await ensure(repository, [row])).toMatchObject({ createdAssets: 0, createdRelations: 0, unresolved: [{ reason: "ambiguous-target", candidateId: row.id, kind: "provider" }] });
			expect(await repository.list("relation")).toHaveLength(1);
		} finally { await repository.close(); }
	});

	it("creates a provider account only when its identifier is supplied and does not link unconfirmed related-name suggestions", async () => {
		const repository = await openLocalRepository(repoName()), row = fixture(1, "known-user", "service (github)");
		try {
			await accept(repository, [row]);
			await repository.save("asset", { ...newAsset("project"), name: row.ai.relatedName });
			const result = await ensure(repository, [row]);
			expect(result).toMatchObject({ createdAssets: 1, createdRelations: 1, unresolved: [] });
			expect(result.links[0].target).toMatchObject({ category: "social", accountProvider: "GitHub", username: "known-user" });
			expect(await repository.list("relation")).toHaveLength(1);
		} finally { await repository.close(); }
	});

	it("does not revive deleted identities, deleted relations or retarget a user-edited stable identity", async () => {
		const repository = await openLocalRepository(repoName());
		const rows = [fixture(1), fixture(2, "second@example.test"), fixture(3, "third@example.test")];
		try {
			await accept(repository, rows);
			const first = await ensure(repository, rows);
			await repository.deleteEntity("asset", first.links[0].target.id);
			const relation = first.links[1].relation;
			if (!relation) throw Error("Expected created login relation");
			await repository.deleteEntity("relation", relation.id);
			await repository.save("asset", { ...first.links[2].target, username: "user-changed@example.test" });
			const before = await repository.allRecords();
			const retry = await ensure(repository, rows);
			expect(retry).toMatchObject({ createdAssets: 0, createdRelations: 0 });
			expect(retry.unresolved.map((item) => item.reason)).toEqual(["deleted-target", "deleted-relation", "changed-target"]);
			expect(await repository.allRecords()).toEqual(before);
		} finally { await repository.close(); }
	});

	it("skips pending, ignored and deleted service records and does not choose between duplicate identity accounts", async () => {
		const repository = await openLocalRepository(repoName());
		const rows = [fixture(1), fixture(2), fixture(3), fixture(4)];
		try {
			await stageReviewedCandidates(repository.fileStore, rows);
			await repository.saveBatch(rows.slice(2).map((row) => ({ type: "asset" as const, value: row.asset })));
			await decideReviewedCandidate(repository.fileStore, rows[1].id, "ignored", async () => false);
			for (const row of rows.slice(2)) await decideReviewedCandidate(repository.fileStore, row.id, "accepted", async () => true);
			await repository.deleteEntity("asset", rows[2].asset.id);
			for (const name of ["Email one", "Email two"]) await repository.save("asset", { ...newAsset("account"), name, category: "email", username: "reader@example.test" });
			const result = await ensure(repository, rows);
			expect(result).toMatchObject({ createdAssets: 0, createdRelations: 0, unresolved: [{ candidateId: rows[3].id, kind: "email", reason: "ambiguous-target" }] });
			expect(result.previews).toHaveLength(1);
		} finally { await repository.close(); }
	});

	it("serializes duplicate confirmations and rolls back a partial identity/edge insert before a retry", async () => {
		const repository = await openLocalRepository(repoName()), row = fixture(1);
		try {
			await accept(repository, [row]);
			const interrupted = vi.spyOn(repository.db.records, "bulkInsert").mockImplementationOnce(async (items) => {
				await repository.db.records.insert(items[0]);
				throw Error("synthetic-interruption");
			});
			await expect(ensure(repository, [row])).rejects.toThrow("synthetic-interruption");
			interrupted.mockRestore();
			expect(await repository.list("asset")).toHaveLength(1);
			expect(await repository.list("relation")).toHaveLength(0);
			expect(await repository.fileStore.importJournal.count()).toBe(0);
			const results = await Promise.all([ensure(repository, [row]), ensure(repository, [row])]);
			expect(results.map((result) => result.createdRelations)).toEqual([1, 0]);
			expect(await repository.list("asset")).toHaveLength(2);
			expect(await repository.list("relation")).toHaveLength(1);
		} finally { await repository.close(); }
	});

	it("rejects a source changed after journal staging and retries with the current identifier", async () => {
		const repository = await openLocalRepository(repoName()), row = fixture(1);
		try {
			await accept(repository, [row]);
			const transaction = repository.fileStore.transaction.bind(repository.fileStore);
			let batchTransactions = 0;
			const intercept = vi.spyOn(repository.fileStore, "transaction").mockImplementation(((...args: unknown[]) => {
				const tables = args[1];
				if (Array.isArray(tables) && tables.includes(repository.fileStore.importJournal) && ++batchTransactions === 2) {
					return Dexie.Promise.resolve(repository.save("asset", { ...row.asset, username: "changed@example.test" }))
						.then(() => Reflect.apply(transaction, repository.fileStore, args));
				}
				return Reflect.apply(transaction, repository.fileStore, args);
			}) as typeof repository.fileStore.transaction);
			await expect(ensure(repository, [row])).rejects.toThrow("asset-stale");
			intercept.mockRestore();
			expect(await repository.list("asset")).toHaveLength(1);
			expect(await repository.list("relation")).toHaveLength(0);
			expect(await repository.fileStore.importJournal.count()).toBe(0);
			const retry = await ensure(repository, [row]);
			expect(retry.links[0].target.username).toBe("changed@example.test");
			expect(retry.createdRelations).toBe(1);
		} finally { vi.restoreAllMocks(); await repository.close(); }
	});

	it("rejects an existing identity changed before the gated link insert", async () => {
		const repository = await openLocalRepository(repoName()), row = fixture(1);
		try {
			await accept(repository, [row]);
			const identity = { ...newAsset("account"), name: "My mail", category: "email", username: row.asset.username };
			await repository.save("asset", identity);
			const guarded = repository.saveBatchIfAssetsCurrent.bind(repository);
			const intercept = vi.spyOn(repository, "saveBatchIfAssetsCurrent").mockImplementationOnce(async (items, expected) => {
				await repository.save("asset", { ...identity, username: "different@example.test" });
				return guarded(items, expected);
			});
			await expect(ensure(repository, [row])).rejects.toThrow("asset-stale");
			intercept.mockRestore();
			expect(await repository.list("relation")).toHaveLength(0);
			expect(await repository.fileStore.importJournal.count()).toBe(0);
		} finally { vi.restoreAllMocks(); await repository.close(); }
	});

	it("blocks identity writes while a restore or archive merge is unresolved, then permits the same retry", async () => {
		const repository = await openLocalRepository(repoName()), row = fixture(1);
		try {
			await accept(repository, [row]);
			await repository.fileStore.journal.put({ id: "pending-restore", rows: [] });
			await expect(ensure(repository, [row])).rejects.toThrow("restore-recovery-pending");
			expect(await repository.list("asset")).toHaveLength(1);
			expect(await repository.fileStore.importJournal.count()).toBe(0);
			await repository.fileStore.journal.clear();
			await repository.fileStore.archiveMerge.put({ id: "active", phase: "applying", archiveHash: "a".repeat(64), targetFingerprint: "b".repeat(64), changes: [], addedFileIds: [], insertedFileIds: [] });
			await expect(ensure(repository, [row])).rejects.toThrow("archive-merge-pending");
			expect(await repository.list("relation")).toHaveLength(0);
			await repository.fileStore.archiveMerge.clear();
			expect(await ensure(repository, [row])).toMatchObject({ createdAssets: 1, createdRelations: 1 });
		} finally { await repository.close(); }
	});
});

it("joins older ordinary accounts when a reviewed import first creates the shared identity",async()=>{
 const repo=await openLocalRepository(repoName());
 const older={...newAsset("account"),name:"Previously saved",category:"other",username:"READER@example.test",url:"https://example.test/deep?keep=yes",notes:"private untouched note"};
 try{
  await repo.save("asset",older);const row=fixture(80);await accept(repo,[row]);
  const result=await ensure(repo,[row]);expect(result).toMatchObject({createdAssets:1,createdRelations:2});
  expect(await repo.get("asset",older.id)).toEqual(older);
  const lines=await repo.list<Relation>("relation");expect(lines.filter(line=>line.from===older.id)).toHaveLength(1);
  expect(await ensure(repo,[row])).toMatchObject({createdAssets:0,createdRelations:0});
 }finally{await repo.close();}
});

it("keeps a deliberately deleted older connection deleted during a different reviewed import",async()=>{
 const repo=await openLocalRepository(repoName());
 try{
  const first=fixture(90);await accept(repo,[first]);await ensure(repo,[first]);
  const [line]=await repo.list<Relation>("relation");await repo.saveRelationIfCurrent(line,{...line,deleted:true});
  const second=fixture(91);await accept(repo,[second]);await ensure(repo,[second]);
  const live=await repo.list<Relation>("relation");expect(live).toHaveLength(1);expect(live[0].from).toBe(second.asset.id);
 }finally{await repo.close();}
});
