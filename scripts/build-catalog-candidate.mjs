import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { resolve, join, relative } from "node:path";

// A compiled Web candidate for user acceptance. This does not produce a release ZIP.
const root = resolve(import.meta.dirname, "..");
const destination = resolve(process.argv[2] ?? "");
if (!process.argv[2] || existsSync(join(destination, "index.html")))
	throw Error(
		"Specify a new candidate directory; previous evidence is never overwritten.",
	);
const run = (command, args) =>
	execFileSync(command, args, { cwd: root, stdio: "inherit" });
run(process.execPath, [
	join(root, "node_modules/typescript/bin/tsc"),
	"--noEmit",
]);
mkdirSync(destination, { recursive: true });
run(process.execPath, [
	join(root, "node_modules/vite/bin/vite.js"),
	"build",
	"apps/web",
	"--outDir",
	destination,
	"--logLevel",
	"warn",
]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const walk = (directory) =>
	readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? walk(join(directory, entry.name))
			: [join(directory, entry.name)],
	);
const sourcePaths = execFileSync(
	"git",
	["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
	{ cwd: root },
)
	.toString()
	.split("\0")
	.filter(Boolean);
const manifest = {
	schema: "keepany.catalog-web.v1",
	sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root })
		.toString()
		.trim(),
	sourceDirty: !!execFileSync("git", ["status", "--porcelain"], { cwd: root })
		.toString()
		.trim(),
	sourceFiles: sourcePaths
		.filter((path) => !path.startsWith("test-results/"))
		.map((path) => ({ path, sha256: sha(readFileSync(join(root, path))) })),
	webFiles: walk(destination).map((path) => ({
		path: relative(destination, path).replaceAll("\\", "/"),
		sha256: sha(readFileSync(path)),
	})),
};
writeFileSync(
	join(destination, "CANDIDATE.json"),
	JSON.stringify(manifest, null, 2),
);
console.log(
	JSON.stringify({
		directory: destination,
		sourceCommit: manifest.sourceCommit,
		sourceDirty: manifest.sourceDirty,
		indexSha256: manifest.webFiles.find((file) => file.path === "index.html")
			.sha256,
	}),
);
