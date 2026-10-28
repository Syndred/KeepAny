import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { unzipSync } from "fflate";

// A record-integrity gate, not an automated claim that a human saw the UI.
const root = resolve(".");
const recordPath =
	process.argv[2] ??
	"docs/qa/2026-10-28/evidence/final-correction/acceptance-results.json";
const record = JSON.parse(await readFile(recordPath, "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const required = Array.from(
	{ length: 10 },
	(_, index) => `AL${String(index + 1).padStart(2, "0")}`,
);
if (
	record.schema !== "keepany.account-acceptance.v1" ||
	record.results.length !== required.length ||
	new Set(record.results.map((item) => item.id)).size !== required.length
)
	throw Error("Acceptance IDs are missing or duplicated.");
for (const id of required) {
	const item = record.results.find((item) => item.id === id);
	if (
		item?.status !== "passed" ||
		item.candidate !== record.candidate ||
		!item.evidence.length
	)
		throw Error(`Incomplete acceptance record: ${id}`);
	for (const evidence of item.evidence)
		if (!record.evidence.some((entry) => entry.path === evidence))
			throw Error(`Unbound evidence: ${id}/${evidence}`);
}
for (const entry of record.evidence) {
	const path = resolve(entry.path);
	if (
		!path.startsWith(root + sep) ||
		sha(await readFile(path)) !== entry.sha256
	)
		throw Error(`Evidence changed or escaped workspace: ${entry.path}`);
}
// Require each frozen data/state combination, not only a broad AL "passed" flag.
// These are evidence-integrity checks; human visual review is still separate.
const coverageEntry = record.evidence.find(
	(entry) => entry.path === record.machineCoverage,
);
if (!coverageEntry) throw Error("State coverage must be hash-bound evidence.");
const coverage = JSON.parse(await readFile(coverageEntry.path, "utf8"));
if (
	coverage.schema !== "keepany.account-state-coverage.v1" ||
	coverage.candidate !== record.candidate ||
	coverage.indexSha256 !== record.indexSha256 ||
	!Array.isArray(coverage.cases)
) throw Error("State coverage candidate or schema mismatch.");
const expectedCases = [];
for (const language of ["zh-CN", "en"]) {
	for (const width of [390, 768, 1280, 1920, 2560]) {
		for (const consumer of ["workspace", "detail", "asset-filter"])
			expectedCases.push(`busy:${consumer}:${language}:${width}`);
		expectedCases.push(`social-populated:${language}:${width}`);
	}
}
if (
	coverage.cases.length !== expectedCases.length ||
	new Set(coverage.cases.map((item) => item.id)).size !== expectedCases.length
) throw Error("State coverage combinations are missing or duplicated.");
const archives = new Map();
function verifyRawState(raw, id, evidence) {
	const parts = id.split(":"), language = parts.at(-2), width = Number(parts.at(-1));
	const step = (name) => raw.steps.find((entry) => entry.stage === name);
	const png = (name) => evidence.some((entry) => entry.path.split("/").at(-1) === name);
	if (parts[0] === "busy") {
		const prefix = {
			workspace: "workspace-samples",
			detail: "detail-restore",
			"asset-filter": "focused-restore",
		}[parts[1]];
		if (step(prefix)?.disabledBeforeAndAfterScreenshot !== true)
			throw Error(`Missing actual busy state: ${id}`);
		for (const suffix of ["before-screenshot", "after-screenshot"]) {
			const buttons = step(`${prefix}-${suffix}`)?.buttons;
			if (!buttons?.length || buttons.some((button) =>
				button.disabled !== true || !Number.isFinite(button.width) || !Number.isFinite(button.height) ||
				button.width < 43.99 || button.height < 43.99 ||
				!Number.isFinite(button.left) || !Number.isFinite(button.right) ||
				button.left < -1 || button.right < -1))
				throw Error(`Invalid atomic busy frame: ${id}/${suffix}`);
		}
		const geometry = step(`${prefix}-recovered`)?.geometry;
		if (!geometry?.buttons?.length || geometry.viewport !== width ||
			!Number.isFinite(geometry.left) || !Number.isFinite(geometry.right) ||
			geometry.buttons.some((button) => button.disabled !== false ||
				![button.width, button.height, button.left, button.right].every(Number.isFinite) ||
				button.width < 43.99 || button.height < 43.99 ||
				button.left < geometry.left - 1 || button.right > geometry.right + 1))
			throw Error(`Missing recovered toolbar geometry: ${id}`);
		if (parts[1] !== "workspace") {
			const restored = step(`${prefix}-entry-restored`);
			if (!restored?.entryId || !(restored.entryCount > 0))
				throw Error(`Missing restored entry: ${id}`);
		}
		for (const state of ["busy", "recovered"])
			if (!png(`${language}-${width}-${prefix}-${state}.png`))
				throw Error(`Wrong consumer state screenshot: ${id}/${state}`);
	} else {
		const social = step("social-populated");
		if (!(social?.entryCount > 0) || social.expanded !== true ||
			social.categoryFiltered !== "true" || social.searchCleared !== true ||
			social.refreshRestored !== true || !png(`${language}-${width}-social-filtered.png`) ||
			!png(`${language}-${width}-social-restored.png`))
			throw Error(`Missing populated social workflow: ${id}`);
	}
}
for (const id of expectedCases) {
	const item = coverage.cases.find((entry) => entry.id === id);
	if (item?.status !== "passed" || !item.evidence?.length)
		throw Error(`Incomplete state coverage: ${id}`);
	let candidateReceiptFound = false;
	for (const type of ["json", "png"])
		if (!item.evidence.some((entry) => entry.path.endsWith(`.${type}`)))
			throw Error(`Missing ${type} state evidence: ${id}`);
	for (const evidence of item.evidence) {
		if (!record.evidence.some((entry) => entry.path === evidence.archive))
			throw Error(`Unbound state archive: ${id}`);
		if (!archives.has(evidence.archive))
			archives.set(evidence.archive, unzipSync(await readFile(evidence.archive)));
		const bytes = archives.get(evidence.archive)[evidence.path];
		if (!bytes || sha(bytes) !== evidence.sha256)
			throw Error(`State evidence changed or missing: ${id}/${evidence.path}`);
		if (evidence.path.endsWith(".png") &&
			(bytes.length < 100 || Buffer.from(bytes.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a"))
			throw Error(`Invalid state screenshot: ${id}`);
		if (evidence.path.endsWith(".json")) {
			const raw = JSON.parse(new TextDecoder().decode(bytes));
			const receipt = raw.steps?.find((step) => step.stage === "identity");
			if (receipt?.entrySha256 === record.indexSha256 &&
				receipt.archiveSha256 === coverage.archiveSha256 &&
				raw.language === id.split(":").at(-2) &&
				raw.width === Number(id.split(":").at(-1))) {
				verifyRawState(raw, id, item.evidence);
				candidateReceiptFound = true;
			}
		}
	}
	if (!candidateReceiptFound) throw Error(`Missing matching runtime identity: ${id}`);
}
const identity = JSON.parse(await readFile(record.productIdentity, "utf8"));
if (!record.evidence.some((entry) => entry.path === record.productIdentity))
	throw Error("Product identity must be hash-bound evidence.");
if (
	identity.sourceCommit !== record.candidate ||
	identity.indexSha256 !== record.indexSha256 ||
	identity.archiveSha256 !== coverage.archiveSha256 ||
	identity.status !== "passed"
)
	throw Error("Candidate identity mismatch.");
const tracked = execFileSync(
	"git",
	["ls-files", "-z", "--", "apps", "packages"],
	{ encoding: "utf8" },
)
	.split("\0")
	.filter(Boolean);
if (
	!identity.productSource?.length ||
	identity.productSource.length !== tracked.length ||
	new Set(identity.productSource.map((file) => file.path)).size !==
		tracked.length ||
	identity.productSource.some((file) => !tracked.includes(file.path))
)
	throw Error("Reviewed product manifest is incomplete or duplicated.");
if (identity.sourceHashPolicy !== "utf8-no-nul-crlf-to-lf-v1;binary-raw")
	throw Error("Unknown canonical source policy.");
for (const file of identity.productSource) {
	const path = resolve(file.path);
	if (!path.startsWith(root + sep))
		throw Error("Product path escaped workspace.");
	const bytes = await readFile(path);
	let text;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		text = null;
	}
	const canonical =
		text !== null && !text.includes("\0")
			? Buffer.from(text.replaceAll("\r\n", "\n"))
			: bytes;
	if (sha(canonical) !== file.canonicalSha256)
		throw Error(`Product changed since manual review: ${file.path}`);
}
for (const aspect of [
	"functional",
	"visual",
	"whitebox",
	"ownerExperience",
	"independentReview",
]) {
	if (record.verdicts[aspect] !== "passed")
		throw Error(`Acceptance aspect incomplete: ${aspect}`);
}
if (!record.manualReviewRecord.owner || !record.manualReviewRecord.independent)
	throw Error("Manual review attribution missing.");
console.log(
	"AL01–AL10, 40 state combinations, raw state semantics, evidence hashes and reviewed candidate identities match. Human review is recorded separately, not inferred from this check.",
);
