import { describe, expect, it } from "vitest";
import { newAsset, type Asset, type Relation } from "../../../packages/domain/src";
import { accountFamilyGraph, accountGraphLaneCenter, accountGraphNodeSize } from "./account-family-graph";

const asset = (id: string): Asset => ({ ...newAsset("account"), id, name: id });
const relation = (from: string, to: string): Relation => ({
	id: `${from}-${to}`, from, to, label: "Login account", createdAt: "", verifiedAt: "", deleted: false,
});
const map = (ids: string[]) => new Map(ids.map((id) => [id, asset(id)]));

describe("account dependency graph", () => {
	it("separates destination trunks without entering the node columns", () => {
		const centers = [0, 1].map((index) => accountGraphLaneCenter(262, 432, index, 2));
		expect(centers[1] - centers[0]).toBeGreaterThanOrEqual(24);
		for (const center of centers) {
			expect(center).toBeGreaterThanOrEqual(286);
			expect(center).toBeLessThanOrEqual(408);
		}
		const crowded = Array.from({ length: 8 }, (_, index) => accountGraphLaneCenter(262, 432, index, 8));
		expect(new Set(crowded).size).toBe(8);
		expect(crowded[0]).toBeGreaterThanOrEqual(286);
		expect(crowded[7]).toBeLessThanOrEqual(408);
	});
	it("preserves dependency direction and layout when opened from either end", () => {
		const assets = map(["service", "email", "phone"]);
		const relations = [relation("service", "email"), relation("email", "phone")];
		const service = accountFamilyGraph("service", assets, relations);
		const phone = accountFamilyGraph("phone", assets, relations);
		expect(service.positions).toEqual(phone.positions);
		expect(service.positions.get("service")?.x).toBeLessThan(service.positions.get("email")?.x ?? 0);
		expect(service.positions.get("email")?.x).toBeLessThan(service.positions.get("phone")?.x ?? 0);
		expect(service.neighbors.map((entry) => entry.id).sort()).toEqual(["email", "phone"]);
	});

	it("separates a crowded shared identity family and ignores collection ordering", () => {
		const ids = ["email", ...Array.from({ length: 20 }, (_, index) => `service-${index}`)];
		const assets = map(ids);
		const relations = ids.slice(1).map((id) => relation(id, "email"));
		const graph = accountFamilyGraph("email", assets, relations);
		const reordered = accountFamilyGraph("email", new Map([...assets].reverse()), [...relations].reverse());
		expect(graph.positions).toEqual(reordered.positions);
		const positions = [...graph.positions.values()];
		for (let i = 0; i < positions.length; i++)
			for (let j = i + 1; j < positions.length; j++) {
				const distanceX = Math.abs(positions[i].x - positions[j].x);
				const distanceY = Math.abs(positions[i].y - positions[j].y);
				expect(distanceX >= accountGraphNodeSize.width + 20 || distanceY >= accountGraphNodeSize.height + 20).toBe(true);
			}
	});

	it("does not cross deleted, missing or self-linked nodes", () => {
		const assets = map(["a", "b", "deleted", "outside"]);
		assets.set("deleted", { ...asset("deleted"), deleted: true });
		const graph = accountFamilyGraph("a", assets, [
			relation("a", "a"), relation("a", "b"), relation("b", "deleted"),
			relation("deleted", "outside"), relation("b", "missing"),
		]);
		expect(graph.neighbors.map((entry) => entry.id)).toEqual(["b"]);
		expect(graph.relations).toEqual([relation("a", "b")]);
		expect(accountFamilyGraph("deleted", assets, []).positions.size).toBe(0);
	});

	it("lays out cycles without overlapping nodes or dropping relationships", () => {
		const graph = accountFamilyGraph("a", map(["a", "b", "c"]), [relation("a", "b"), relation("b", "c"), relation("c", "a")]);
		expect(graph.relations).toHaveLength(3);
		expect(new Set([...graph.positions.values()].map((position) => JSON.stringify(position))).size).toBe(3);
	});
});
