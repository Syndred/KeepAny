import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const built = join(root, "apps/web/dist");
const release = join(root, "release/web");
const manifestPath = join(root, "release/retained-assets.json");
const record = process.argv[2] === "--record-retained";

if (process.argv.length > (record ? 3 : 2)) {
  throw new Error("Usage: node scripts/verify-local-release.mjs [--record-retained]");
}

function files(directory) {
  if (!existsSync(directory)) throw new Error(`Missing directory: ${directory}`);
  const result = new Map();
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) result.set(relative(directory, path).split(sep).join("/"), readFileSync(path));
      else throw new Error(`Unexpected entry: ${path}`);
    }
  }
  visit(directory);
  return result;
}

const builtFiles = files(built);
const releaseFiles = files(release);
const errors = [];

for (const [path, contents] of builtFiles) {
  const committed = releaseFiles.get(path);
  if (!committed) errors.push(`Missing current bundle file: ${path}`);
  else if (!committed.equals(contents)) errors.push(`Current bundle differs: ${path}`);
}

const retained = [...releaseFiles]
  .filter(([path]) => !builtFiles.has(path))
  .map(([path, contents]) => [path, createHash("sha256").update(contents).digest("hex")]);

// Only old versioned chunks and PWA runtime files may outlive the current build.
for (const [path] of retained) {
  if (!/^assets\/[\w.-]+-[\w-]+\.(?:js|css)$/.test(path)
    && !/^workbox-[a-f\d]+\.js$/.test(path)
    && path !== "registerSW.js") {
    errors.push(`Unexpected retained file: ${path}`);
  }
}

if (record) {
  if (errors.length) throw new Error(errors.join("\n"));
  writeFileSync(manifestPath, `${JSON.stringify(Object.fromEntries(retained), null, 2)}\n`);
  console.log(`Recorded ${retained.length} retained files after verifying ${builtFiles.size} current files.`);
} else {
  if (!existsSync(manifestPath)) throw new Error("Missing retained-assets.json");
  const expected = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (Object.keys(expected).length !== retained.length) errors.push("Retained file count differs from manifest.");
  for (const [path, digest] of retained) {
    if (expected[path] !== digest) errors.push(`Unlisted or changed retained file: ${path}`);
  }
  for (const path of Object.keys(expected)) {
    if (!releaseFiles.has(path)) errors.push(`Listed retained file is missing: ${path}`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`Verified ${builtFiles.size} current files byte for byte and ${retained.length} explicitly listed retained files.`);
}
