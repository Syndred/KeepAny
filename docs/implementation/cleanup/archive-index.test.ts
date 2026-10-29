import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
type ArchiveIndex = {
  schema: string; sourceCommit: string; gitHistoryRewritten: boolean; phase: string;
  files: Array<[string, number, string, string]>;
  summary: { archivedFiles: number; archivedBytes: number };
  retainedBinaryReasons: Record<string, string>;
};
const index: ArchiveIndex = JSON.parse(readFileSync(resolve(root, "docs/implementation/cleanup/2026-10-29-历史证据归档索引.json"), "utf8"));
const archived = new Set(index.files.map(row => row[0]));
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).split("\0").filter(Boolean);

describe("historical evidence archive references", () => {
  it("keeps one immutable source identity and safe, unique path/digest records", () => {
    expect(index.schema).toBe("keepany.historical-evidence-index.v1");
    expect(index.sourceCommit).toBe("b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5");
    expect(index.gitHistoryRewritten).toBe(false);
    expect(index.phase).toBe("archived-current-tree");
    expect(archived.size).toBe(index.files.length);
    expect(index.summary.archivedFiles).toBe(index.files.length);
    let bytes = 0;
    for (const [path, size, sha256, blob] of index.files) {
      expect(path).toMatch(/^docs\/(?:evidence|qa)\//);
      expect(path.split("/")).not.toContain("..");
      expect(path).not.toContain("\\");
      expect(Number.isSafeInteger(size) && size > 0).toBe(true);
      expect(sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(blob).toMatch(/^[a-f0-9]{40}$/);
      bytes += size;
    }
    expect(index.summary.archivedBytes).toBe(bytes);
  });

  it("excludes archived binaries from the current Git tree and retains declared active inputs", () => {
    for (const path of tracked) expect(archived.has(path), path).toBe(false);
    for (const path of Object.keys(index.retainedBinaryReasons)) expect(existsSync(resolve(root, path)), path).toBe(true);
  });

  it("does not leave current Markdown relative links pointing to archived binaries", () => {
    for (const name of tracked.filter(path => path.endsWith(".md"))) {
      const document = resolve(root, name);
      for (const match of readFileSync(document, "utf8").matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/g)) {
        const href = match[1].replace(/^<|>$/g, "");
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) continue;
        const path = relative(root, resolve(dirname(document), decodeURIComponent(href.split(/[?#]/)[0]))).replaceAll("\\", "/");
        expect(archived.has(path), `${name}: ${href}`).toBe(false);
      }
    }
  });
});
