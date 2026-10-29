import { describe, expect, it } from "vitest";
import {
	workspaceNavHidden,
	workspaceNavOrder,
	workspacePathGroup,
} from "./workspace-navigation";

describe("merged workspace navigation compatibility", () => {
	it("uses the approved order for a workspace without a custom order", () => {
		expect(workspaceNavOrder([])).toEqual([
			"overview",
			"accounts",
			"assets",
			"tasks",
		]);
	});
	it("keeps the first old group position, drops duplicates and retains all groups", () => {
		expect(
			workspaceNavOrder([
				"overview",
				"vault",
				"item",
				"tasks",
				"account",
				"project",
				"subscription",
			]),
		).toEqual(["overview", "accounts", "assets", "tasks"]);
		expect(workspaceNavOrder([null, "unexpected", "accounts"])).toEqual([
			"accounts",
			"overview",
			"tasks",
			"assets",
		]);
	});
	it("keeps a merged group visible when an old member was visible", () => {
		expect(workspaceNavHidden(["account", "project"])).toEqual([]);
		expect(workspaceNavHidden(["account", "vault", "tasks"])).toEqual([
			"tasks",
			"accounts",
		]);
		expect(workspaceNavHidden(["overview", "assets", "accounts"])).toEqual([
			"accounts",
		]);
		expect(workspaceNavHidden(["project", "item", "subscription"])).toEqual([
			"assets",
		]);
	});
	it("selects one group for current and legacy detail, workflow and ledger URLs", () => {
		for (const path of [
			"/accounts",
			"/assets/account",
			"/assets/account/example",
			"/assets/vault",
		])
			expect(workspacePathGroup(path)).toBe("accounts");
		for (const path of [
			"/assets",
			"/assets/project",
			"/assets/project/id/workflow/close",
			"/assets/item/id",
			"/assets/subscription",
			"/assets/domains",
			"/assets/online",
			"/assets/physical",
			"/finance",
		])
			expect(workspacePathGroup(path)).toBe("assets");
		expect(workspacePathGroup("/collections")).toBeUndefined();
	});
});
