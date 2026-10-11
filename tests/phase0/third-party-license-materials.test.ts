import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
type Manifest = {
	materials: Array<{ id: string; path: string; sha256: string; source: Record<string, unknown> }>;
	packages: Array<Record<string, unknown>>;
	scope: Record<string, number>;
	bundle: Record<string, number>;
};

function check(mutate?: (manifest: Manifest, directory: string) => void) {
	const directory = mkdtempSync(join(tmpdir(), "keepany-license-gate-test-"));
	try {
		cpSync(join(root, "legal"), join(directory, "legal"), { recursive: true });
		cpSync(join(root, "scripts/phase0/verify-third-party-license-materials.mjs"), join(directory, "scripts/phase0/verify-third-party-license-materials.mjs"), { recursive: true });
		const path = join(directory, "legal/third-party/manifest.json");
		const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
		mutate?.(manifest, directory);
		writeFileSync(path, JSON.stringify(manifest));
		return spawnSync(process.execPath, [join(directory, "scripts/phase0/verify-third-party-license-materials.mjs"), "--release"], { encoding: "utf8" });
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing expected license test fixture");
	return value;
}
const supplemented = (manifest: Manifest) => required(manifest.packages.find(item => item.name === "react-remove-scroll-bar" && item.version === "2.3.8"));

it("accepts exact MIT declarations with separately labelled normative and attribution evidence", () => {
	const result = check();
	expect(result.status, result.stderr).toBe(0);
	expect(result.stdout).toContain("5 declared with labelled supplement, 0 unresolved");
});

it("rejects an unknown original declaration even when file hashes are updated", () => {
	const result = check((manifest, directory) => {
		const item = supplemented(manifest);
		const evidence = item.npmEvidence as { packageJson: string };
		const material = required(manifest.materials.find(value => value.id === evidence.packageJson));
		const path = join(directory, material.path);
		const declaration = JSON.parse(readFileSync(path, "utf8"));
		declaration.license = "NOASSERTION";
		const bytes = Buffer.from(JSON.stringify(declaration));
		writeFileSync(path, bytes);
		material.sha256 = createHash("sha256").update(bytes).digest("hex");
	});
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("original package declaration does not match name/version/MIT");
});

it("rejects invented attribution instead of treating author metadata as copyright ownership", () => {
	const result = check(manifest => {
		const item = supplemented(manifest);
		(item.npmEvidence as { author: unknown }).author = "Invented copyright holder";
	});
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("attribution metadata does not match");
});

it("rejects a mismatched exact tarball binding", () => {
	const result = check(manifest => {
		const item = supplemented(manifest);
		const evidence = item.npmEvidence as { readme: string };
		const material = required(manifest.materials.find(value => value.id === evidence.readme));
		(material.source.npm as { version: string }).version = "2.3.7";
	});
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("is not bound to the exact declared tarball");
});

it("rejects a missing normative supplement and corrupted source bytes", () => {
	const missing = check(manifest => { supplemented(manifest).licenseSupplement = "missing-normative-text"; });
	expect(missing.status).toBe(1);
	expect(missing.stderr).toContain("lacks a referenced MIT normative supplement");
	const mislabelled = check(manifest => {
		const item = supplemented(manifest);
		item.status = "verified";
		item.upstream = { materials: [] };
	});
	expect(mislabelled.status).toBe(1);
	expect(mislabelled.stderr).toContain("verified original text must not reference a normative supplement");
	const corrupted = check((manifest, directory) => {
		writeFileSync(join(directory, manifest.materials[0].path), "corrupted material");
	});
	expect(corrupted.status).toBe(1);
	expect(corrupted.stderr).toContain("sha256 mismatch");
});

it("blocks a genuinely unresolved package in release mode", () => {
	const result = check(manifest => {
		const item = supplemented(manifest);
		item.status = "unresolved";
		item.reason = "No established license declaration or complete evidence";
		delete item.materials;
		manifest.scope.supplementedPackageCount -= 1;
		manifest.scope.unresolvedPackageCount += 1;
		manifest.bundle.supplementedPackageCount -= 1;
		manifest.bundle.unresolvedPackageCount += 1;
	});
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("release requires complete third-party license materials");
});
