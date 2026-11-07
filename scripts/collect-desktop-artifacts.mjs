import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const target = process.argv[2];
const windows = target === "x86_64-pc-windows-msvc";
if (!windows && !["aarch64-apple-darwin", "x86_64-apple-darwin"].includes(target)) {
  throw Error("Expected a supported KeepAny desktop target");
}
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
if (dirty) throw Error("Stage desktop artifacts from a clean source checkout");

const tauri = resolve("apps/desktop/src-tauri");
const { mainBinaryName, productName, version } = JSON.parse(readFileSync(resolve(tauri, "tauri.conf.json"), "utf8"));
const build = resolve(process.env.CARGO_TARGET_DIR || resolve(tauri, "target"), target, "release");
const bundle = resolve(build, "bundle", windows ? "nsis" : "dmg");
const extension = windows ? "-setup.exe" : ".dmg";
const installers = readdirSync(bundle).filter(name => name.startsWith(`${productName}_${version}_`) && name.endsWith(extension));
if (installers.length !== 1) throw Error(`Expected one ${extension} installer for ${target}`);

const installer = resolve(bundle, installers[0]);
const sources = [installer];
if (windows) {
  const executable = resolve(build, `${mainBinaryName}.exe`);
  for (const path of [installer, executable]) {
    if (readFileSync(path).subarray(0, 2).toString() !== "MZ") throw Error(`Invalid Windows executable ${path}`);
  }
  sources.push(executable);
} else {
  execFileSync("hdiutil", ["verify", installer], { stdio: "inherit" });
  const mount = mkdtempSync(join(tmpdir(), "keepany-dmg-"));
  let mounted = false;
  try {
    execFileSync("hdiutil", ["attach", installer, "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount], { stdio: ["ignore", "inherit", "inherit"], timeout: 120_000 });
    mounted = true;
    const app = resolve(mount, `${productName}.app`);
    execFileSync("lipo", ["-verify_arch", target.startsWith("aarch64") ? "arm64" : "x86_64", resolve(app, "Contents/MacOS", mainBinaryName)]);
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  } finally {
    if (mounted) execFileSync("hdiutil", ["detach", mount], { stdio: "inherit" });
    rmdirSync(mount);
  }
}

const output = resolve("dist/desktop", target);
mkdirSync(output, { recursive: true });
const files = sources.map(source => {
  const name = basename(source) === `${mainBinaryName}.exe` ? `${productName}_${version}_x64.exe` : basename(source);
  const path = resolve(output, name);
  copyFileSync(source, path);
  return { name, bytes: statSync(path).size, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
});
writeFileSync(resolve(output, "SHA256SUMS.txt"), files.map(file => `${file.sha256}  ${file.name}\n`).join(""));
writeFileSync(resolve(output, "build.json"), JSON.stringify({ commit, version, target, files }, null, 2) + "\n");
