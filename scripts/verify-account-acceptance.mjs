import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

// A record-integrity gate, not an automated claim that a human saw the UI.
const root = resolve(".");
const recordPath =
	process.argv[2] ??
	"docs/qa/2026-10-28/evidence/account-expansion-fixed/acceptance-results.json";
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
const identity = JSON.parse(await readFile(record.productIdentity, "utf8"));
if (!record.evidence.some((entry) => entry.path === record.productIdentity))
	throw Error("Product identity must be hash-bound evidence.");
if (
	identity.sourceCommit !== record.candidate ||
	identity.indexSha256 !== record.indexSha256 ||
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
	"AL01–AL10 records, evidence hashes, reviewed product source and candidate identities match. Human review is recorded separately, not inferred from this check.",
);
