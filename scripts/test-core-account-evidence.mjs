import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const root = resolve(".");
const source = resolve(
	process.argv[2] ?? "test-results/core-account-isolation",
);
const archive = resolve(
	process.argv[3] ?? process.env.KEEPANY_PREVIEW_ARCHIVE ?? "missing.zip",
);
assert(source.startsWith(root + sep) && archive.startsWith(root + sep));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const originalRecord = await readFile(join(source, "machine-evidence.json"));
const record = JSON.parse(originalRecord);
assert.equal(record.schema, "keepany.core-account-machine.v1");
assert.equal(record.status, "passed");
assert.equal(record.cases.length, 6);
assert.equal(record.archiveSha256, sha(await readFile(archive)));
await mkdir(join(root, "test-results"), { recursive: true });
const destination = await mkdtemp(
	join(root, "test-results/core-account-gate-probes-"),
);
const logs = join(destination, "logs");
await mkdir(logs);
const results = [];
async function copyEvidence(name) {
	const target = join(destination, name);
	for (const row of record.cases)
		for (const file of [
			{ path: row.receipt, sha256: row.sha256 },
			...row.evidence,
		]) {
			const from = resolve(source, file.path),
				to = resolve(target, file.path);
			assert(from.startsWith(source + sep) && to.startsWith(target + sep));
			assert.equal(sha(await readFile(from)), file.sha256);
			await mkdir(dirname(to), { recursive: true });
			await copyFile(from, to);
		}
	return target;
}
async function run(name, target, accept, pattern) {
	const result = spawnSync(
		process.execPath,
		["scripts/verify-core-account-evidence.mjs", target, archive],
		{ cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 2_000_000 },
	);
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
	await writeFile(join(logs, `${name}.log`), output, { flag: "wx" });
	const passed = accept
		? result.status === 0
		: result.status !== 0 && !result.error && pattern.test(output);
	results.push({
		name,
		expected: accept ? "accept" : "reject",
		exitCode: result.status,
		passed,
	});
	assert(passed, `Core gate probe failed: ${name}`);
}
try {
	const positive = await copyEvidence("positive");
	await run("complete-evidence", positive, true);
	await run("refuse-overwrite", positive, false, /EEXIST/);
	const negative = await copyEvidence("negative");
	const row = record.cases[0];
	const path = join(negative, row.receipt);
	const raw = await readFile(path);
	await rename(path, `${path}.held`);
	try {
		await run("missing-case", negative, false, /All six frozen/);
	} finally {
		await rename(`${path}.held`, path);
	}
	const probes = [
		[
			"lost-saved-name",
			(r) => {
				r.refreshedAccounts[1].title = "";
			},
			/Saved name and username/,
		],
		[
			"changed-saved-username",
			(r) => {
				r.refreshedAccounts[0].username = "changed@example.test";
			},
			/Saved name and username/,
		],
		[
			"wrong-archive",
			(r) => {
				r.archiveSha256 = "0".repeat(64);
			},
			/Candidate archive changed/,
		],
		[
			"wrong-commit",
			(r) => {
				r.sourceCommit = "0".repeat(40);
			},
			/Candidate commit changed/,
		],
		[
			"wrong-dirty",
			(r) => {
				r.sourceDirty = !r.sourceDirty;
			},
			/Candidate dirty state changed/,
		],
		[
			"wrong-module",
			(r) => {
				r.targetPath = "assets/fake.js";
			},
			/actual Papa module/,
		],
		[
			"numeric-string-viewport",
			(r) => {
				r.width = "1280";
			},
			/Frozen viewport/,
		],
		[
			"lost-saved-id",
			(r) => {
				r.afterHrefs.pop();
			},
			/IDs must survive/,
		],
		[
			"cancel-not-preserved",
			(r) => {
				r.cancelKeptIds = false;
			},
			/cancelKeptIds/,
		],
		[
			"filter-unverified",
			(r) => {
				r.categoryFilterWorked = false;
			},
			/categoryFilterWorked/,
		],
		[
			"wrong-final-state",
			(r) => {
				r.stateAfter = "invalid";
			},
			/Final vault state/,
		],
		[
			"unexpected-module-request",
			(r) => {
				r.unusedAdvancedScriptRequests.push(
					"https://synthetic.invalid/papa.js",
				);
			},
			/Unused Papa/,
		],
		[
			"uncaught-page-error",
			(r) => {
				r.pageErrors.push("synthetic error");
			},
			/uncaught errors/,
		],
		[
			"incomplete-case",
			(r) => {
				r.completed = false;
			},
			/completed/,
		],
	];
	for (const [name, mutate, pattern] of probes) {
		const changed = JSON.parse(raw);
		mutate(changed);
		const exact = `${JSON.stringify(changed)}\n`;
		try {
			await writeFile(path, exact);
			await writeFile(join(logs, `${name}-input.json`), exact, { flag: "wx" });
			await run(name, negative, false, pattern);
		} finally {
			await writeFile(path, raw);
		}
	}
	const png = join(negative, row.evidence[0].path);
	await rename(png, `${png}.held`);
	try {
		await run("missing-png", negative, false, /ENOENT/);
	} finally {
		await rename(`${png}.held`, png);
	}
	const image = await readFile(png);
	const changed = Buffer.from(image);
	changed.writeUInt32BE(390, 16);
	try {
		await writeFile(png, changed);
		await writeFile(join(logs, "wrong-png-viewport-input.png"), changed, {
			flag: "wx",
		});
		await run("wrong-png-viewport", negative, false, /PNG viewport mismatch/);
	} finally {
		await writeFile(png, image);
	}
} finally {
	await writeFile(
		join(destination, "results.json"),
		`${JSON.stringify({ schema: "keepany.core-account-gate-probes.v1", status: results.length === 19 && results.every((row) => row.passed) ? "passed" : "failed", archiveSha256: record.archiveSha256, originalEvidence: source, originalMachineRecordSha256: sha(originalRecord), results, humanReviewInferred: false }, null, 2)}\n`,
		{ flag: "wx" },
	);
}
assert.equal(results.length, 19);
console.log(
	JSON.stringify({
		status: "passed",
		positive: 1,
		negative: 18,
		destination,
		humanReviewInferred: false,
	}),
);
