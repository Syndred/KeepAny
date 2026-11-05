import { describe, expect, it } from "vitest";
import { newAsset, type Asset } from "../../../packages/domain/src";
import type { VaultEntrySummary } from "../../../packages/password-vault/src";
import { rankRelatedAccounts } from "./related-accounts";

const account = (id: string, name = "Service", username = ""): Asset => ({ ...newAsset("account"), id, name, username });
const login = (id: string, overrides: Partial<VaultEntrySummary> = {}): VaultEntrySummary => ({ id, title: "Service", username: "", url: "", linkedAssetIds: [], modifiedAt: "2026-11-05T01:00:00Z", historyCount: 0, ...overrides });

describe("related account ranking", () => {
	it("orders multiple exact evidence ahead of template, identifier and name-only matches", () => {
		const asset = account("current", "Service", "13800000056"), entry = login("source", { linkedAssetIds: [asset.id], username: asset.username });
		const entries = [entry, login("combined", { templateSourceId: "source", username: "+86 138 0000 0056" }), login("template", { title: "Other name", templateSourceId: "source" }), login("phone", { title: "Another service", username: "13800000056" }), login("name")];
		const rows = rankRelatedAccounts({ asset, entry, assets: [asset], entries }, 10);
		expect(rows.map(row => row.entryId)).toEqual(["combined", "template", "phone", "name"]);
		expect(rows[0].reasons).toEqual(["template", "phone", "name"]);
		expect(rankRelatedAccounts({ asset, entry, assets: [asset], entries })).toHaveLength(3);
	});
	it("does not invent template lineage from matching names or URLs", () => {
		const asset = account("current"), entry = login("source", { url: "https://same.example.test" });
		const rows = rankRelatedAccounts({ asset, entry, assets: [asset], entries: [entry, login("other", { url: entry.url })] });
		expect(rows[0].reasons).toEqual(["name"]);
	});
	it("resolves ancestor and sibling provenance while refusing cyclic lineage", () => {
		const asset = account("current", "Current");
		const source = login("root", { title: "Root" }), entry = login("child", { title: "Current", templateSourceId: "root" });
		const sibling = login("sibling", { title: "Sibling", templateSourceId: "root" }), grandchild = login("grandchild", { title: "Grandchild", templateSourceId: "sibling" });
		expect(rankRelatedAccounts({ asset, entry, assets: [asset], entries: [source, entry, sibling, grandchild] }, 10).map(row => row.entryId).sort()).toEqual(["grandchild", "root", "sibling"]);
		const a = login("a", { title: "Current", templateSourceId: "b" }), b = login("b", { title: "Other", templateSourceId: "a" });
		expect(rankRelatedAccounts({ asset, entry: a, assets: [asset], entries: [a, b] })).toEqual([]);
	});
	it("recognizes matching aliases with conservative phone and email normalization", () => {
		const asset = account("current", "Current"), entry = login("source", { title: "Current", usernameAliases: ["+1 (212) 555-0123", "Local@example.test"] });
		const rows = rankRelatedAccounts({ asset, entry, assets: [asset], entries: [entry, login("phone", { title: "A", username: "+12125550123" }), login("email", { title: "B", username: "Local@EXAMPLE.TEST" }), login("wrong-country", { title: "C", username: "+442125550123" }), login("local-case", { title: "D", username: "local@example.test" }), login("dot", { title: "E", username: "Lo.cal@example.test" }), login("tag", { title: "F", username: "Local+tag@example.test" })] }, 10);
		expect(rows.map(row => row.entryId).sort()).toEqual(["email", "phone"]);
	});
	it("does not match empty values or arbitrary numeric handles", () => {
		const asset = account("current", " ", "12345");
		expect(rankRelatedAccounts({ asset, assets: [asset, account("other", "", "12345")], entries: [] })).toEqual([]);
	});
	it("deduplicates shared account projections, excludes self and AI keys, and preserves private navigation", () => {
		const asset = account("current"), other = account("other");
		const entry = login("source", { linkedAssetIds: [asset.id] });
		const entries = [entry, login("second", { linkedAssetIds: ["other", "other"] }), login("first", { linkedAssetIds: ["other"] }), login("private"), login("service-key", { isAiKey: true })];
		const rows = rankRelatedAccounts({ asset, entry, assets: [asset, other], entries }, 10);
		expect(rows).toHaveLength(2);
		expect(rows.find(row => row.assetId === "other")).toMatchObject({ entryId: "first", key: "asset:other" });
		expect(rows.find(row => row.entryId === "private")).not.toHaveProperty("assetId");
		expect(rows.some(row => row.entryId === "service-key" || row.entryId === "source")).toBe(false);
	});
	it("includes ordinary accounts without a login and never emits deleted ordinary targets", () => {
		const asset = account("current");
		const rows = rankRelatedAccounts({ asset, assets: [asset, account("other"), { ...account("deleted"), deleted: true }], entries: [] });
		expect(rows.map(row => row.assetId)).toEqual(["other"]);
	});
	it("ties are stable across source order and invalid limits are empty", () => {
		const asset = account("current"), entries = [login("b"), login("a")];
		expect(rankRelatedAccounts({ asset, assets: [asset], entries }).map(row => row.key)).toEqual(rankRelatedAccounts({ asset, assets: [asset], entries: [...entries].reverse() }).map(row => row.key));
		for (const limit of [0, -1, NaN, 0.5]) expect(rankRelatedAccounts({ asset, assets: [asset], entries }, limit)).toEqual([]);
	});
	it("does not expose a stale private selection after its entry leaves unlocked summaries", () => {
		const asset = account("current");
		expect(rankRelatedAccounts({ asset, entry: login("stale"), assets: [asset], entries: [login("other")] })).toEqual([]);
	});
	it("never reads password or notes from projected entries", () => {
		const asset = account("current"), other = login("other");
		Object.defineProperties(other, { password: { get() { throw Error("secret-read"); } }, notes: { get() { throw Error("secret-read"); } } });
		expect(rankRelatedAccounts({ asset, assets: [asset], entries: [other] })[0].entryId).toBe("other");
	});
});
