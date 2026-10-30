import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";
import { readCandidate, selectCandidate } from "./lib/portable-candidate.mjs";

const output = resolve(process.argv[2] ?? "test-results/catalog-categories-ci");
if (existsSync(output) && readdirSync(output).length)
	throw Error("Choose a new evidence directory.");
mkdirSync(output, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const web = process.env.KEEPANY_WEB_CANDIDATE;
const identity = web
	? JSON.parse(readFileSync(join(web, "CANDIDATE.json"), "utf8"))
	: readCandidate(selectCandidate()).release;
const index = identity.webFiles.find(
	(file) => file.path === "index.html",
)?.sha256;
if (!index) throw Error("Missing candidate index identity.");
if (web)
	for (const file of identity.webFiles)
		if (hash(readFileSync(join(web, file.path))) !== file.sha256)
			throw Error(`Candidate changed: ${file.path}`);
const reportPath = join(output, "playwright.json");
writeFileSync(
	join(output, "candidate.json"),
	JSON.stringify(
		{
			sourceCommit: identity.sourceCommit,
			sourceDirty: identity.sourceDirty,
			indexSha256: index,
			specSha256: hash(readFileSync("tests/e2e/catalog-categories.spec.ts")),
		},
		null,
		2,
	),
);
const run = spawnSync(
	process.execPath,
	[
		"node_modules/@playwright/test/cli.js",
		"test",
		"--config",
		web
			? "playwright.catalog.config.ts"
			: "playwright.portable-release.config.ts",
		"tests/e2e/catalog-categories.spec.ts",
		"--reporter=json,line",
	],
	{
		env: {
			...process.env,
			KEEPANY_EVIDENCE_DIR: join(output, "browser"),
			PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath,
		},
		stdio: "inherit",
		timeout: 5 * 60_000,
	},
);
if (run.error || run.status !== 0) {
	writeFileSync(
		join(output, "result.json"),
		JSON.stringify({
			status: "incomplete",
			exitCode: run.status,
			error: run.error?.message,
		}),
	);
	process.exitCode = 1;
} else {
	const report = JSON.parse(readFileSync(reportPath, "utf8")),
		tests = [];
	const walk = (suites) =>
		suites.forEach((suite) => {
			for (const spec of suite.specs ?? []) tests.push(...spec.tests);
			walk(suite.suites ?? []);
		});
	walk(report.suites);
	if (
		report.errors?.length ||
		tests.length !== 14 ||
		tests.some(
			(test) =>
				test.status !== "expected" ||
				test.results.length !== 1 ||
				test.results[0].status !== "passed",
		)
	)
		throw Error("Missing, skipped, retried or failed category checks.");
	const files = [];
	const collect = (dir) =>
		readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) collect(path);
			else files.push(path);
		});
	collect(output);
	const receipts = tests
		.flatMap((test) => test.results[0].attachments ?? [])
		.filter((attachment) => attachment.name === "contract-results.json")
		.map((attachment) =>
			JSON.parse(
				attachment.path
					? readFileSync(attachment.path, "utf8")
					: Buffer.from(attachment.body, "base64").toString(),
			),
		);
	const ids = new Set(receipts.flatMap((receipt) => receipt.ids));
	for (const id of [
		"CAT01",
		"CAT02",
		"CAT03",
		"CAT04",
		"CAT05",
		"CAT06",
		"CAT07",
		"CAT08",
		"CAT09",
		"CAT13",
	])
		if (!ids.has(id)) throw Error(`Missing coverage ID ${id}`);
	if (
		receipts.some(
			(receipt) => receipt.result !== "passed" || receipt.candidate !== index,
		)
	)
		throw Error("Evidence candidate mismatch.");
	for (const locale of ["zh-CN", "en"])
		for (const width of [390, 768, 884, 1280, 1920]) {
			const receipt = receipts.find(
				(receipt) => receipt.locale === locale && receipt.width === width,
			);
			if (!receipt) throw Error(`Missing layout ${locale}/${width}`);
		}
	const images = files
		.filter((path) => path.endsWith(".png"))
		.map((path) => ({
			path: relative(output, path).replaceAll("\\", "/"),
			sha256: hash(readFileSync(path)),
		}));
	if (images.length < 40) throw Error("Missing layout evidence.");
	writeFileSync(
		join(output, "result.json"),
		JSON.stringify(
			{
				status: "automated-pass",
				sourceCommit: identity.sourceCommit,
				indexSha256: index,
				tests: tests.length,
				ids: [...ids, "CAT12"],
				images,
				manualVisual: "separate",
				controllerJourney: "separate",
				independentReview: "separate",
			},
			null,
			2,
		),
	);
	console.log(
		"Category machine checks passed; manual visual, controller and independent review remain separate.",
	);
}
