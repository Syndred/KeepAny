import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { materializeCandidate, readCandidate, safeCandidatePath, selectCandidate } from "./portable-candidate.mjs";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const owned: string[] = [];
afterEach(() => { for (const directory of owned.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture(options: { wrongWebHash?: boolean; wrongZipHash?: boolean; duplicate?: boolean; missingSw?: boolean; unsafeMember?: string; badIdentity?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "keepany-candidate-contract-")); owned.push(root);
  const files: Record<string, Uint8Array> = { "index.html": strToU8("<html>fictional candidate</html>"), "sw.js": strToU8("// fictional service worker") };
  const webFiles = Object.entries(files).filter(([path]) => !options.missingSw || path !== "sw.js").map(([path, bytes]) => ({ path, sha256: options.wrongWebHash ? "0".repeat(64) : sha(bytes) }));
  if (options.duplicate) webFiles.push(webFiles[0]);
  const release = { schema: "keepany.portable-preview.v1", sourceCommit: options.badIdentity ? "not-a-commit" : "1".repeat(40), sourceDirty: false, webFiles };
  const members: Record<string, Uint8Array> = { "portable/RELEASE.json": strToU8(JSON.stringify(release)), ...Object.fromEntries(Object.entries(files).map(([name, bytes]) => [`portable/web/${name}`, bytes])) };
  if (options.unsafeMember) members[options.unsafeMember] = strToU8("must never be extracted");
  const bytes = zipSync(members), archive = join(root, "candidate.zip");
  writeFileSync(archive, bytes); writeFileSync(`${archive}.sha256`, (options.wrongZipHash ? "0".repeat(64) : sha(bytes)) + "  candidate.zip\n");
  const directory = join(root, "directory"); mkdirSync(join(directory, "web"), { recursive: true });
  writeFileSync(join(directory, "RELEASE.json"), JSON.stringify(release));
  for (const [name, data] of Object.entries(files)) writeFileSync(join(directory, "web", name), data);
  return { archive, directory, bytes };
}
describe("compiled candidate input boundary", () => {
  it("requires exactly one explicit input, with no source/latest fallback", () => {
    expect(() => selectCandidate({ env: {} })).toThrow("exactly one");
    expect(() => selectCandidate({ argument: "a.zip", env: { KEEPANY_PREVIEW_ARCHIVE: "b.zip" } })).toThrow("exactly one");
    expect(() => selectCandidate({ env: { KEEPANY_PREVIEW_ARCHIVE: "a.zip", KEEPANY_PREVIEW_DIRECTORY: "directory" } })).toThrow("exactly one");
    expect(selectCandidate({ argument: "chosen.zip", env: {} })).toBe(resolve("chosen.zip"));
    expect(() => selectCandidate({ argument: "directory", env: {}, archiveOnly: true })).toThrow("explicit portable ZIP");
  });
  it("checks equivalent directory and ZIP web bytes while keeping archive identity separate", () => {
    const input = fixture();
    const fromZip = readCandidate(input.archive), fromDirectory = readCandidate(input.directory);
    expect(fromZip.release).toEqual(fromDirectory.release);
    expect(fromZip.archiveSha256).toBe(sha(input.bytes));
    expect(fromDirectory.archiveSha256).toBeUndefined();
  });
  it("extracts only the verified archive and cleans its owned temporary copy", () => {
    const input = fixture(), candidate = materializeCandidate(input.archive);
    expect(readFileSync(join(candidate.directory, "web/index.html"), "utf8")).toContain("fictional candidate");
    const extracted = candidate.directory; candidate.cleanup();
    expect(existsSync(extracted)).toBe(false);
    expect(existsSync(input.archive)).toBe(true);
    const directory = materializeCandidate(input.directory); directory.cleanup(); expect(existsSync(input.directory)).toBe(true);
  });
  it.each(["../outside", "/absolute", "C:/absolute", "C:drive-relative", "a\\b", "a/./b", "a//b", ""]) ("rejects unsafe member %j before extraction", name => {
    expect(() => safeCandidatePath(name)).toThrow("Unsafe");
    if (name) expect(() => readCandidate(fixture({ unsafeMember: name }).archive)).toThrow("Unsafe");
  });
  it.each([
    [{ wrongZipHash: true }, "archive checksum"],
    [{ wrongWebHash: true }, "web checksum"],
    [{ duplicate: true }, "Duplicate"],
    [{ missingSw: true }, "sw.js"],
    [{ badIdentity: true }, "identity"],
  ] as const)("rejects invalid archive contract %j", (options, message) => {
    expect(() => readCandidate(fixture(options).archive)).toThrow(message);
  });
});
