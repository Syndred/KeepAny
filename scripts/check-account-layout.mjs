import { spawnSync } from "node:child_process";
// Keep the public command and CI job identity; one current account contract owns the checks.
const [candidate, output = "test-results/account-layout-ci", ...extra] = process.argv.slice(2);
if (extra.length) throw Error("Usage: check-account-layout.mjs [portable-zip] [new-evidence-directory]");
const args = ["scripts/check-account-entry.mjs"];
if (candidate) args.push(candidate, output);
else {
 const selected = process.env.KEEPANY_PREVIEW_ARCHIVE;
 if (!selected || process.env.KEEPANY_PREVIEW_DIRECTORY) throw Error("Select exactly one clean portable ZIP.");
 args.push(selected, output);
}
const env = { ...process.env };
delete env.KEEPANY_PREVIEW_ARCHIVE;
delete env.KEEPANY_PREVIEW_DIRECTORY;
const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
