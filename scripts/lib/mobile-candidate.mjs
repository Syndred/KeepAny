import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { unzipSync } from "fflate";

const dimensions = ["function", "visual", "whitebox", "controller", "independent"];
const caseIds = Array.from({ length: 18 }, (_, i) => `MM${String(i + 1).padStart(2, "0")}`);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const matchesDigest = (value, expected) => digest(value) && value.toLowerCase() === expected;

function safeRelative(path) {
  return typeof path === "string" && path.length > 0 && !isAbsolute(path) && !win32.isAbsolute(path)
    && !path.includes("\\") && !path.includes(":") && !path.includes("\0")
    && !path.split("/").some(part => !part || part === "." || part === "..");
}

function contained(root, path) {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}

export function verifyMobileCandidate({ manifestPath, apkPath, acceptancePath, bundleOnly = false }) {
  const errors = [];
  const report = {
    schema: "keepany.mobile-verification.v1",
    status: "FAIL",
    scope: bundleOnly ? "bundle-only" : "acceptance-record-integrity",
    acceptanceRecordsChecked: false,
    nativeExperienceProven: false,
    webFilesVerified: 0,
    dimensionsVerified: 0,
    casesVerified: 0,
    limitations: bundleOnly
      ? "Bundle-only verifies artifact identity. It does not establish UI, functional, visual, whitebox, controller or independent acceptance; Android native acceptance remains incomplete."
      : "Verifies candidate binding, coverage and evidence file integrity only. It cannot inspect screenshot content or prove that UI, human review or native journeys occurred.",
    errors,
  };
  const readJson = (path, label) => {
    try {
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (!object(value)) throw Error("expected a JSON object");
      return value;
    } catch (error) { errors.push(`cannot read ${label}: ${error.message}`); return null; }
  };
  const readContained = (root, path, label) => {
    try {
      const actual = realpathSync(join(root, path));
      if (!contained(root, actual)) throw Error("realpath escapes its allowed directory");
      if (!statSync(actual).isFile()) throw Error("expected a regular file");
      return readFileSync(actual);
    } catch (error) { errors.push(`${label}: cannot read ${path}: ${error.message}`); return null; }
  };

  const manifest = readJson(resolve(manifestPath), "manifest");
  let apkBytes;
  try {
    apkBytes = readFileSync(resolve(apkPath));
    report.candidateSha256 = sha256(apkBytes);
  } catch (error) { errors.push(`cannot read APK: ${error.message}`); }

  let webRoot;
  const declared = new Map();
  if (manifest) {
    if (manifest.schema !== "keepany.mobile-candidate.v1") errors.push("invalid manifest schema: expected keepany.mobile-candidate.v1");
    if (typeof manifest.sourceCommit !== "string" || !/^[a-f0-9]{40}$/i.test(manifest.sourceCommit)) errors.push("sourceCommit must be a full 40-hex commit");
    if (typeof manifest.sourceDirty !== "boolean") errors.push("sourceDirty must be boolean");
    report.sourceCommit = manifest.sourceCommit;
    report.sourceDirty = manifest.sourceDirty;
    if (!matchesDigest(manifest.apkSha256, report.candidateSha256)) errors.push("APK SHA256 mismatch or invalid manifest apkSha256");
    if (typeof manifest.webDirectory !== "string" || !manifest.webDirectory.trim()) errors.push("webDirectory must name a compiled directory");
    else {
      try {
        webRoot = realpathSync(resolve(dirname(resolve(manifestPath)), manifest.webDirectory));
        if (!statSync(webRoot).isDirectory()) throw Error("expected a directory");
      } catch (error) { errors.push(`cannot read compiled web directory: ${error.message}`); webRoot = undefined; }
    }
    if (!Array.isArray(manifest.webFiles) || !manifest.webFiles.length) errors.push("webFiles must be a nonempty array");
    for (const [index, file] of (Array.isArray(manifest.webFiles) ? manifest.webFiles : []).entries()) {
      if (!object(file) || !safeRelative(file.path)) { errors.push(`unsafe webFiles path at index ${index}`); continue; }
      if (declared.has(file.path)) { errors.push(`duplicate webFiles path: ${file.path}`); continue; }
      declared.set(file.path, file);
      if (!digest(file.sha256)) errors.push(`invalid webFiles SHA256: ${file.path}`);
    }
    if (!declared.has("index.html")) errors.push("webFiles must include index.html");
  }

  if (webRoot) {
    const walk = (directory, prefix = "", ancestors = new Set()) => {
      try {
        const actual = realpathSync(directory);
        if (!contained(webRoot, actual)) throw Error("realpath escapes compiled web directory");
        if (ancestors.has(actual)) throw Error("compiled web directory cycle");
        const nextAncestors = new Set(ancestors).add(actual);
        for (const entry of readdirSync(directory)) {
          const path = prefix ? `${prefix}/${entry}` : entry;
          if (!safeRelative(path)) { errors.push(`unsafe compiled web path: ${path}`); continue; }
          const location = join(directory, entry);
          const target = realpathSync(location);
          if (!contained(webRoot, target)) { errors.push(`compiled web path ${path}: realpath escapes compiled web directory`); continue; }
          const info = statSync(location);
          if (info.isDirectory()) walk(location, path, nextAncestors);
          else if (!info.isFile()) errors.push(`compiled web path is not a regular file: ${path}`);
          else if (!declared.has(path)) errors.push(`undeclared compiled web file: ${path}`);
        }
      } catch (error) { errors.push(`cannot enumerate compiled web directory ${prefix}: ${error.message}`); }
    };
    walk(webRoot);
  }

  let members;
  if (apkBytes) {
    try {
      const seen = new Set();
      members = unzipSync(apkBytes, {
        filter(entry) {
          const name = entry.name;
          if (!safeRelative(name.endsWith("/") ? name.slice(0, -1) : name)) { errors.push(`unsafe APK entry: ${name}`); return false; }
          if (seen.has(name)) { errors.push(`duplicate APK entry: ${name}`); return false; }
          seen.add(name);
          return name.startsWith("assets/public/") && !name.endsWith("/");
        },
      });
    } catch (error) { errors.push(`cannot read APK ZIP: ${error.message}`); }
  }
  if (members) {
    for (const name of Object.keys(members)) {
      const path = name.slice("assets/public/".length);
      if (!declared.has(path)) errors.push(`undeclared APK public file: ${path}`);
    }
  }
  for (const [path, file] of declared) {
    const before = errors.length;
    const compiled = webRoot ? readContained(webRoot, path, "compiled web") : null;
    if (compiled && !matchesDigest(file.sha256, sha256(compiled))) errors.push(`compiled web SHA256 mismatch: ${path}`);
    const packaged = members?.[`assets/public/${path}`];
    if (members && !packaged) errors.push(`missing APK public file: ${path}`);
    if (packaged && (!matchesDigest(file.sha256, sha256(packaged)) || (compiled && !Buffer.from(packaged).equals(compiled)))) errors.push(`APK public bytes mismatch: ${path}`);
    if (compiled && packaged && errors.length === before) report.webFilesVerified += 1;
  }

  if (!bundleOnly) {
    if (!acceptancePath) errors.push("acceptance results are required; use --bundle-only only for artifact identity");
    else {
      const acceptance = readJson(resolve(acceptancePath), "acceptance results");
      if (acceptance) {
        report.acceptanceRecordsChecked = true;
        let evidenceRoot;
        try { evidenceRoot = realpathSync(dirname(resolve(acceptancePath))); }
        catch (error) { errors.push(`cannot resolve acceptance directory: ${error.message}`); }
        const binding = (value, label) => {
          if (!matchesDigest(value, report.candidateSha256)) errors.push(`${label} candidateSha256 mismatch`);
        };
        const evidence = (entries, label) => {
          if (!Array.isArray(entries) || !entries.length) { errors.push(`${label} requires nonempty evidence`); return; }
          for (const [index, entry] of entries.entries()) {
            const context = `${label} evidence[${index}]`;
            if (!object(entry)) { errors.push(`${context} must be an evidence object`); continue; }
            binding(entry.candidateSha256, context);
            if (!digest(entry.sha256)) errors.push(`${context} invalid SHA256`);
            if (!safeRelative(entry.path)) { errors.push(`${context} unsafe evidence path`); continue; }
            const bytes = evidenceRoot ? readContained(evidenceRoot, entry.path, context) : null;
            if (bytes && !matchesDigest(entry.sha256, sha256(bytes))) errors.push(`${context} SHA256 mismatch: ${entry.path}`);
          }
        };
        if (acceptance.schema !== "keepany.mobile-acceptance.v1") errors.push("invalid acceptance schema: expected keepany.mobile-acceptance.v1");
        binding(acceptance.candidateSha256, "acceptance");
        for (const name of dimensions) {
          const value = acceptance.dimensions?.[name];
          if (!object(value)) { errors.push(`missing dimension ${name}`); continue; }
          const before = errors.length;
          if (value.status !== "PASS") errors.push(`dimension ${name} must have status PASS`);
          binding(value.candidateSha256, `dimension ${name}`);
          evidence(value.evidence, `dimension ${name}`);
          if (errors.length === before) report.dimensionsVerified += 1;
        }
        const seen = new Set();
        if (!Array.isArray(acceptance.cases)) errors.push("acceptance cases must be an array");
        for (const item of (Array.isArray(acceptance.cases) ? acceptance.cases : [])) {
          if (!object(item) || !caseIds.includes(item.id)) { errors.push(`unexpected case ${item?.id ?? "(missing id)"}`); continue; }
          if (seen.has(item.id)) { errors.push(`duplicate case ${item.id}`); continue; }
          seen.add(item.id);
          const before = errors.length;
          const label = `case ${item.id}`;
          if (!["pass", "not-applicable"].includes(item.result)) errors.push(`${label} result must be pass or not-applicable`);
          if (item.result === "not-applicable" && (typeof item.reason !== "string" || !item.reason.trim())) errors.push(`${label} not-applicable requires a reason`);
          binding(item.candidateSha256, label);
          evidence(item.evidence, label);
          if (errors.length === before) report.casesVerified += 1;
        }
        for (const id of caseIds) if (!seen.has(id)) errors.push(`missing case ${id}`);
      }
    }
  }
  report.status = errors.length ? "FAIL" : "PASS";
  return report;
}
