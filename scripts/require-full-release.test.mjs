import { describe, expect, it } from "vitest";
import { requireFullRelease, requiredReleaseJobs } from "./require-full-release.mjs";

const sha = "a".repeat(40);
const full = { id: 5, head_sha: sha, path: ".github/workflows/verify.yml", name: "Verify local release", event: "workflow_dispatch", status: "completed", conclusion: "success" };
const passed = () => requiredReleaseJobs.map(name => ({ name, status: "completed", conclusion: "success" }));
function client(runs = [full], jobs = passed()) {
  const actions = { listWorkflowRuns: "runs", listJobsForWorkflowRun: "jobs" };
  return { rest: { actions }, paginate: async (method, options) => {
    expect(options.per_page).toBe(100);
    if (method === "runs") {
      expect(options.workflow_id).toBe("verify.yml"); expect(options.head_sha).toBe(sha);
      return runs;
    }
    expect(options.run_id).toBe(5); expect(options.filter).toBe("latest");
    return jobs;
  } };
}
const gate = github => requireFullRelease({ github, owner: "synthetic", repo: "synthetic", sha });
describe("publication requires actual full release acceptance", () => {
  it("accepts the exact source only after every required release job succeeds", async () => {
    expect(await gate(client())).toEqual(full);
  });
  it.each([
    [],
    [{ ...full, head_sha: "b".repeat(40) }],
    [{ ...full, path: ".github/workflows/daily.yml" }],
    [{ ...full, event: "push" }],
    [{ ...full, conclusion: "failure" }],
    [full, { ...full, id: 6, status: "in_progress", conclusion: null }],
  ].map(runs => ({ runs })))("rejects missing, stale, lightweight or superseded runs $runs", async ({ runs }) => {
    await expect(gate(client(runs))).rejects.toThrow("Full manual release checks");
  });
  it.each(requiredReleaseJobs)("rejects absent/skipped/failing required job %s", async name => {
    for (const conclusion of ["skipped", "failure", "cancelled"]) {
      const jobs = passed().map(row => row.name === name ? { ...row, conclusion } : row);
      await expect(gate(client([full], jobs))).rejects.toThrow(name);
    }
    await expect(gate(client([full], passed().filter(row => row.name !== name)))).rejects.toThrow(name);
  });
});
