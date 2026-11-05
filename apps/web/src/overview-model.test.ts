import { describe, expect, it } from "vitest";
import { newAsset, taskSchema, type Asset } from "../../../packages/domain/src";
import { buildOverviewAttention, overviewGraphData } from "./overview-model";
import { layoutWorkspaceGraph } from "./account-graph-layout";
import { createMaintenanceSchedule } from "../../../packages/domain/src/task-repeat";
import { createTaskReminder } from "../../../packages/domain/src/task-reminder";

const asset = (id: string, kind: Asset["kind"] = "subscription", dueDate = ""): Asset => ({ ...newAsset(kind), id, name: id, dueDate });
const task = (id: string, dueDate: string, extra = {}) => taskSchema.parse({ id, name: id, dueDate, createdAt: "", ...extra });
describe("overview contract", () => {
 it("OV02 includes disconnected families and isolated assets without inventing edges", async () => {
  const assets = [asset("a", "account"), asset("b", "item"), asset("c", "project"), asset("d"), asset("alone"), { ...asset("deleted"), deleted: true }, asset("vault", "vault")];
  const edge = (from: string, to: string) => ({ id: `${from}-${to}`, from, to, label: "real", createdAt: "", verifiedAt: "", deleted: false });
  const graph = overviewGraphData(assets, [edge("a", "b"), edge("c", "d"), edge("a", "deleted"), edge("a", "missing"), edge("a", "a")], []);
  expect(graph.assets.map(a => a.id)).toEqual(["a", "b", "c", "d", "alone"]);
  const layout = await layoutWorkspaceGraph(graph.assets, graph.relations, { width: 1100, height: 560 });
  expect([...layout.nodes.keys()].sort()).toEqual(["a", "alone", "b", "c", "d"]);
  expect(layout.edges.size).toBe(2);
  const nodes = [...layout.nodes.values()];
  for (const [i, a] of nodes.entries()) for (const b of nodes.slice(i + 1)) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
 });
 it("OV05 sorts natural days, excludes undated/inactive/completed records and separates overdue", () => {
  const assets = [asset("seven", "subscription", "2026-11-12"), asset("two", "subscription", "2026-11-07"), asset("three", "subscription", "2026-11-08"), asset("today", "subscription", "2026-11-05"), asset("overdue", "subscription", "2026-11-04"), asset("undated"), { ...asset("cancelled", "subscription", "2026-11-06"), status: "cancelled" as const }];
  const result = buildOverviewAttention(assets, [task("done", "2026-11-06", { done: true }), task("missing-owner", "2026-11-06", { assetId: "missing" })], "2026-11-05");
  expect(result.upcoming.map(row => [row.name, row.days])).toEqual([["today", 0], ["two", 2], ["three", 3], ["seven", 7]]);
  expect(result.overdue.map(row => row.name)).toEqual(["overdue"]);
  expect(buildOverviewAttention(assets, [], "2026-11-06").upcoming[0].days).toBe(1);
 });
 it("OV06 deduplicates repeated record IDs, retains distinct tasks and never mutates schedules", () => {
  const a = asset("two", "subscription", "2026-11-07");
  const t = task("one", "2026-11-07"), other = task("other", "2026-11-07");
  const before = JSON.stringify([a, t, other]);
  expect(buildOverviewAttention([a, a], [t, t, other], "2026-11-05").upcoming).toHaveLength(3);
  expect(JSON.stringify([a, t, other])).toBe(before);
 });
 it("OV05-07 ignores invalid dates and reads only the current deferred maintenance occurrence across calendar boundaries", () => {
  const item = asset("item", "item"), schedule = createMaintenanceSchedule({ dueDate: "2026-11-05", rule: { mode: "fixed", unit: "month", every: 1 } });
  const maintenance = task("maintenance", "2026-11-08", { assetId: item.id, maintenancePlan: { schedule, active: true, deferredUntil: "2026-11-08", records: [] } });
  const before = JSON.stringify(maintenance);
  const rows = buildOverviewAttention([item, asset("invalid", "subscription", "2026-02-30")], [maintenance], "2026-11-05");
  expect(rows.upcoming.map(row => [row.id, row.days])).toEqual([["task-maintenance", 3]]);
  expect(buildOverviewAttention([item], [maintenance], "2026-11-08").upcoming[0].days).toBe(0);
  expect(buildOverviewAttention([item], [maintenance], "2026-11-09").overdue[0].days).toBe(-1);
  expect(JSON.stringify(maintenance)).toBe(before);
  expect(buildOverviewAttention([asset("leap", "subscription", "2028-03-01")], [], "2028-02-28").upcoming[0].days).toBe(2);
 });
 it("OV02 supports empty and single-record graphs and filters purged records", async () => {
  expect((await layoutWorkspaceGraph([], [], { width: 390, height: 440 })).nodes.size).toBe(0);
  const single = asset("alone", "project");
  expect((await layoutWorkspaceGraph([single], [], { width: 390, height: 440 })).nodes.size).toBe(1);
  expect(overviewGraphData([{ ...single, purged: true }], [], []).assets).toHaveLength(0);
 });
 it("OV07 counts timed reminders in the viewing zone while date-only records keep their calendar date", () => {
  const timed = task("zoned", "2026-11-05", { reminder: createTaskReminder({ at: "2026-11-06T07:00:00.000Z", timeZone: "America/Los_Angeles" }) });
  expect(buildOverviewAttention([], [timed], "2026-11-06", "Asia/Shanghai").upcoming[0]).toMatchObject({ days: 0, dueDate: "2026-11-06" });
  expect(buildOverviewAttention([], [timed], "2026-11-05", "America/Los_Angeles").upcoming[0]).toMatchObject({ days: 0, dueDate: "2026-11-05" });
  expect(buildOverviewAttention([asset("date-only", "subscription", "2026-11-05")], [], "2026-11-06", "Asia/Shanghai").overdue[0].days).toBe(-1);
 });
 it("OV04 projects only unlocked summaries, without copying credentials into graph records", () => {
  const item = asset("item", "item");
  const entry = { id: "private", title: "Private title", username: "private@example.test", url: "https://secret.example.test", linkedAssetIds: [item.id], modifiedAt: "", password: "never-copy", notes: "never-copy-notes" };
  const unlocked = overviewGraphData([item], [], [entry as never]);
  expect(unlocked.assets.map(a => a.id)).toEqual(["item", "login-private"]);
  expect(unlocked.relations.map(r => [r.from, r.to])).toEqual([["login-private", "item"]]);
  expect(JSON.stringify(unlocked)).not.toMatch(/never-copy|private@example|secret.example/);
  expect(overviewGraphData([item], [], []).assets).toEqual([item]);
 });
 it.each([[["a", "item"]], [["a", "b", "item"]], [["a", "b"]]])("OV04 retains explicit encrypted mixed/multiple-account links %j", linkedAssetIds => {
  const assets = [asset("a", "account"), asset("b", "account"), asset("item", "item")];
  const entry = { id: "mixed", title: "Mixed private login", linkedAssetIds, modifiedAt: "" };
  const graph = overviewGraphData(assets, [], [entry as never]);
  expect(graph.assets.map(a => a.id)).toContain("login-mixed");
  expect(graph.relations.map(r => [r.from, r.to])).toEqual(linkedAssetIds.map(id => ["login-mixed", id]));
  expect(overviewGraphData(assets, [], []).relations).toHaveLength(0);
 });
 it("OV04 represents a single ordinary-account login by that account without a duplicate node", () => {
  const a = asset("a", "account");
  expect(overviewGraphData([a], [], [{ id: "single", linkedAssetIds: [a.id] } as never]).assets).toEqual([a]);
 });
});
