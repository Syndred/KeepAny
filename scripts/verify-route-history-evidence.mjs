import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { posix, resolve, sep } from "node:path";
import { unzipSync } from "fflate";

// Machine evidence only. Human visual review, personal experience and the final
// normal/cloud verdict remain separate; a screenshot hash does not prove them.
const root = resolve(".");
const recordPath = process.argv[2] ?? "docs/qa/2026-10-28/evidence/final-8f223/machine-evidence.json";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const read = async (path) => {
	const absolute = resolve(path);
	assert(absolute.startsWith(root + sep), `Evidence escaped workspace: ${path}`);
	return readFile(absolute);
};
const record = JSON.parse(await read(recordPath));
assert.equal(record.schema, "keepany.route-history-machine.v1");
assert.deepEqual(record.ids, ["FC17-A", "FC17-B", "FC17-C", "FC17-D", "FC17-E", "FC18-A", "FC18-B", "FC18-C"], "Machine coverage IDs");
assert.deepEqual(Object.keys(record.separateVerdicts).sort(), ["FC17-F", "FC18-D"], "Final verdict boundaries");
assert(Object.values(record.separateVerdicts).every((value) => typeof value === "string" && value.length > 0));
assert(digest(record.archiveSha256) && digest(record.indexSha256));
const identityBytes = await read(record.productIdentity.path);
assert.equal(sha(identityBytes), record.productIdentity.sha256, "Product identity hash");
const identity = JSON.parse(identityBytes);
assert.equal(identity.sourceCommit, record.candidate);
assert.equal(identity.indexSha256, record.indexSha256);
assert.equal(identity.archiveSha256, record.archiveSha256);
assert.equal(identity.status, "passed");

const inputs = ["tests/e2e/route-load-recovery.spec.ts", "tests/e2e/password-history-version.spec.ts", "tests/e2e/fixtures/password-smart-import-visual.ts", "tests/e2e/helpers/vault-access.ts", "playwright.route-error.config.ts", "playwright.release.config.ts"];
assert.deepEqual(record.testInputs.map((row) => row.path).sort(), [...inputs].sort(), "Reviewed test input set");
for (const row of record.testInputs) {
	const bytes = await read(row.path);
	const canonical = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replaceAll("\r\n", "\n");
	assert.equal(sha(canonical), row.canonicalSha256, `Reviewed input changed: ${row.path}`);
}

const archives = new Map();
const origins = new WeakMap();
assert(record.archives.length > 0);
for (const row of record.archives) {
	assert(!archives.has(row.path), "Duplicate evidence archive");
	const bytes = await read(row.path);
	assert.equal(sha(bytes), row.sha256, `Evidence archive changed: ${row.path}`);
	const files = unzipSync(bytes);
	archives.set(row.path, files);
}
const raw = (ref) => {
	assert(ref.path.endsWith(".json"), "Case must reference raw JSON");
	const bytes = archives.get(ref.archive)?.[ref.path];
	assert(bytes && sha(bytes) === ref.sha256, `Raw case changed or missing: ${ref.path}`);
	const row = JSON.parse(new TextDecoder().decode(bytes));
	const origin = { archive: ref.archive, directory: posix.dirname(ref.path) };
	origins.set(row, origin);
	for (const route of row.routes ?? []) origins.set(route, origin);
	return row;
};
const steps = (row, stage) => row.steps.filter((entry) => entry.stage === stage);
function screenshots(row, names) {
	const shots = steps(row, "screenshot");
	const origin = origins.get(row);
	for (const shot of shots) {
		const filename = posix.basename(shot.path.replaceAll("\\", "/"));
		assert.equal(filename, `${shot.name}.png`, "State screenshot name/path mismatch");
		const path = `${origin.directory}/${filename}`;
		const bytes = archives.get(origin.archive)?.[path];
		assert(bytes && bytes.length > 100 && Buffer.from(bytes.subarray(0, 8)).toString("hex") === "89504e470d0a1a0a", `Missing or invalid state PNG: ${path}`);
		assert(digest(shot.sha256) && sha(bytes) === shot.sha256, `State screenshot changed: ${path}`);
	}
	for (const name of names) assert(shots.some((shot) => shot.name === name || shot.name.endsWith(name)), `Missing state frame: ${name}`);
}
function version(row) {
	assert.equal(row.status, "passed");
	assert.equal(row.identity.candidate, record.candidate);
	assert.equal(row.identity.archiveSha256, record.archiveSha256);
	assert.equal(row.identity.indexSha256, record.indexSha256);
}
function combinations(refs, widths) {
	const expected = ["zh-CN", "en"].flatMap((language) => widths.map((width) => `${language}:${width}`));
	const rows = refs.map(raw);
	assert.deepEqual(rows.map((row) => `${row.language}:${row.width}`).sort(), expected.sort(), "Missing or duplicated case combination");
	return rows;
}
function controls(row, width) {
	assert.equal(row.classification, "module-load");
	const { geometry: g } = row;
	assert([g.viewport.width, g.viewport.height, g.section.left, g.section.right, g.section.top, g.section.bottom, g.section.scrollWidth, g.section.clientWidth, g.button.left, g.button.right, g.button.top, g.button.bottom, g.button.width, g.button.height, g.heading.top, g.heading.bottom].every(Number.isFinite), "Non-finite control geometry");
	assert.equal(g.viewport.width, width);
	assert.equal(g.pageOverflow, false);
	assert(g.button.width >= 44 && g.button.height >= 44);
	assert(g.button.left >= 0 && g.button.top >= 0 && g.button.right <= width + 1 && g.button.bottom <= g.viewport.height + 1);
	assert(g.heading.top >= 0 && g.heading.bottom <= g.viewport.height + 1);
	assert(g.section.left >= -1 && g.section.right <= width + 1);
	assert(g.section.scrollWidth <= g.section.clientWidth + 1);
}
const widths = [390, 563, 768, 1280, 1920, 2560];
for (const row of combinations(record.recoveries, widths)) {
	version(row);
	const baseline = steps(row, "saved-baseline");
	const after = steps(row, "saved-data-preserved");
	assert.equal(baseline.length, 1); assert.equal(after.length, 1);
	assert.deepEqual(after[0].kdbx, baseline[0].kdbx, "KDBX data/history changed across reloads");
	assert.deepEqual(after[0].backup, baseline[0].backup, "Saved backup changed across reloads");
	assert.equal(after[0].manualRecoveryCount, 2); assert.equal(after[0].requestFailureCount, 2);
	const entries = baseline[0].kdbx.entries;
	assert.equal(entries.length, 2); assert.equal(new Set(entries.map((entry) => entry.id)).size, 2);
	assert(entries.some((entry) => entry.historyCount > 0));
	for (const entry of entries) assert(entry.id && entry.linkedAssetIds.length === 1 && digest(entry.passwordSha256) && digest(entry.historySha256));
	const backup = baseline[0].backup;
	assert.equal(new Set(backup.assetIds).size, 2); assert.equal(backup.relationIds.length, 1);
	for (const key of ["recordsSha256", "encryptedKdbxSha256", "intakeReviewSha256"]) assert(digest(backup[key]));
	const failures = steps(row, "failure-observed"), reloads = steps(row, "manual-reload"), errors = steps(row, "error-controls");
	assert.equal(failures.length, 2); assert.equal(reloads.length, 2); assert.equal(errors.length, 2);
	for (let i = 0; i < 2; i++) {
		assert.equal(failures[i].round, i + 1); assert.equal(failures[i].failed.length, i + 1);
		assert.equal(failures[i].documents, i + 1); assert.equal(failures[i].noAutomaticReloadObservedMs, 500);
		assert(failures[i].failed.every((entry) => entry.error === "net::ERR_FAILED"));
		assert.equal(reloads[i].round, i + 1); assert.equal(reloads[i].trigger, i ? "keyboard-enter" : "button-click");
		controls(errors[i], row.width);
	}
	screenshots(row, [1, 2].flatMap((round) => ["default", "hover", "focus", "pressed"].map((state) => `failure-${round}-${state}`)).concat("recovered-unlocked"));
}

const paths = ["/", "/tasks", "/assets", "/accounts", ...["project", "account", "subscription", "item", "vault"].flatMap((kind) => [`/assets/${kind}`, `/assets/${kind}/synthetic-fc17-missing`]), "/assets/project/synthetic-fc17-missing/workflow/overview", "/change-impact", "/assistant-access", "/collections", "/collections/synthetic-fc17-missing", "/finance", "/intake", "/trash", "/settings"];
function routes(row, stableMobile) {
	version(row);
	assert.deepEqual(row.routeManifest.map((route) => route.path).sort(), [...paths].sort(), "Router contract changed");
	assert.deepEqual(row.routes.map((route) => route.path).sort(), [...paths].sort(), "Missing or duplicate route consumer");
	for (const route of row.routes) {
		assert.equal(route.status, "passed");
		const errors = steps(route, "error-controls"), failed = steps(route, "actual-http-module-failure"), navigation = steps(route, "error-navigation");
		assert.equal(errors.length, 1); assert.equal(failed.length, 1); assert.equal(navigation.length, 1);
		controls(errors[0], row.width);
		assert(failed[0].aborted > 0 && failed[0].failures.length > 0 && failed[0].failures.length <= failed[0].aborted);
		assert(failed[0].failures.every((entry) => entry.error === "net::ERR_FAILED" && new URL(entry.url).pathname === failed[0].target));
		assert.equal(navigation[0].via, "actual-sidebar-link");
		assert.equal(navigation[0].destination, failed[0].target.includes("page-workspaces-") ? "/tasks" : "/accounts");
		assert.equal(navigation[0].mobileMenuOpened, row.width < 768);
		if (stableMobile) assert(Number.isFinite(navigation[0].mobileSidebarRight) && navigation[0].mobileSidebarRight <= 1, "Mobile navigation frame was captured before sidebar closed");
		screenshots(route, ["-default", "-hover", "-focus", "-pressed", "-normal-navigation"]);
	}
}
for (const row of combinations(record.routes, widths)) routes(row, false);
for (const row of combinations(record.stableNavigation, [390, 563])) routes(row, true);

for (const row of combinations(record.history, [390, 1280])) {
	assert.equal(row.status, "passed"); assert.equal(row.indexSha256, record.indexSha256);
	const baseline = steps(row, "baseline"); assert.equal(baseline.length, 1);
	assert(digest(baseline[0].historySha256));
	const history = steps(row, "history");
	for (let length = 1; length <= 4; length++) {
		const expected = [1, 2, 3, 1].slice(0, length).map((savedRevision, index) => ({ version: index + 1, savedRevision }));
		assert(history.some((entry) => JSON.stringify(entry.versions) === JSON.stringify(expected)), `Missing ordered historical versions: ${length}`);
	}
	for (const stage of ["restored-version-one", "restored-version-two"]) {
		const restored = steps(row, stage); assert.equal(restored.length, 1);
		assert(restored[0].previousHistoryPreserved === true && restored[0].previousCurrentDraftPreserved === true && digest(restored[0].historySha256));
	}
	const preserved = steps(row, "preserved"); assert.equal(preserved.length, 1);
	assert(preserved[0].entryId && preserved[0].otherEntryId && preserved[0].entryId !== preserved[0].otherEntryId);
	assert.equal(preserved[0].historyCount, 4); assert.equal(preserved[0].finalRevision, 2);
	screenshots(row, ["empty-history", "one-history", "multiple-history", "after-first-restore", "after-reload-history", "after-reload-history-stable", "after-reload-history-bottom"]);
}
console.log("FC17 machine evidence: 12 two-reload cases, 12×23 router consumers and 4×23 stable mobile navigation supplements; FC18: 4 exact history/reload cases. Archive, PNG, test-input and candidate bindings match. Human and final cloud verdicts remain separate.");
