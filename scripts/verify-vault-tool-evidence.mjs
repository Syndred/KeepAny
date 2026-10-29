import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { strFromU8, unzipSync } from "fflate";

// Evidence integrity only. Human visual review and personal experience are separate.
const root = resolve(".");
const output = resolve(process.argv[2] ?? "test-results/vault-tools");
const archive = resolve(
	process.argv[3] ?? process.env.KEEPANY_PREVIEW_ARCHIVE ?? "missing.zip",
);
assert(
	output.startsWith(root + sep) && archive.startsWith(root + sep),
	"Use workspace evidence and candidate paths",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytes = await readFile(archive),
	archiveSha256 = sha(bytes);
assert.equal(
	archiveSha256,
	(await readFile(`${archive}.sha256`, "utf8")).split(/\s+/)[0],
);
const members = unzipSync(bytes),
	manifests = Object.keys(members).filter((path) =>
		path.endsWith("/RELEASE.json"),
	);
assert.equal(manifests.length, 1);
const release = JSON.parse(strFromU8(members[manifests[0]]));
assert.equal(release.schema, "keepany.portable-preview.v1");
const names = [
	"tool-state-receipt.json",
	"advanced-module-receipt.json",
	"vault-status-receipt.json",
	"toast-layer-receipt.json",
];
const receipts = [];
async function walk(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		assert(!entry.isSymbolicLink(), "Evidence symlinks are not accepted");
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await walk(path);
		else if (names.includes(entry.name))
			receipts.push({ path, type: entry.name, bytes: await readFile(path) });
	}
}
await walk(output);
const languages = ["zh-CN", "en"],
	widths = [390, 563, 768, 1280, 1920, 2560];
const expected = new Set(
	languages.flatMap((language) => [
		...widths.map((width) => `toast:${language}:${width}`),
		...widths.flatMap((width) =>
			["accounts", "detail", "standalone"].map(
				(consumer) => `tool:${language}:${width}:${consumer}`,
			),
		),
		...widths.map((width) => `status:${language}:${width}`),
		...["smart-js", "links-js", "smart-css"].map(
			(kind) => `recovery:${language}:${kind}`,
		),
	]),
);
assert.equal(
	receipts.length,
	expected.size,
	"All 66 frozen case combinations are required",
);
const cases = [];
for (const item of receipts) {
	const row = JSON.parse(item.bytes);
	assert.equal(row.archiveSha256, archiveSha256, "Candidate archive changed");
	assert.equal(
		row.sourceCommit,
		release.sourceCommit,
		"Candidate commit changed",
	);
	assert.equal(
		row.sourceDirty,
		release.sourceDirty,
		"Candidate dirty state changed",
	);
	let id, shots;
	if (item.type === "tool-state-receipt.json") {
		id = `tool:${row.locale}:${row.width}:${row.consumer}`;
		assert.deepEqual(row.acceptanceIds, ["FC20-C", "FC20-D", "FC20-F"]);
		assert.equal(row.phases.length, 4);
		for (const mode of ["loading", "error"]) {
			const contextPhases = row.phases.filter((phase) => phase.mode === mode);
			assert(
				contextPhases.length === 2 &&
					contextPhases[0].originalHref &&
					contextPhases.every(
						(phase) => phase.originalHref === contextPhases[0].originalHref,
					),
				"Saved account identity must remain the same within each isolated browser context",
			);
		}
		const phases = new Set();
		shots = [];
		for (const phase of row.phases) {
			const key = `${phase.mode}-${phase.kind}`;
			assert(
				[
					"loading-smart",
					"loading-links",
					"error-smart",
					"error-links",
				].includes(key) && !phases.has(key),
			);
			phases.add(key);
			for (const flag of [
				"completed",
				"closeReturnedToOwnTrigger",
				"noAutomaticDocumentReload",
			])
				assert.equal(phase[flag], true, flag);
			if (phase.mode === "loading")
				for (const flag of [
					"actualModuleResponseFinished",
					"lateModuleDidNotReopen",
					"explicitReopenNormal",
				])
					assert.equal(phase[flag], true, flag);
			else assert.equal(phase.noRetryOnReopen, true);
			assert(
				release.webFiles.some((file) => file.path === phase.toolPath),
				"Fault must name the actual compiled module",
			);
			assert(
				phase.visual.controls.length > 0 &&
					phase.visual.controls.every(
						(control) =>
							Number.isFinite(control.width) &&
							Number.isFinite(control.height) &&
							control.width >= 44 &&
							control.height >= 44,
					),
				"Tool control dimensions must be finite numbers and at least 44px",
			);
			shots.push(`${key}-default.png`);
			for (const state of ["hover", "focus", "pressed"])
				shots.push(`${key}-${state}.png`);
		}
	} else if (item.type === "advanced-module-receipt.json") {
		id = `recovery:${row.locale}:${row.targetKind}`;
		assert.deepEqual(row.acceptanceIds, ["FC20-C", "FC20-D"]);
		assert(row.originalHref, "Saved account identity is required");
		assert.equal(
			row.failures.length,
			1,
			"One real declared module failure is required",
		);
		for (const flag of [
			"noAutomaticRetryOrReloadIn500ms",
			"localErrorKeptCore",
			"closeReturnedFocus",
			"normalAssetEditorCancelPreservedId",
			"explicitReloadAndNormalUnlockPreservedId",
			"actualToolOpenedAndClosed",
			"noAutomaticRetryObserved",
		])
			assert.equal(row[flag], true, flag);
		assert(release.webFiles.some((file) => file.path === row.targetPath));
		shots = ["local-module-error.png", "actual-tool-restored.png"];
	} else if (item.type === "vault-status-receipt.json") {
		id = `status:${row.locale}:${row.width}`;
		assert.deepEqual(row.acceptanceIds, ["FC21-A", "FC21-B", "FC21-C"]);
		assert(row.originalHref, "Saved account identity is required");
		assert.deepEqual(row.states, [
			"empty",
			"unlocked-zero",
			"locked",
			"wrong-master",
			"restored-one",
		]);
		assert.equal(row.completed, true);
		assert.equal(row.persistedAssetAndEntryIds, true);
		assert(row.originalEntryId);
		shots = [
			"empty-vault.png",
			"unlocked-zero-expanded.png",
			"locked.png",
			"restored-one-expanded.png",
		];
	} else {
		id = `toast:${row.locale}:${row.width}`;
		assert.deepEqual(row.acceptanceIds, ["FC22-A", "FC22-B", "FC22-C"]);
		assert.equal(row.originalHrefs.length, 8);
		assert.equal(new Set(row.originalHrefs).size, 8);
		assert(row.originalToastText.length > 0);
		const g = row.geometry;
		assert(
			[g.toastZ, g.backdropZ, g.dialogZ, g.button.width, g.button.height].every(
				Number.isFinite,
			),
		);
		assert(g.toastZ < g.backdropZ && g.backdropZ < g.dialogZ);
		assert(g.button.width >= 44 && g.button.height >= 44);
		assert.equal(g.toastVisible, true);
		assert.equal(
			row.exactSaveTarget,
			true,
			"Tap must hit the actual save button",
		);
		assert(
			Number.isInteger(row.actualNativeInvalidEvents) &&
				row.actualNativeInvalidEvents > 0,
			"Actual save tap must trigger native required validation",
		);
		for (const flag of [
			"modalTapUnobstructed",
			"toastVisibleThroughoutModalCheck",
			"requiredInputStayedUnsaved",
			"assetIdentitiesPreserved",
			"completed",
		])
			assert.equal(row[flag], true, flag);
		shots = [
			"toast-normal-page.png",
			"toast-and-dialog.png",
			"toast-and-required-error.png",
		];
	}
	assert(expected.delete(id), `Unknown or duplicate case: ${id}`);
	const evidence = [];
	for (const name of shots) {
		const path = join(dirname(item.path), name),
			image = await readFile(path);
		assert(
			image.length > 100 &&
				image.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
			`Missing valid PNG: ${id}/${name}`,
		);
		evidence.push({
			path: relative(output, path).split(sep).join("/"),
			sha256: sha(image),
		});
	}
	cases.push({
		id,
		receipt: relative(output, item.path).split(sep).join("/"),
		sha256: sha(item.bytes),
		evidence,
	});
}
assert.equal(expected.size, 0);
const inputs = [
 "scripts/lib/portable-candidate.mjs",
 "scripts/testing/browser-config.ts",
 "scripts/serve-preview-for-tests.mjs",
	"tests/e2e/vault-tool-loading.spec.ts",
	"tests/e2e/vault-tool-recovery.spec.ts",
	"tests/e2e/workspace-vault-status.spec.ts",
	"tests/e2e/toast-dialog-layer.spec.ts",
	"tests/e2e/helpers/portable-candidate.ts",
	"playwright.vault-tools.config.ts",
	"scripts/verify-vault-tool-evidence.mjs",
];
const testInputs = await Promise.all(
	inputs.map(async (path) => ({
		path,
		canonicalSha256: sha(
			(await readFile(path, "utf8")).replaceAll("\r\n", "\n"),
		),
	})),
);
const record = {
	schema: "keepany.vault-tools-machine.v1",
	status: "passed",
	sourceCommit: release.sourceCommit,
	sourceDirty: release.sourceDirty,
	archiveSha256,
	testInputs,
	cases: cases.sort((a, b) => a.id.localeCompare(b.id)),
	separateVerdicts:
		"Human visual review, whitebox review, personal experience, independent review and final delivery are not inferred from this machine record.",
};
await writeFile(
	join(output, "machine-evidence.json"),
	`${JSON.stringify(record, null, 2)}\n`,
	{ flag: "wx" },
);
console.log(
	JSON.stringify({
		status: "passed",
		cases: cases.length,
		pngs: cases.reduce((sum, row) => sum + row.evidence.length, 0),
		archiveSha256,
		humanReviewInferred: false,
	}),
);
