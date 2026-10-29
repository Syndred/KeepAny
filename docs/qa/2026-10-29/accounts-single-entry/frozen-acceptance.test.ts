import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const folder = fileURLToPath(new URL("./", import.meta.url));
const json = (name: string) => JSON.parse(readFileSync(resolve(folder, name), "utf8"));
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const product = "fa357da7c1c6bcd2618693d6e813c48500dacec9";
const archive = "e0e38d7aba3dcd7d1229094a5e48bbae7f72983117d3e04830f65839ba0867f2";

// Integrity of this frozen receipt only. Future UI acceptance still requires
// its own compiled candidate, actual user journey and independent visual review.
describe("frozen single-entry acceptance receipt", () => {
	it("keeps all sixteen contract results and manual boundaries explicit", () => {
		const record = json("最终覆盖结果.json");
		expect(record.state).toBe("complete-scoped-acceptance");
		expect(record.productSourceCommit).toBe(product);
		expect(record.archiveSha256).toBe(archive);
		expect(record.rows.map((row: { id: string }) => row.id)).toEqual(
			Array.from({ length: 16 }, (_, index) => `SE${String(index + 1).padStart(2, "0")}`),
		);
		for (const row of record.rows) {
			expect(row.verdict).toBe("pass");
			expect(row.candidate).toBe(product);
			expect(row.actual.length).toBeGreaterThan(10);
			expect(row.evidence.length).toBeGreaterThan(0);
		}
		for (const dimension of ["functional", "whitebox", "visual", "controllerPersona", "independent"])
			expect(record.dimensions[dimension]).toBe("pass");
		expect(record.cloudCi).toBe("not run");
		expect(record.publication).toBe("not published");
		expect(record.boundaries).toHaveLength(3);
	});

	it("binds the independent runs and actual image review to the same candidate", () => {
		const independent = json("independent-results-fa357d.json");
		expect(independent.candidate.sourceCommit).toBe(product);
		expect(independent.candidate.archiveSha256).toBe(archive);
		expect(independent.candidate.sourceDirty).toBe(false);
		expect(independent.candidate.archiveIndexIdentical).toBe(true);
		expect(independent.verdict).toBe("pass");
		expect(independent.reviewer).not.toBe("root");
		expect(independent.runs.map((run: { stats: { expected: number } }) => run.stats.expected)).toEqual([20, 8]);
		for (const run of independent.runs) {
			expect(run.stats.skipped).toBe(0);
			expect(run.stats.unexpected).toBe(0);
			expect(run.stats.flaky).toBe(0);
			expect(run.workers).toBe(1);
			for (const test of run.tests) {
				expect(test.status).toBe("expected");
				expect(test.results).toHaveLength(1);
				expect(test.results[0].status).toBe("passed");
				expect(test.results[0].retry).toBe(0);
			}
		}
		const visual = json("independent-visual-reviewed-fa357d.json");
		expect(visual.candidate).toBe(product);
		expect(visual.archiveSha256).toBe(archive);
		expect(visual.files).toHaveLength(72);
		expect(new Set(visual.files.map((file: { path: string }) => file.path)).size).toBe(72);
		for (const file of visual.files) {
			expect(file.verdict).toBe("pass");
			expect(file.observation.length).toBeGreaterThan(10);
			expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
		}
		const retained = readdirSync(resolve(folder, "independent-final-fa357d")).filter(name => name.endsWith(".png"));
		expect(retained.length).toBeGreaterThanOrEqual(6);
		for (const name of retained) {
			const original = visual.files.find((file: { path: string }) => basename(file.path) === name);
			expect(original, name).toBeDefined();
			expect(sha256(readFileSync(resolve(folder, "independent-final-fa357d", name)))).toBe(original.sha256);
		}
		const auxiliary = json("independent-aux-visual-fa357d.json");
		expect(auxiliary.candidate).toBe(product);
		expect(auxiliary.archiveSha256).toBe(archive);
		expect(auxiliary.summary.unresolvedVisualEvidenceIssues).toBe(0);
		for (const file of auxiliary.files) {
			if (file.verdict === "pass") continue;
			expect(file.verdict).toBe("evidence-insufficient/transitional");
			expect(file.unresolved).toBe(false);
			expect(file.resolvedBy.length).toBeGreaterThan(0);
			for (const replacement of file.resolvedBy)
				expect(auxiliary.files.find((item: { path: string }) => item.path === replacement)?.verdict).toBe("pass");
		}
	});

	it("preserves the controller evidence bytes and source/runtime identity", () => {
		const index = json("controller-evidence-fa357d.json");
		expect(index.candidate).toBe(product);
		expect(index.archiveSha256).toBe(archive);
		expect(index.actor).toBe("root");
		expect(index.files).toHaveLength(15);
		const seen = new Set<string>();
		for (const item of index.files) {
			expect(item.path.split(/[\\/]/)).not.toContain("..");
			expect(item.path).not.toMatch(/^(?:[A-Za-z]:|[\\/])/);
			expect(seen.has(item.path)).toBe(false);
			seen.add(item.path);
			const bytes = readFileSync(resolve(folder, item.path));
			expect(bytes.length).toBe(item.bytes);
			expect(sha256(bytes)).toBe(item.sha256);
		}
		const identity = json("候选一致性.json");
		expect(identity.productSourceCommit).toBe(product);
		expect(identity.archive.sha256).toBe(archive);
		expect(identity.archive.sourceDirty).toBe(false);
		expect(identity.sourceSnapshot.mismatches).toEqual([]);
		expect(identity.sourceSnapshot.checked).toBe(433);
		const local = json("controller-final-fa357d/local-4180.json");
		expect(local.candidate).toBe(product);
		expect(local.archiveSha256).toBe(archive);
		expect(local.verifiedCurrentFiles).toBe(124);
		expect(local.verifiedRetainedFiles).toBe(3126);
		expect(local.actualUi.cancelWritesNothing).toBe(true);
		const independentHttp = json("independent-final-fa357d/local-4180-http.json");
		expect(independentHttp.candidate).toBe(product);
		expect(independentHttp.archiveSha256).toBe(archive);
		expect(independentHttp.verdict).toBe("pass");
		for (const result of independentHttp.results) {
			expect(result.status).toBe(200);
			expect(result.actualSha256).toBe(result.expectedSha256);
		}
	});
});
