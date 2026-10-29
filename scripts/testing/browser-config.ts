import { resolve } from "node:path";
import { selectCandidate } from "../lib/portable-candidate.mjs";

export const browserDefaults = {
  testDir: "./tests/e2e",
  retries: 0,
  use: { actionTimeout: 15_000, screenshot: "only-on-failure" as const },
};

export function compiledServer(port: number, archiveOnly = false) {
  selectCandidate({ archiveOnly });
  return { env: { KEEPANY_RELEASE_TEST_PORT: String(port) }, command: "node scripts/serve-preview-for-tests.mjs", url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 30_000 };
}

export function sourceServer(port: number, reuseExistingServer = !process.env.CI) {
  return { command: `node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer, timeout: 30_000 };
}

export function reviewedSnapshots(scope: "accounts" | "fc24") {
  const root = process.env.KEEPANY_REVIEWED_BASELINES;
  return { updateSnapshots: "none" as const, snapshotPathTemplate: root ? `${resolve(root)}/{platform}/${scope}/{arg}{ext}` : undefined };
}
