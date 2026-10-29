import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const folder = fileURLToPath(new URL("../../qa/2026-10-29/nonmobile-selected/", import.meta.url));
const read = (name: string) => readFileSync(resolve(folder, name));
const json = (name: string) => JSON.parse(read(name).toString("utf8"));
const record = json("acceptance.json");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// Integrity of this frozen review; subsequent revisions need their own runtime checks.
// Human inspection and owner experience are explicit attestations, never inferred from counts.
describe("selected nonmobile removal acceptance receipt", () => {
  it("binds every coverage ID and separate verdict to the reviewed candidate", () => {
    expect(record.schema).toBe("keepany.selected-removal-acceptance.v1");
    expect(record.coverage.map((row: { id: string }) => row.id)).toEqual(Array.from({ length: 8 }, (_, i) => `RM0${i + 1}`));
    for (const row of record.coverage) {
      expect(row.candidate).toBe(record.candidate);
      expect(row.actual.length).toBeGreaterThan(10);
      expect(row.evidence).toContain("evidence.zip");
      expect(row.status).toBe(row.id === "RM06" ? "pending-remote-merge" : "passed");
    }
    expect(record.sourceDirty).toBe(false);
    for (const aspect of ["functional", "visual", "whitebox", "ownerExperience", "independentReview"]) expect(record.verdicts[aspect]).toBe("passed");
    expect(record.fullProductAcceptance).toBe(false);
    expect(record.fullRelease).toBe("not_run");
  });

  it("keeps evidence bytes and complete unique web/source manifests bound", () => {
    const paths = new Set<string>();
    for (const item of record.evidence) {
      expect(item.path).not.toMatch(/^(?:[A-Za-z]:|\/)/);
      expect(item.path.split(/[\\/]/)).not.toContain("..");
      expect(paths.has(item.path)).toBe(false); paths.add(item.path);
      const bytes = read(item.path);
      expect(bytes.length).toBe(item.bytes); expect(sha(bytes)).toBe(item.sha256);
    }
    const web = json("web-manifest.json"), source = json("product-source.json");
    expect(web).toHaveLength(record.webFileCount);
    for (const list of [web, source]) expect(new Set(list.map((item: { path: string }) => item.path)).size).toBe(list.length);
    expect(source.length).toBeGreaterThan(250);
  });

  it("retains first failures separately from the original-budget controlled rechecks", () => {
    const files = unzipSync(read("evidence.zip"));
    const raw = (name: string) => JSON.parse(new TextDecoder().decode(files[`test-results/nonmobile-integration-20261029/${name}`]));
    expect(raw("401bed-portable.json").stats).toMatchObject({ expected: 35, unexpected: 4, flaky: 0 });
    expect(raw("401bed-controlled.json").stats).toMatchObject({ expected: 4, unexpected: 0, skipped: 0, flaky: 0 });
    expect(record.oldAlRouteReceipt).toBe("historical-candidate-mismatch-not-relabelled");
  });
});
