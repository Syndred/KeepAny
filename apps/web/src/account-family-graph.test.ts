import { describe, expect, it } from "vitest";
import { newAsset, type Asset, type Relation } from "../../../packages/domain/src";
import { accountFamilyGraph } from "./account-family-graph";

const asset = (id: string): Asset => ({ ...newAsset("account"), id, name: id });
const relation = (from: string, to: string): Relation => ({ id: `${from}-${to}`, from, to, label: "Login account", createdAt: "", verifiedAt: "", deleted: false });
const map = (ids: string[]) => new Map(ids.map((id) => [id, asset(id)]));

describe("account family topology", () => {
	it("expands the complete connected family without changing stored direction", () => {
		const assets = map(["service", "email", "phone"]);
		const relations = [relation("service", "email"), relation("email", "phone")];
		const service = accountFamilyGraph("service", assets, relations);
		const phone = accountFamilyGraph("phone", assets, relations);
		expect(service.relations).toEqual(relations);
		expect(phone.relations).toEqual(relations);
		expect(service.neighbors.map((entry) => entry.id).sort()).toEqual(["email", "phone"]);
	});
	it("does not cross deleted, missing or self-linked nodes", () => {
		const assets = map(["a", "b", "deleted", "outside"]);
		assets.set("deleted", { ...asset("deleted"), deleted: true });
		const graph = accountFamilyGraph("a", assets, [relation("a", "a"), relation("a", "b"), relation("b", "deleted"), relation("deleted", "outside"), relation("b", "missing")]);
		expect(graph.neighbors.map((entry) => entry.id)).toEqual(["b"]);
		expect(graph.relations).toEqual([relation("a", "b")]);
		expect(accountFamilyGraph("deleted", assets, []).neighbors).toEqual([]);
	});
	it("keeps cycles and multiple purposes as separate records", () => {
		const relations = [relation("a", "b"), relation("b", "c"), relation("c", "a"), { ...relation("a", "b"), id: "recovery", label: "Recovery account" }];
		const graph = accountFamilyGraph("a", map(["a", "b", "c"]), relations);
		expect(graph.relations).toEqual(relations);
		expect(graph.neighbors.map((entry) => entry.id).sort()).toEqual(["b", "c"]);
	});
});
