import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Isolated-fiction diagnostics only. Never copy arbitrary trace args or URLs.
const files = process.argv.slice(2);
if (!files.length)
	throw Error("Provide exported Chromium loading trace paths.");
// Fixed literals from the two observed Chromium revisions, not arbitrary text.
const knownReasons = new Set([
	"Fetch event dispatch did not complete",
	"Disconnected before completed",
	"Zero response status",
	"Failed to read blob body",
	"Can't create empty data pipe",
	"No body exists",
	"Too many redirects",
	"Invalid redirect",
	"Body reading completed",
	"Invalid response from static router",
	"SRI message signature mismatch",
]);
const knownFlowNames = new Set(
	[
		"CommitCompleted",
		"DispatchFetchEvent",
		"FollowRedirect",
		"OnBodyReadingComplete",
		"OnFallback",
		"OnFetchEventFinished",
		"OnResponse",
		"OnResponseStream",
		"OnSideDataReadingComplete",
		"StartBlobReading",
		"StartRequest",
	].map((name) => `ServiceWorkerSubresourceLoader::${name}`),
);
// Conservative subset actually used by the two observed loader revisions.
// Other genuine or unknown codes remain unavailable in the public derivative.
const knownErrorCodes = new Set([
	"net::OK",
	"net::ERR_ABORTED",
	"net::ERR_BLOCKED_BY_RESPONSE",
	"net::ERR_FAILED",
	"net::ERR_INSUFFICIENT_RESOURCES",
	"net::ERR_INVALID_REDIRECT",
	"net::ERR_TOO_MANY_REDIRECTS",
]);
const finite = (value) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;
const flowId = (value) =>
	typeof value === "string" && /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)
		? value
		: finite(value);
function summarize(file) {
	const bytes = readFileSync(file);
	const data = JSON.parse(bytes.toString("utf8"));
	if (!Array.isArray(data.traceEvents)) throw Error("No traceEvents array.");
	const events = data.traceEvents.filter(
		(event) =>
			typeof event.cat === "string" &&
			event.cat.split(",").includes("ServiceWorker"),
	);
	const starts = events.filter(
		(event) => event.name === "ServiceWorkerSubresourceLoader::StartRequest",
	);
	const completions = events.filter(
		(event) => event.name === "ServiceWorkerSubresourceLoader::CommitCompleted",
	);
	if (!starts.length || !completions.length)
		throw Error(
			"Actual ServiceWorker request-start/completion events are missing.",
		);
	const metadata = (event) => ({
		name: event.name,
		timestampUs: finite(event.ts),
		durationUs: finite(event.dur),
		phase:
			typeof event.ph === "string" && /^[A-Za-z()]$/.test(event.ph)
				? event.ph
				: null,
		processId: finite(event.pid),
		threadId: finite(event.tid),
		flowId: flowId(event.id),
		flowId2: {
			global: flowId(event.id2?.global),
			local: flowId(event.id2?.local),
		},
		flowBindId: flowId(event.bind_id),
	});
	const publicStarts = starts.flatMap((event) => {
		try {
			const url = new URL(event.args?.url);
			if (
				!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
				!url.pathname.startsWith("/assets/") ||
				!/\.(js|css)$/.test(url.pathname)
			)
				return [];
			return [{ ...metadata(event), publicPath: url.pathname }];
		} catch {
			return [];
		}
	});
	const publicCompletions = completions.map((event) => ({
		...metadata(event),
		errorCode: knownErrorCodes.has(event.args?.error_code)
			? event.args.error_code
			: "[unavailable-code]",
		// Only fixed internal Chromium reason tokens that contain no path/content.
		reason: knownReasons.has(event.args?.reason)
			? event.args.reason
			: "[omitted-nonstatic-reason]",
	}));
	const result = {
		schema: "keepany.chromium-service-worker-public-trace.v2",
		classification:
			"Dedicated diagnostic capture; event presence is not cancellation causality or product acceptance.",
		sourceFile: relative(process.cwd(), file).split("\\").join("/"),
		bytes: bytes.byteLength,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		parserSha256: createHash("sha256")
			.update(readFileSync(fileURLToPath(import.meta.url)))
			.digest("hex"),
		eventCount: data.traceEvents.length,
		serviceWorkerEventCount: events.length,
		observedStartCount: starts.length,
		observedCompletionCount: completions.length,
		publicStaticStarts: publicStarts,
		completions: publicCompletions,
		flowEvents: events
			.filter(
				(event) => /^[stf]$/.test(event.ph) && knownFlowNames.has(event.name),
			)
			.map(metadata),
		limitations: [
			"Raw trace is retained in isolated local/CI artifact only; no headers/body/arbitrary args/full commands exported.",
			"Trace ring buffer may wrap. Observed event spans do not prove complete capture; missing mapping remains unknown.",
			"Map native flow/process/time to public request start and original CDP failure before attributing any reason.",
			"Later normal browser shutdown errors must not be attributed to an earlier request without that mapping.",
			"Counts are event counts. Complete X events can have separate s/t/f flow records; do not count these as separate requests. Null flow IDs on X records require joining the separate flow records, not guessing.",
		],
	};
	const output = join(
		dirname(file),
		`${basename(file, ".json")}-public-summary-v2.json`,
	);
	if (existsSync(output))
		throw Error("Preserve the existing summary; use a new evidence directory.");
	writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
	console.log(
		JSON.stringify({
			file: result.sourceFile,
			output: relative(process.cwd(), output),
			sha256: result.sha256,
			eventCount: result.eventCount,
			serviceWorkerEventCount: events.length,
			starts: starts.length,
			completions: completions.length,
			publicStaticStarts: publicStarts.length,
			flowEvents: result.flowEvents.length,
			failures: publicCompletions.filter((event) =>
				event.errorCode.startsWith("net::ERR_"),
			).length,
			unavailableCodes: publicCompletions.filter(
				(event) => event.errorCode === "[unavailable-code]",
			).length,
			causality: "unresolved; mapping required",
		}),
	);
}

let unavailableFiles = 0;
for (const file of files) {
	try {
		summarize(file);
	} catch (error) {
		unavailableFiles++;
		// Never print JSON.parse messages, which may contain input body excerpts.
		console.error(
			JSON.stringify({
				sourceFile: relative(process.cwd(), file).split("\\").join("/"),
				classification:
					"trace-summary-unavailable; other inputs still processed",
				errorName: error instanceof SyntaxError ? "SyntaxError" : "Error",
			}),
		);
	}
}
if (unavailableFiles) process.exitCode = 1;
