import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCandidate } from "./lib/portable-candidate.mjs";

// Name this checkout's clean build explicitly. Historical packages may coexist.
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const archive = resolve("dist/preview", `KeepAny-${version}-preview.${commit.slice(0, 12)}-portable.zip`);
const { release } = readCandidate(archive);
if (release.sourceCommit !== commit || release.sourceDirty) throw Error("CI candidate does not match this clean checkout.");
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `KEEPANY_PREVIEW_ARCHIVE=${archive}\n`);
console.log(archive);
