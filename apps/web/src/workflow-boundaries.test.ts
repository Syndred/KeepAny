import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
// Use the emitted runtime graph: include re-exports and package imports, while
// keeping erased types and explicitly lazy imports outside the static closure.
async function staticClosure(file: string, contents?: string) {
  const { metafile } = await build({
    absWorkingDir: root,
    ...(contents === undefined ? { entryPoints: [file] } : {
      stdin: { contents, resolveDir: root, sourcefile: file, loader: "ts" },
    }),
    bundle: true,
    write: false,
    metafile: true,
    packages: "external",
    format: "esm",
    splitting: true,
    outdir: "unused-boundary-output",
    loader: { ".css": "empty" },
    logLevel: "silent",
  });
  const seen = new Set<string>();
  function visit(path: string) {
    if (seen.has(path)) return;
    seen.add(path);
    for (const dependency of metafile.inputs[path]?.imports ?? []) {
      if (dependency.kind === "dynamic-import") continue;
      visit(dependency.path);
    }
  }
  visit(file);
  return seen;
}

describe("ordinary editing keeps advanced workflow dependencies out of its static graph", () => {
  it.each(["workflow-asset-editor.tsx", "workflow-task-editor.tsx"])("%s stays independent", async entry => {
    const graph = [...await staticClosure(entry)].join("\n");
    for (const advanced of ["workflow-intake-tools", "AiWorkspaceDialog", "workflow-ai-dialog", "intake-url", "intake-csv", "intake-pdf", "papaparse", "pdfjs-dist", "RemoteBackupPanel", "RestoreRecoveryPanel"]) expect(graph).not.toContain(advanced);
  });

  it("detects static re-exports and direct parser packages", async () => {
    const graph = await staticClosure("boundary-fixture.ts", 'export { stageCsvForReview } from "./intake-csv"; import "pdfjs-dist";');
    expect([...graph].join("\n")).toContain("intake-csv.ts");
    expect(graph.has("papaparse")).toBe(true);
    expect(graph.has("pdfjs-dist")).toBe(true);
  });

  it("allows erased parser types and an explicitly lazy CSV branch", async () => {
    const graph = [...await staticClosure("boundary-fixture.ts", 'import type { ParseResult } from "papaparse"; export const load = () => import("./intake-csv");')].join("\n");
    expect(graph).not.toContain("papaparse");
    expect(graph).not.toContain("intake-csv");
  });
});
