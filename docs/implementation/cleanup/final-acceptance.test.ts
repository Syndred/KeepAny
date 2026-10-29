import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const folder = fileURLToPath(new URL("../../qa/2026-10-29/final-integration/", import.meta.url));
const json = (name: string) => JSON.parse(readFileSync(resolve(folder, name), "utf8"));
const record = json("验收记录.json");
const candidate = json("candidate.json");
const independent = json("independent-verdict.json");

// This checks the frozen historical receipt's integrity, never the visual quality
// of a future source revision. Daily runtime checks consume their own clean build.
describe("frozen cleanup acceptance receipt", () => {
  it("keeps coverage, manual verdicts and release boundaries explicit", () => {
    expect(record.schema).toBe("keepany.cleanup-acceptance.v1");
    expect(record.scope).toBe("cleanup-and-integration-only");
    expect(record.coverage.map((row: { id: string }) => row.id)).toEqual(Array.from({ length: 9 }, (_, i) => `S0${i + 1}`));
    for (const row of record.coverage) {
      expect(row.actual.length).toBeGreaterThan(10);
      expect(row.evidence.length).toBeGreaterThan(0);
      expect(["passed", "pending-remote-merge"]).toContain(row.status);
      if (row.status === "pending-remote-merge") expect(row.id).toBe("S09");
    }
    for (const key of ["functional", "visual", "whitebox", "ownerUserPath", "independentReview"]) expect(record.verdicts[key]).toBe("passed");
    expect(record.fullProductAcceptance).toBe(false);
    expect(record.fullRelease).toBe("not_run");
    expect(record.realPostgres).toBe("not_run");
    expect(record.delivery.pullRequest).toBe("https://github.com/Syndred/KeepAny/pull/2");
  });

  it("binds independent manual evidence to the same complete candidate", () => {
    expect(independent.mergePermitted).toBe(true);
    expect(independent.candidateHead).toBe(candidate.sourceCommit);
    expect(independent.manifestSha256).toBe(candidate.webManifestSha256);
    expect(independent.actualIndexSha256).toBe(candidate.indexSha256);
    expect(independent.report).toBe("报告.md");
    expect(createHash("sha256").update(readFileSync(resolve(folder, independent.report))).digest("hex")).toBe(independent.reportSha256);
    expect(json("web-manifest.json")).toHaveLength(candidate.webFileCount);
    expect(json("product-source.json")).toHaveLength(candidate.productSourceCount);
    for (const name of ["web-manifest.json", "product-source.json"]) {
      const expected = name === "web-manifest.json" ? candidate.webManifestSha256 : candidate.productSourceSha256;
      expect(createHash("sha256").update(readFileSync(resolve(folder, name))).digest("hex")).toBe(expected);
    }
  });

  it("keeps every published evidence byte and a safe unique path", () => {
    const seen = new Set<string>();
    for (const item of record.evidence) {
      expect(item.path.split(/[\\/]/)).not.toContain("..");
      expect(item.path).not.toMatch(/^(?:[A-Za-z]:|\/)/);
      expect(seen.has(item.path)).toBe(false);
      seen.add(item.path);
      const bytes = readFileSync(resolve(folder, item.path));
      expect(bytes.length).toBe(item.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(item.sha256);
    }
    for (const row of record.coverage) for (const path of row.evidence) expect(seen.has(path)).toBe(true);
  });
});
