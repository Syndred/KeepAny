import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const directory = process.argv[2];
const { KEEPANY_DESKTOP_TARGET: target, KEEPANY_EXPECTED_COMMIT: commit } = process.env;
const manifests = {
  "x86_64-pc-windows-msvc": ["x64-setup.exe", "x64.exe"],
  "aarch64-apple-darwin": ["aarch64.dmg"],
  "x86_64-apple-darwin": ["x64.dmg"],
};

if (!directory || !/^[0-9a-f]{40}$/.test(commit ?? "") || !Object.hasOwn(manifests, target)) {
  throw Error("Expected candidate directory, source commit and supported desktop target");
}

const build = JSON.parse(readFileSync(join(directory, "build.json"), "utf8"));
if (build.commit !== commit || build.target !== target || !/^\d+\.\d+\.\d+$/.test(build.version)) {
  throw Error("Desktop build identity mismatch");
}

const expectedNames = manifests[target].map(suffix => `KeepAny_${build.version}_${suffix}`);
const fileNames = build.files.map(file => file.name).sort();
if (JSON.stringify(fileNames) !== JSON.stringify(expectedNames.sort())) {
  throw Error("Unexpected desktop installer list");
}
const expectedContents = [...expectedNames, "build.json", "SHA256SUMS.txt"].sort();
if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(expectedContents)) {
  throw Error("Unexpected files in desktop artifact");
}

const manifestChecksums = readFileSync(join(directory, "SHA256SUMS.txt"), "utf8").trim().split(/\r?\n/).sort();
const checked = build.files.map(file => {
  const bytes = readFileSync(join(directory, file.name));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== file.sha256 || bytes.length !== file.bytes) throw Error(`Integrity failure: ${file.name}`);
  return `${sha256}  ${file.name}`;
}).sort();
if (JSON.stringify(manifestChecksums) !== JSON.stringify(checked)) throw Error("SHA256SUMS mismatch");
console.log(`${build.commit} ${target}\n${checked.join("\n")}`);
