import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

// Probe copied machine evidence. Never mutate the browser run or infer a visual verdict.
const root = resolve(".");
const source = resolve(process.argv[2] ?? "test-results/vault-tools");
const archive = resolve(
	process.argv[3] ?? process.env.KEEPANY_PREVIEW_ARCHIVE ?? "missing.zip",
);
assert(source.startsWith(root + sep) && archive.startsWith(root + sep));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const record = JSON.parse(
	await readFile(join(source, "machine-evidence.json")),
);
assert.equal(record.status, "passed");
assert.equal(record.cases.length, 66);
assert.equal(record.archiveSha256, sha(await readFile(archive)));
await mkdir(join(root, "test-results"), { recursive: true });
const destination = await mkdtemp(
	join(root, "test-results/vault-gate-probes-"),
);
const logs = join(destination, "logs");
await mkdir(logs);
const results = [];
async function copyEvidence(name) {
	const target = join(destination, name);
	for (const row of record.cases) {
		for (const file of [
			{ path: row.receipt, sha256: row.sha256 },
			...row.evidence,
		]) {
			const original = resolve(source, file.path);
			const copied = resolve(target, file.path);
			assert(
				original.startsWith(source + sep) && copied.startsWith(target + sep),
			);
			assert.equal(sha(await readFile(original)), file.sha256);
			await mkdir(dirname(copied), { recursive: true });
			await copyFile(original, copied);
		}
	}
	return target;
}
async function run(name, target, expected, pattern, candidate = archive) {
	const result = spawnSync(
		process.execPath,
		["scripts/verify-vault-tool-evidence.mjs", target, candidate],
		{ cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 2_000_000 },
	);
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
	await writeFile(join(logs, `${name}.log`), output, { flag: "wx" });
	const passed =
		expected === "accept"
			? result.status === 0
			: result.status !== 0 && !result.error && pattern.test(output);
	results.push({ name, expected, exitCode: result.status, passed });
	assert(passed, `Gate probe did not meet its expectation: ${name}`);
}
const find = (prefix) => {
	const row = record.cases.find((entry) => entry.id.startsWith(prefix));
	assert(row, prefix);
	return row;
};
let negative;
async function jsonProbe(name, row, mutate, pattern) {
	const path = join(negative, row.receipt);
	const original = await readFile(path);
	const changed = JSON.parse(original);
	mutate(changed);
	try {
		await writeFile(path, `${JSON.stringify(changed)}\n`);
		await run(name, negative, "reject", pattern);
	} finally {
		await writeFile(path, original);
	}
}
async function missingProbe(name, path, pattern) {
	const held = `${path}.held-for-probe`;
	await rename(path, held);
	try {
		await run(name, negative, "reject", pattern);
	} finally {
		await rename(held, path);
	}
}
try {
	const positive = await copyEvidence("positive");
	await run("complete-evidence", positive, "accept");
	await run("refuse-overwriting-evidence", positive, "reject", /EEXIST/);
	negative = await copyEvidence("negative");
	const tool = find("tool:"),
		toast = find("toast:"),
		status = find("status:");
	await missingProbe(
		"missing-case",
		join(negative, tool.receipt),
		/All 66 frozen/,
	);
	const extra = join(negative, "duplicate", basename(tool.receipt));
	await mkdir(dirname(extra));
	await copyFile(join(negative, tool.receipt), extra);
	try {
		await run("duplicate-case", negative, "reject", /All 66 frozen/);
	} finally {
		await unlink(extra);
	}
	await jsonProbe(
		"wrong-archive",
		toast,
		(row) => {
			row.archiveSha256 = "0".repeat(64);
		},
		/Candidate archive changed/,
	);
	await jsonProbe(
		"wrong-commit",
		toast,
		(row) => {
			row.sourceCommit = "0".repeat(40);
		},
		/Candidate commit changed/,
	);
	await jsonProbe(
		"wrong-dirty-state",
		toast,
		(row) => {
			row.sourceDirty = !row.sourceDirty;
		},
		/Candidate dirty state changed/,
	);
	await jsonProbe(
		"same-context-id-changed",
		tool,
		(row) => {
			row.phases.find((phase) => phase.mode === "loading").originalHref +=
				"-changed";
		},
		/Saved account identity/,
	);
	await jsonProbe(
		"unfinished-module-response",
		tool,
		(row) => {
			row.phases.find(
				(phase) => phase.mode === "loading",
			).actualModuleResponseFinished = false;
		},
		/actualModuleResponseFinished/,
	);
	await jsonProbe(
		"toast-above-modal",
		toast,
		(row) => {
			row.geometry.toastZ = row.geometry.dialogZ + 1;
		},
		/AssertionError/,
	);
	await jsonProbe(
		"small-save-button",
		toast,
		(row) => {
			row.geometry.button.height = 36;
		},
		/AssertionError/,
	);
	await jsonProbe(
		"tap-missed-save-button",
		toast,
		(row) => {
			row.exactSaveTarget = false;
		},
		/Tap must hit/,
	);
	await jsonProbe(
		"missing-native-validation",
		toast,
		(row) => {
			row.actualNativeInvalidEvents = 0;
		},
		/native required validation/,
	);
	await jsonProbe(
		"duplicate-original-id",
		toast,
		(row) => {
			row.originalHrefs[1] = row.originalHrefs[0];
		},
		/AssertionError/,
	);
	await jsonProbe(
		"incomplete-state",
		status,
		(row) => {
			row.completed = false;
		},
		/AssertionError/,
	);
	const png = join(negative, toast.evidence[0].path);
	await missingProbe("missing-png", png, /ENOENT/);
	const image = await readFile(png);
	try {
		await writeFile(png, Buffer.alloc(120));
		await run("invalid-png", negative, "reject", /Missing valid PNG/);
	} finally {
		await writeFile(png, image);
	}
} finally {
	await writeFile(
		join(destination, "results.json"),
		`${JSON.stringify(
			{
				schema: "keepany.vault-tool-gate-probes.v1",
				status:
					results.length === 17 && results.every((row) => row.passed)
						? "passed"
						: "failed",
				archiveSha256: record.archiveSha256,
				originalEvidence: source,
				originalMachineRecordSha256: sha(
					await readFile(join(source, "machine-evidence.json")),
				),
				results,
				humanReviewInferred: false,
			},
			null,
			2,
		)}\n`,
		{ flag: "wx" },
	);
}
console.log(
	JSON.stringify({
		status: "passed",
		positive: 1,
		negative: 16,
		destination,
		humanReviewInferred: false,
	}),
);
