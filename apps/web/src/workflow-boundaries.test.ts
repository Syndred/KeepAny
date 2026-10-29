import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
function staticClosure(file: string, seen = new Set<string>()) {
  const path = resolve(root, file);
  if (seen.has(path)) return seen;
  seen.add(path);
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/^import(?:[\s\S]*?from\s*)?["'](\.[^"']+)["'];/gm)) {
    const target = resolve(dirname(path), match[1]);
    if (!target.startsWith(root) || /\.css$/.test(target)) continue;
    for (const suffix of [".ts", ".tsx", "/index.ts"]) {
      try { readFileSync(target + suffix); staticClosure((target + suffix).slice(root.length + 1), seen); break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
  return seen;
}
describe("ordinary editing keeps advanced workflow dependencies out of its static graph", () => {
  it.each(["workflow-asset-editor.tsx", "workflow-task-editor.tsx"])("%s stays independent", entry => {
    const graph = [...staticClosure(entry)].join("\n");
    for (const advanced of ["workflow-intake-tools", "AiWorkspaceDialog", "workflow-ai-dialog", "intake-url", "RemoteBackupPanel", "RestoreRecoveryPanel"]) expect(graph).not.toContain(advanced);
  });
});
