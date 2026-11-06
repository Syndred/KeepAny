import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { readCandidate, selectCandidate } from "./lib/portable-candidate.mjs";
const output = resolve(process.argv[2] ?? "test-results/detail-consistency-ci");
if (existsSync(output) && readdirSync(output).length)
	throw Error("Choose new evidence directory");
mkdirSync(output, { recursive: true });
const directory = process.env.KEEPANY_WEB_CANDIDATE;
const candidate = directory
	? JSON.parse(readFileSync(join(directory, "CANDIDATE.json"), "utf8"))
	: readCandidate(selectCandidate()).release;
if (candidate.sourceDirty)
	throw Error("Commit reviewed candidate before acceptance");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (directory) {
	for (const f of candidate.webFiles)
		if (hash(readFileSync(join(directory, f.path))) !== f.sha256)
			throw Error(`Changed candidate ${f.path}`);
	for (const path of [
		"tests/e2e/detail-consistency.spec.ts",
		"playwright.detail-consistency.config.ts",
		"scripts/check-detail-consistency.mjs",
	])
		if (
			candidate.sourceFiles.find((f) => f.path === path)?.sha256 !==
			hash(readFileSync(path))
		)
			throw Error(`Changed executed contract ${path}`);
}
const identity = candidate.webFiles.find((f) => f.path === "index.html").sha256;
const report = join(output, "playwright.json");
writeFileSync(
	join(output, "candidate.json"),
	JSON.stringify({
		sourceCommit: candidate.sourceCommit,
		indexSha256: identity,
	}),
);
const run = spawnSync(
	process.execPath,
	[
		"node_modules/@playwright/test/cli.js",
		"test",
		"--config",
		"playwright.detail-consistency.config.ts",
		"--reporter=json,line",
	],
	{
		env: {
			...process.env,
			KEEPANY_EVIDENCE_DIR: join(output, "browser"),
			PLAYWRIGHT_JSON_OUTPUT_FILE: report,
		},
		stdio: "inherit",
		timeout: 900000,
	},
);
if (run.status !== 0) process.exit(run.status ?? 1);
const json = JSON.parse(readFileSync(report, "utf8"));
const specs = (suites) =>
	suites.flatMap((s) => [...(s.specs ?? []), ...specs(s.suites ?? [])]);
const tests = specs(json.suites).flatMap((s) => s.tests);
if (
	tests.length !== 6 ||
	tests.some(
		(t) =>
			t.status !== "expected" ||
			t.expectedStatus !== "passed" ||
			t.results.length !== 1 ||
			t.results[0].status !== "passed",
	)
)
	throw Error("Need six single-attempt passing tests");
const attachments = tests.flatMap((t) => t.results[0].attachments ?? []);
const receipts = attachments
	.filter((a) => a.name === "contract-results.json")
	.map((a) =>
		JSON.parse(
			a.path
				? readFileSync(a.path, "utf8")
				: Buffer.from(a.body, "base64").toString(),
		),
	);
for (const locale of ["zh-CN", "en"])
	for (const id of ["DC01", "DC02", "DC03", "DC04", "DC07"])
		if (
			!receipts.some(
				(r) =>
					r.locale === locale &&
					r.ids.includes(id) &&
					r.candidate === identity &&
					r.result === "passed",
			)
		)
			throw Error(`Missing ${locale} ${id}`);
const images = attachments
	.filter((a) => a.contentType === "image/png")
	.map((a) => ({
		name: a.name,
		path: a.path,
		sha256: hash(readFileSync(a.path)),
	}));
for (const locale of ["zh-CN", "en"])
	for (const width of [390, 768, 1280, 1920, 1991, 2262])
		for (const kind of ["generic", "item", "subscription", "wallet", "domain"])
			if (!images.some((i) => i.name === `${locale}-${width}-${kind}-main.png`))
				throw Error(`Missing image ${locale}/${width}/${kind}`);
for (const locale of ["zh-CN", "en"])
	for (const state of [
		"generic-required-error",
		"generic-create",
		"back-hover",
		"back-keyboard",
		"only-start",
		"no-dates",
		"image-preview",
		"uniform-gallery",
	])
		if (!images.some((i) => i.name === `${locale}-${state}.png`))
			throw Error(`Missing ${locale} ${state}`);
writeFileSync(
	join(output, "visual-manifest.json"),
	JSON.stringify(images, null, 2),
);
writeFileSync(
	join(output, "result.json"),
	JSON.stringify(
		{
			status: "restricted-machine-checks-passed",
			sourceCommit: candidate.sourceCommit,
			candidate: identity,
			tests: 6,
			screenshots: images.length,
			ids: ["DC01", "DC02", "DC03", "DC04", "DC07"],
			manualVisual: "separate",
			controller: "separate",
			independent: "separate",
			otherScopes:
				"DC05 existing todo gate; DC06 targeted complex and independent; DC08 unit and independent",
		},
		null,
		2,
	),
);
console.log(JSON.stringify({ output, tests: 6, screenshots: images.length }));
