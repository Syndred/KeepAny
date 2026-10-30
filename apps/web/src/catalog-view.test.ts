import { describe, expect, it } from "vitest";
import { newAsset } from "../../../packages/domain/src";
import { catalogAssets, catalogScope, sortCatalogRows } from "./catalog-view";
describe("catalog task views", () => {
  const active = { ...newAsset("project"), name: "Active", updatedAt: "2026-10-29" };
  const paused = { ...newAsset("subscription"), name: "Paused", status: "paused" as const, dueDate: "2026-11-03", updatedAt: "2026-10-30" };
  const archived = { ...newAsset("item"), name: "Archived", status: "archived" as const };
  const deleted = { ...newAsset("item"), name: "Deleted", deleted: true };
  it("defaults can hide inactive records without removing them from all or history views", () => {
    expect(catalogAssets([active, paused, archived, deleted], "managed", "updated")).toEqual([active]);
    expect(catalogAssets([active, paused, archived, deleted], "all", "updated")).toHaveLength(3);
    expect(catalogAssets([active, paused, archived, deleted], "archived", "updated").map(row => row.name).sort()).toEqual(["Archived", "Paused"]);
  });
  it("orders due dates first and retains undated records", () => {
    expect(catalogAssets([active, paused], "all", "due").map(row => row.name)).toEqual(["Paused", "Active"]);
    expect(catalogAssets([active, paused], "all", "updated").map(row => row.name)).toEqual(["Paused", "Active"]);
  });
  it("recovers an invalid stored scope and interleaves domain and subscription deadlines", () => {
    expect(catalogScope("retired-setting")).toBe("managed");
    const domain = { id: "domain", name: "earlier.example.test", expiryDate: "2026-11-01" } as NonNullable<typeof active.projectDomains>[number];
    const rows = sortCatalogRows([{ type: "asset", asset: paused }, { type: "asset", asset: active }, { type: "domain", project: active, domain, remainingDays: 2 }], "due");
    expect(rows.map(row => row.type === "asset" ? row.asset.name : row.domain.name)).toEqual(["earlier.example.test", "Paused", "Active"]);
  });
});
