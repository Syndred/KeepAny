import { pathToFileURL } from 'node:url';
import { McpAuthority } from '../../../packages/mcp/src/authority';
import { FileAuthorityStorage } from '../../../packages/mcp/src/file-storage';
import { startLocalMcpBridge } from '../../../packages/mcp/src/bridge';
import { serveKeepAnyMcpStdio } from '../../../packages/mcp/src/server';
import { defaultAuthorityPath, defaultPairingPath, prepareDefaultDirectory, writePairingFile } from './pairing-file';
import { LauncherError, readLaunchRequest } from './request';

const pairingLifetimeMs = 2 * 60_000;

export interface LaunchOptions {
  requestPath: string;
  pairingPath?: string;
}

export interface RunningLauncher {
  pairingPath: string;
  close(): Promise<void>;
  removePairingFileSync(): void;
}

/** The request is a scope proposal, never a bearer credential or a command to execute. */
export async function launchMcp(options: LaunchOptions): Promise<RunningLauncher> {
  const request = await readLaunchRequest(options.requestPath);
  await prepareDefaultDirectory();
  const pairingPath = options.pairingPath ?? defaultPairingPath();
  const authority = new McpAuthority(new FileAuthorityStorage(defaultAuthorityPath()));
  const grant = await authority.issueGrant({ assetIds: request.assetIds, readFields: request.readFields,
    writeFields: request.writeFields, ttlMs: request.ttlMs });
  let bridge: Awaited<ReturnType<typeof startLocalMcpBridge>> | undefined;
  let pairingFile: Awaited<ReturnType<typeof writePairingFile>> | undefined;
  let stdio: Awaited<ReturnType<typeof serveKeepAnyMcpStdio>> | undefined;
  let pairingTimer: ReturnType<typeof setTimeout> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    if (pairingTimer) clearTimeout(pairingTimer);
    closing = (async () => {
      await Promise.allSettled([stdio?.close(), bridge?.close(), pairingFile?.remove()]);
      await authority.revokeGrant(grant.id);
    })();
    return closing;
  };
  try {
    bridge = await startLocalMcpBridge({ appOrigin: request.appOrigin, authority,
      grantId: grant.id, grantSecret: grant.secret });
    const expiresAt = Date.now() + pairingLifetimeMs;
    pairingFile = await writePairingFile(pairingPath, {
      kind: 'keepany-mcp-pairing-v1', url: bridge.url, pairingSecret: bridge.pairingSecret,
      requestNonce: request.requestNonce, appOrigin: request.appOrigin, expiresAt,
    });
    // Only the official MCP SDK writes to stdout. stderr reveals the file path, never the secret.
    process.stderr.write(`KeepAny MCP pairing file: ${pairingPath}\n`);
    stdio = await serveKeepAnyMcpStdio({ store: bridge.store, authority,
      grantId: grant.id, grantSecret: grant.secret,
      onPreview: preview => bridge?.publishPreview(preview) });
    pairingTimer = setTimeout(() => { void close().catch(() => { process.exitCode = 1; }); }, Math.max(1, expiresAt - Date.now()));
    void bridge.paired.then(async () => {
      if (pairingTimer) clearTimeout(pairingTimer);
      await pairingFile?.remove();
    }).catch(() => { void close().catch(() => { process.exitCode = 1; }); });
    return { pairingPath, close, removePairingFileSync: () => pairingFile?.removeSync() };
  } catch (error) {
    // A closed unpaired bridge rejects its paired promise; consume that rejection.
    void bridge?.paired.catch(() => undefined);
    await close();
    throw error;
  }
}

function parseArgs(argv: string[]): LaunchOptions {
  let requestPath = '';
  let pairingPath: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const option = argv[i];
    const value = argv[i + 1];
    if (!value || (option !== '--request' && option !== '--pairing-file')) throw new LauncherError('invalid-arguments');
    if (option === '--request' && !requestPath) requestPath = value;
    else if (option === '--pairing-file' && pairingPath === undefined) pairingPath = value;
    else throw new LauncherError('invalid-arguments');
  }
  if (!requestPath) throw new LauncherError('request-required');
  return { requestPath, pairingPath };
}

async function main() {
  let opening: Promise<RunningLauncher> | undefined;
  let active: RunningLauncher | undefined;
  let shuttingDown = false;
  const shutdown = (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    void opening?.then(running => running.close()).catch(() => { process.exitCode = 1; })
      .finally(() => { if (process.exitCode !== 1) process.exitCode = exitCode; });
  };
  process.stdin.once('end', () => shutdown());
  process.stdin.once('close', () => shutdown());
  process.once('SIGINT', () => shutdown(130));
  process.once('SIGTERM', () => shutdown(143));
  try {
    opening = launchMcp(parseArgs(process.argv.slice(2)));
    active = await opening;
  } catch (error) {
    process.stderr.write(`KeepAny MCP launcher: ${error instanceof LauncherError ? error.code : 'startup-failed'}\n`);
    process.exitCode = 1;
    return;
  }
  const launcher = active;
  process.once('exit', () => { try { launcher.removePairingFileSync(); } catch { /* OS closes the loopback socket. */ } });
  if (process.stdin.readableEnded) shutdown();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
