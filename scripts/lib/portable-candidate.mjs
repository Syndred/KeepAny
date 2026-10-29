import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve, sep, win32 } from "node:path";
import { strFromU8, unzipSync } from "fflate";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function safeCandidatePath(name) {
  if (typeof name !== "string" || !name || isAbsolute(name) || win32.isAbsolute(name) || name.includes("\\") || name.includes(":") || name.split("/").some(part => !part || part === "." || part === "..")) throw Error("Unsafe portable candidate path.");
  return name;
}

export function selectCandidate({ argument, env = process.env, archiveOnly = false } = {}) {
  const selected = [argument, env.KEEPANY_PREVIEW_DIRECTORY, env.KEEPANY_PREVIEW_ARCHIVE].filter(Boolean);
  if (selected.length !== 1) throw Error("Specify exactly one compiled portable directory or ZIP, as an argument or KEEPANY_PREVIEW_DIRECTORY/KEEPANY_PREVIEW_ARCHIVE.");
  const input = resolve(selected[0]);
  if (archiveOnly && !input.endsWith(".zip")) throw Error("This receipt requires an explicit portable ZIP and its archive checksum.");
  return input;
}

export function readCandidate(input) {
  const absolute = resolve(input);
  let members, archiveSha256;
  let directory = absolute;
  if (absolute.endsWith(".zip")) {
    const bytes = readFileSync(absolute);
    const expected = readFileSync(`${absolute}.sha256`, "utf8").split(/\s+/)[0];
    archiveSha256 = sha(bytes);
    if (!digest(expected) || archiveSha256 !== expected) throw Error("Portable archive checksum mismatch.");
    members = unzipSync(bytes);
    const names = Object.keys(members);
    if (!names.length) throw Error("Empty portable archive.");
    const roots = new Set(names.map(name => safeCandidatePath(name).split("/")[0]));
    if (roots.size !== 1) throw Error("Portable archive must have one root.");
    directory = [...roots][0];
    if (names.filter(name => name.endsWith("/RELEASE.json")).length !== 1) throw Error("Expected one candidate release manifest.");
  } else if (!statSync(absolute).isDirectory()) throw Error("Portable candidate is not a directory.");
  const read = name => {
    safeCandidatePath(name);
    const bytes = members ? members[`${directory}/${name}`] : readFileSync(join(directory, name));
    if (!bytes) throw Error(`Missing candidate member: ${name}`);
    return bytes;
  };
  const release = JSON.parse(strFromU8(read("RELEASE.json")));
  if (release.schema !== "keepany.portable-preview.v1" || !/^[a-f0-9]{40}$/.test(release.sourceCommit) || typeof release.sourceDirty !== "boolean" || !Array.isArray(release.webFiles) || !release.webFiles.length) throw Error("Invalid compiled candidate identity.");
  const paths = new Set();
  for (const file of release.webFiles) {
    safeCandidatePath(file?.path);
    if (paths.has(file.path) || !digest(file.sha256)) throw Error("Duplicate or invalid candidate web manifest entry.");
    paths.add(file.path);
    if (sha(read(`web/${file.path}`)) !== file.sha256) throw Error(`Candidate web checksum mismatch: ${file.path}`);
  }
  if (!paths.has("index.html") || !paths.has("sw.js")) throw Error("Candidate web manifest must include index.html and sw.js.");
  return { input: absolute, directory, release, archiveSha256, members };
}

export function materializeCandidate(input) {
  const candidate = readCandidate(input);
  if (!candidate.members) return { ...candidate, cleanup() {} };
  const temporary = mkdtempSync(join(tmpdir(), "keepany-checked-candidate-"));
  const cleanup = () => {
    const absolute = resolve(temporary);
    if (!absolute.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(absolute).startsWith("keepany-checked-candidate-")) throw Error("Refuse cleanup outside the owned candidate extraction.");
    rmSync(absolute, { recursive: true, force: true });
  };
  try {
    for (const [name, bytes] of Object.entries(candidate.members)) {
      const destination = join(temporary, safeCandidatePath(name));
      mkdirSync(join(destination, ".."), { recursive: true });
      writeFileSync(destination, bytes);
    }
    return { ...candidate, directory: join(temporary, candidate.directory), cleanup };
  } catch (error) { cleanup(); throw error; }
}
