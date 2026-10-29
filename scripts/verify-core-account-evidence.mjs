import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { strFromU8, unzipSync } from "fflate";

// Checks evidence integrity only; personal experience and visual review stay separate.
const root = resolve(".");
const output = resolve(
	process.argv[2] ?? "test-results/core-account-isolation",
);
const archive = resolve(
	process.argv[3] ?? process.env.KEEPANY_PREVIEW_ARCHIVE ?? "missing.zip",
);
assert(output.startsWith(root + sep) && archive.startsWith(root + sep));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytes = await readFile(archive);
const archiveSha256 = sha(bytes);
assert.equal(
	archiveSha256,
	(await readFile(`${archive}.sha256`, "utf8")).split(/\s+/)[0],
);
const members = unzipSync(bytes);
const manifests = Object.keys(members).filter((name) =>
	name.endsWith("/RELEASE.json"),
);
assert.equal(manifests.length, 1);
const release = JSON.parse(strFromU8(members[manifests[0]]));
assert.equal(release.schema, "keepany.portable-preview.v1");
assert(
	/^[a-f0-9]{40}$/.test(release.sourceCommit) &&
		typeof release.sourceDirty === "boolean",
);
const papa = release.webFiles.filter((file) =>
	/^assets\/papaparse[^/]+\.js$/.test(file.path),
);
assert.equal(papa.length, 1);
const receipts = [];
async function walk(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		assert(!entry.isSymbolicLink(), "Evidence symlinks are not accepted");
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await walk(path);
		else if (entry.name === "core-account-receipt.json") receipts.push(path);
	}
}
await walk(output);
const expected = new Set(
	["zh-CN", "en"].flatMap((locale) =>
		["empty", "locked", "unlocked"].map((state) => `${locale}:${state}`),
	),
);
assert.equal(receipts.length, 6, "All six frozen core cases are required");
const cases = [];
for (const path of receipts) {
	const raw = await readFile(path);
	const row = JSON.parse(raw);
	const id = `${row.locale}:${row.state}`;
	assert(expected.delete(id), `Unknown or duplicate core case: ${id}`);
	assert.deepEqual(row.acceptanceIds, ["FC20-A", "FC20-B", "FC20-G"]);
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
	assert.equal(
		row.targetPath,
		papa[0].path,
		"Fault must name the actual Papa module",
	);
	assert(
		Number.isFinite(row.width) &&
			Number.isFinite(row.height) &&
			row.width === 1280 &&
			row.height === 900,
		"Frozen viewport must be numeric 1280x900",
	);
	for (const field of ["originalHref", "addedHref"])
		assert(
			typeof row[field] === "string" &&
				/^\/assets\/account\/[^/\s]+$/.test(row[field]),
			"Saved account identity is required",
		);
	assert.notEqual(
		row.originalHref,
		row.addedHref,
		"Two distinct saved identities are required",
	);
	assert.deepEqual(
		row.afterHrefs,
		[row.originalHref, row.addedHref].sort(),
		"Both saved account IDs must survive refresh",
	);
	assert.equal(row.stateBefore, row.state, "Initial vault state changed");
	assert.equal(row.stateAfter, row.state, "Final vault state changed");
	const expectedAccounts = [
		{
			href: row.originalHref,
			title: `Synthetic FC20 original ${row.locale} ${row.state}`,
			username: "original.fc20@example.test",
		},
		{
			href: row.addedHref,
			title: `Synthetic FC20 email ${row.locale} ${row.state}`,
			username: "saved.fc20@example.test",
		},
	];
	assert.deepEqual(
		row.expectedAccounts,
		expectedAccounts,
		"Frozen fictional account fields changed",
	);
	assert.deepEqual(
		row.refreshedAccounts,
		expectedAccounts,
		"Saved name and username must survive refresh",
	);
	for (const flag of [
		"cancelKeptIds",
		"categoryFilterWorked",
		"explicitRefresh",
		"normalActionsAndReloadKeptIds",
		"completed",
	])
		assert.equal(row[flag], true, flag);
	assert.deepEqual(
		row.unusedAdvancedScriptRequests,
		[],
		"Unused Papa must not be requested",
	);
	assert.deepEqual(
		row.pageErrors,
		[],
		"Core page must have no uncaught errors",
	);
	const evidence = [];
	for (const name of [
		"blocked-core-ready.png",
		"ordinary-editor-draft.png",
		"email-filter.png",
		"core-after-refresh.png",
	]) {
		const imagePath = join(dirname(path), name);
		const image = await readFile(imagePath);
		assert(
			image.length > 100 &&
				image.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
			"Missing valid core PNG",
		);
		assert(
			image.readUInt32BE(16) === row.width &&
				image.readUInt32BE(20) === row.height,
			"Core PNG viewport mismatch",
		);
		evidence.push({
			path: relative(output, imagePath).split(sep).join("/"),
			sha256: sha(image),
			width: row.width,
			height: row.height,
		});
	}
	cases.push({
		id,
		receipt: relative(output, path).split(sep).join("/"),
		sha256: sha(raw),
		evidence,
	});
}
assert.equal(expected.size, 0);
const inputs = [
	"tests/e2e/core-account-isolation.spec.ts",
	"playwright.core-account.config.ts",
	"playwright.vault-tools.config.ts",
	"tests/e2e/helpers/portable-candidate.ts",
	"tests/e2e/helpers/select-choice.ts",
	"tests/e2e/helpers/vault-access.ts",
	"scripts/verify-core-account-evidence.mjs",
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
	schema: "keepany.core-account-machine.v1",
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
		cases: 6,
		pngs: 24,
		archiveSha256,
		humanReviewInferred: false,
	}),
);
