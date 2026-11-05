import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { zipSync } from "fflate";

const cli = fileURLToPath(new URL("./verify-mobile-candidate.mjs", import.meta.url));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const otherSha = "f".repeat(64);
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

// These are real ZIP bytes with APK paths, not an installable Android package.
// The acceptance records below are synthetic gate fixtures, never UI evidence.
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "keepany-mobile-gate-"));
  t.after(() => {
    const actual = realpathSync(directory);
    assert(actual.startsWith(`${realpathSync(tmpdir())}${sep}`));
    rmSync(actual, { recursive: true, force: true });
  });
  const web = join(directory, "compiled-web");
  const resultsDirectory = join(directory, "acceptance");
  mkdirSync(join(web, "assets"), { recursive: true });
  mkdirSync(join(resultsDirectory, "evidence"), { recursive: true });
  const webFiles = {
    "index.html": Buffer.from('<html><script src="assets/app.js"></script></html>'),
    "assets/app.js": Buffer.from('document.body.textContent = "合成测试 / fixture";'),
  };
  for (const [path, bytes] of Object.entries(webFiles)) writeFileSync(join(web, path), bytes);
  const apkEntries = {
    "AndroidManifest.xml": Buffer.from("synthetic APK fixture"),
    "classes.dex": Buffer.from([0, 1, 2, 3]),
    ...Object.fromEntries(Object.entries(webFiles).map(([path, bytes]) => [`assets/public/${path}`, bytes])),
  };
  const apk = join(directory, "candidate.apk");
  writeFileSync(apk, zipSync(apkEntries));
  const candidateSha256 = sha256(readFileSync(apk));
  const manifestPath = join(directory, "candidate.json");
  const manifest = {
    schema: "keepany.mobile-candidate.v1",
    sourceCommit: "a".repeat(40),
    sourceDirty: true,
    apkSha256: candidateSha256,
    webDirectory: "compiled-web",
    webFiles: Object.entries(webFiles).map(([path, bytes]) => ({ path, sha256: sha256(bytes) })),
  };
  const evidencePath = join(resultsDirectory, "evidence", "fixture.md");
  writeFileSync(evidencePath, "Synthetic integrity fixture. No Android or human UI journey was performed.\n");
  const evidence = () => [{ path: "evidence/fixture.md", sha256: sha256(readFileSync(evidencePath)), candidateSha256 }];
  const acceptance = {
    schema: "keepany.mobile-acceptance.v1",
    candidateSha256,
    dimensions: Object.fromEntries(["function", "visual", "whitebox", "controller", "independent"].map(name => [name, { status: "PASS", candidateSha256, evidence: evidence() }])),
    cases: Array.from({ length: 18 }, (_, i) => ({ id: `MM${String(i + 1).padStart(2, "0")}`, result: "pass", candidateSha256, evidence: evidence() })),
  };
  const acceptancePath = join(resultsDirectory, "results.json");
  const save = () => { json(manifestPath, manifest); json(acceptancePath, acceptance); };
  save();
  return { directory, web, webFiles, apkEntries, apk, manifestPath, manifest, acceptancePath, acceptance, evidencePath, save };
}

function run(f, { bundleOnly = false, acceptance = true, cwd } = {}) {
  const args = [cli, f.manifestPath, f.apk];
  if (acceptance) args.push(f.acceptancePath);
  if (bundleOnly) args.push("--bundle-only");
  const result = spawnSync(process.execPath, args, { encoding: "utf8", cwd });
  assert.ifError(result.error);
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { assert.fail(`CLI did not return JSON (exit ${result.status}): ${result.stdout}\n${result.stderr}`); }
  return { ...result, report };
}

function rejects(f, pattern, options) {
  const result = run(f, options);
  assert.equal(result.status, 1, JSON.stringify(result.report));
  assert.equal(result.report.status, "FAIL");
  assert.match(result.report.errors.join("\n"), pattern);
  return result.report;
}

function repack(f) {
  writeFileSync(f.apk, zipSync(f.apkEntries));
  f.manifest.apkSha256 = sha256(readFileSync(f.apk));
  f.save();
}

test("bundle-only verifies real ZIP/web bytes from any cwd and states the unaccepted UI boundary", t => {
  const f = fixture(t);
  const result = run(f, { bundleOnly: true, acceptance: false, cwd: dirname(f.directory) });
  assert.equal(result.status, 0, JSON.stringify(result.report));
  assert.equal(result.report.status, "PASS");
  assert.equal(result.report.scope, "bundle-only");
  assert.equal(result.report.webFilesVerified, 2);
  assert.equal(result.report.acceptanceRecordsChecked, false);
  assert.equal(result.report.nativeExperienceProven, false);
  assert.match(result.report.limitations, /UI|界面/);
});

test("complete synthetic records pass integrity only, without claiming human/native experience", t => {
  const f = fixture(t);
  f.acceptance.cases[17] = { ...f.acceptance.cases[17], result: "not-applicable", reason: "Synthetic fixture exercises the explicit NA branch." };
  f.save();
  const result = run(f);
  assert.equal(result.status, 0, JSON.stringify(result.report));
  assert.equal(result.report.scope, "acceptance-record-integrity");
  assert.equal(result.report.casesVerified, 18);
  assert.equal(result.report.dimensionsVerified, 5);
  assert.equal(result.report.acceptanceRecordsChecked, true);
  assert.equal(result.report.nativeExperienceProven, false);
});

test("full mode refuses missing acceptance results instead of silently falling back", t => {
  rejects(fixture(t), /acceptance.*required/i, { acceptance: false });
});

test("bundle-only never promotes even a supplied incomplete acceptance file", t => {
  const f = fixture(t);
  f.acceptance.cases = [];
  f.save();
  const result = run(f, { bundleOnly: true });
  assert.equal(result.status, 0);
  assert.equal(result.report.acceptanceRecordsChecked, false);
  assert.equal(result.report.nativeExperienceProven, false);
});

test("tampered APK bytes fail the candidate archive checksum", t => {
  const f = fixture(t);
  writeFileSync(f.apk, Buffer.concat([readFileSync(f.apk), Buffer.from("tamper")]));
  rejects(f, /APK SHA256 mismatch/, { bundleOnly: true });
});

test("tampered public bytes still fail after the outer APK checksum is refreshed", t => {
  const f = fixture(t);
  f.apkEntries["assets/public/assets/app.js"] = Buffer.from("tampered script");
  repack(f);
  rejects(f, /APK public bytes mismatch.*assets\/app\.js/, { bundleOnly: true });
});

test("tampered compiled directory and declared wrong hash each fail", t => {
  const f = fixture(t);
  writeFileSync(join(f.web, "index.html"), "tampered compiled file");
  f.manifest.webFiles[1].sha256 = otherSha;
  f.save();
  const report = rejects(f, /compiled web SHA256 mismatch.*index\.html/, { bundleOnly: true });
  assert.match(report.errors.join("\n"), /compiled web SHA256 mismatch.*assets\/app\.js/);
});

test("missing and undeclared APK public resources fail", t => {
  const f = fixture(t);
  delete f.apkEntries["assets/public/index.html"];
  f.apkEntries["assets/public/undeclared.js"] = Buffer.from("unexpected");
  repack(f);
  const report = rejects(f, /missing APK public file.*index\.html/, { bundleOnly: true });
  assert.match(report.errors.join("\n"), /undeclared APK public file.*undeclared\.js/);
});

test("undeclared compiled files and duplicate manifest paths fail", t => {
  const f = fixture(t);
  writeFileSync(join(f.web, "extra.txt"), "undeclared");
  f.manifest.webFiles.push({ ...f.manifest.webFiles[0] });
  f.save();
  const report = rejects(f, /duplicate webFiles path.*index\.html/, { bundleOnly: true });
  assert.match(report.errors.join("\n"), /undeclared compiled web file.*extra\.txt/);
});

test("unsafe manifest and ZIP paths fail", t => {
  const f = fixture(t);
  f.manifest.webFiles.push({ path: "../escape.js", sha256: otherSha });
  f.apkEntries["assets/public/../escape.js"] = Buffer.from("unsafe");
  repack(f);
  const report = rejects(f, /unsafe webFiles path/, { bundleOnly: true });
  assert.match(report.errors.join("\n"), /unsafe APK entry/);
});

test("duplicate ZIP members cannot be hidden by unzipSync's name map", t => {
  const f = fixture(t);
  f.apkEntries["assets/public/other.html"] = f.apkEntries["assets/public/index.html"];
  const bytes = Buffer.from(zipSync(f.apkEntries));
  const from = Buffer.from("assets/public/other.html");
  const to = Buffer.from("assets/public/index.html");
  assert.equal(from.length, to.length);
  let replacements = 0;
  for (let offset = bytes.indexOf(from); offset !== -1; offset = bytes.indexOf(from, offset + to.length)) {
    to.copy(bytes, offset);
    replacements += 1;
  }
  assert.equal(replacements, 2, "Replace the real local and central ZIP member names");
  writeFileSync(f.apk, bytes);
  f.manifest.apkSha256 = sha256(bytes);
  f.save();
  rejects(f, /duplicate APK entry.*index\.html/, { bundleOnly: true });
});

test("manifest requires exact schema, full commit, boolean dirty, nonempty web list and index", t => {
  const f = fixture(t);
  f.manifest.schema = "other";
  f.manifest.sourceCommit = "abcdef0";
  f.manifest.sourceDirty = "false";
  f.manifest.webFiles = [];
  f.save();
  const report = rejects(f, /manifest schema/, { bundleOnly: true });
  for (const pattern of [/sourceCommit/, /sourceDirty/, /webFiles/, /index\.html/]) assert.match(report.errors.join("\n"), pattern);
});

test("accepts an absolute compiled directory", t => {
  const f = fixture(t);
  f.manifest.webDirectory = resolve(f.web);
  f.save();
  assert.equal(run(f, { bundleOnly: true }).status, 0);
});

test("reports all missing MM IDs, duplicate IDs and unsupported IDs", t => {
  const f = fixture(t);
  f.acceptance.cases = f.acceptance.cases.slice(0, 16);
  f.acceptance.cases.push({ ...f.acceptance.cases[0] }, { ...f.acceptance.cases[0], id: "MM99" });
  f.save();
  const report = rejects(f, /missing case MM17/);
  for (const pattern of [/missing case MM18/, /duplicate case MM01/, /unexpected case MM99/]) assert.match(report.errors.join("\n"), pattern);
});

test("all five dimensions must pass and carry nonempty evidence", t => {
  const f = fixture(t);
  delete f.acceptance.dimensions.visual;
  f.acceptance.dimensions.function.status = "FAIL";
  f.acceptance.dimensions.independent.evidence = [];
  f.save();
  const report = rejects(f, /missing dimension visual/);
  assert.match(report.errors.join("\n"), /dimension function.*PASS/);
  assert.match(report.errors.join("\n"), /dimension independent.*evidence/);
});

test("case evidence is mandatory, and not-applicable requires a reason", t => {
  const f = fixture(t);
  f.acceptance.cases[0].evidence = [];
  f.acceptance.cases[1].result = "not-applicable";
  f.acceptance.cases[2].result = "skip";
  f.save();
  const report = rejects(f, /case MM01.*evidence/);
  assert.match(report.errors.join("\n"), /case MM02.*reason/);
  assert.match(report.errors.join("\n"), /case MM03.*result/);
});

test("candidate binding is checked at results, dimensions, cases and every evidence object", t => {
  const f = fixture(t);
  f.acceptance.candidateSha256 = otherSha;
  f.acceptance.dimensions.controller.candidateSha256 = otherSha;
  f.acceptance.cases[0].candidateSha256 = otherSha;
  f.acceptance.cases[1].evidence[0].candidateSha256 = otherSha;
  f.save();
  const report = rejects(f, /acceptance candidateSha256 mismatch/);
  for (const pattern of [/dimension controller.*candidateSha256 mismatch/, /case MM01.*candidateSha256 mismatch/, /case MM02 evidence\[0\].*candidateSha256 mismatch/]) assert.match(report.errors.join("\n"), pattern);
});

test("missing, non-file and changed evidence bytes fail", t => {
  const f = fixture(t);
  f.acceptance.cases[0].evidence[0].path = "evidence/missing.png";
  f.acceptance.cases[1].evidence[0].path = "evidence";
  writeFileSync(f.evidencePath, "changed evidence bytes");
  f.save();
  const report = rejects(f, /case MM01 evidence\[0\].*cannot read/);
  assert.match(report.errors.join("\n"), /case MM02 evidence\[0\].*regular file/);
  assert.match(report.errors.join("\n"), /evidence.*SHA256 mismatch/);
});

test("evidence rejects traversal and absolute paths", t => {
  const f = fixture(t);
  f.acceptance.cases[0].evidence[0].path = "../candidate.apk";
  f.acceptance.cases[1].evidence[0].path = f.evidencePath;
  f.acceptance.cases[2].evidence[0].path = "C:\\outside\\evidence.png";
  f.save();
  const report = rejects(f, /case MM01 evidence\[0\].*unsafe evidence path/);
  for (const id of ["MM02", "MM03"]) assert.match(report.errors.join("\n"), new RegExp(`case ${id} evidence\\[0\\].*unsafe evidence path`));
});

test("realpath containment rejects evidence symlinks out of the results directory", t => {
  const f = fixture(t);
  const outside = join(f.directory, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "proof.md"), "outside proof");
  symlinkSync(outside, join(dirname(f.acceptancePath), "linked"), process.platform === "win32" ? "junction" : "dir");
  f.acceptance.cases[0].evidence[0] = { path: "linked/proof.md", sha256: sha256(readFileSync(join(outside, "proof.md"))), candidateSha256: f.manifest.apkSha256 };
  f.save();
  rejects(f, /case MM01 evidence\[0\].*escapes/);
});

test("realpath containment rejects compiled file symlinks out of the web directory", t => {
  const f = fixture(t);
  const outside = join(f.directory, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "proof.js"), "outside script");
  symlinkSync(outside, join(f.web, "linked"), process.platform === "win32" ? "junction" : "dir");
  f.manifest.webFiles.push({ path: "linked/proof.js", sha256: sha256(readFileSync(join(outside, "proof.js"))) });
  f.save();
  rejects(f, /compiled web.*escapes/, { bundleOnly: true });
});

test("malformed JSON and non-ZIP APK return readable failures", t => {
  const f = fixture(t);
  writeFileSync(f.acceptancePath, "{invalid");
  rejects(f, /cannot read acceptance/);
  writeFileSync(f.apk, "not a zip");
  f.manifest.apkSha256 = sha256(readFileSync(f.apk));
  json(f.manifestPath, f.manifest);
  rejects(f, /cannot read APK ZIP/, { bundleOnly: true });
});

test("unknown options and missing CLI inputs fail with usage", () => {
  for (const args of [[], ["--unknown"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).errors.join("\n"), /Usage:/);
  }
});
