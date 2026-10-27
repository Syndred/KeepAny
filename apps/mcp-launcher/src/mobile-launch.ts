import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Client, StreamableHTTPClientTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { readMobileMcpPairingFile, mobileMcpComparisonCode, mobileMcpPairingReplySchema } from '../../../packages/mcp/src/mobile-pairing';
import { keepAnyMcpToolContracts } from '../../../packages/mcp/src/server';
import { readMobileSecretFile } from './mobile-private-file';
import { createMobileTlsFetch, type MobileTlsFetch } from './mobile-tls-fetch';
import { parseMobileMcpConnectionFile, readMobileMcpConnectionFile, writeMobileMcpConnectionFile, type MobileMcpConnectionFile } from './mobile-connection';

export class MobileLaunchError extends Error {
  constructor(readonly code = 'mobile-mcp-unavailable') { super(code); this.name = 'MobileLaunchError'; }
}
export interface MobileLaunchOptions {
  pairingPath?: string; connectionPath?: string; stateDir?: string; signal?: AbortSignal;
  /** Trusted process diagnostic sink; only a public comparison code or private profile path. */
  diagnostic?: (line: string) => void;
}
export interface RunningMobileLauncher { profilePath: string; close(): Promise<void> }
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new MobileLaunchError('mobile-mcp-aborted')); return; }
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { done(); reject(new MobileLaunchError('mobile-mcp-aborted')); };
    const timer = setTimeout(() => { done(); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Negotiates with the trusted phone controller; never issues a desktop grant. */
export async function pairMobileMcp(path: string, signal: AbortSignal, diagnostic: (line: string) => void): Promise<{ connection: MobileMcpConnectionFile; tls: MobileTlsFetch }> {
  let tls: MobileTlsFetch | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = new AbortController(), abort = () => stop.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) stop.abort();
  try {
    const file = readMobileMcpPairingFile(JSON.parse((await readMobileSecretFile(path)).text));
    tls = createMobileTlsFetch(file);
    const clientNonce = randomUUID(), code = mobileMcpComparisonCode(file, clientNonce);
    const body = JSON.stringify({ kind: 'keepany-mcp-mobile-join-v1', requestNonce: file.requestNonce,
      pairingSecret: file.pairingSecret, clientNonce, clientName: 'KeepAny MCP desktop' });
    timer = setTimeout(() => stop.abort(), Math.max(1, file.expiresAt - Date.now()));
    let printed = false;
    while (true) {
      if (Date.now() >= file.expiresAt) throw new MobileLaunchError('mobile-mcp-pairing-expired');
      const response = await tls.fetch(new URL('/pair', file.endpoint), { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: stop.signal });
      if (![200, 202].includes(response.status)) throw new MobileLaunchError('mobile-mcp-pairing-denied');
      const reply = mobileMcpPairingReplySchema.parse(await response.json());
      if (reply.comparisonCode !== code) throw new MobileLaunchError('mobile-mcp-pairing-invalid');
      if (reply.state === 'pending') {
        if (response.status !== 202) throw new MobileLaunchError('mobile-mcp-pairing-invalid');
        if (!printed) { diagnostic(`KeepAny MCP comparison code: ${code}`); printed = true; }
        await wait(Math.min(800, Math.max(1, file.expiresAt - Date.now())), stop.signal); continue;
      }
      if (response.status !== 200 || JSON.stringify(reply.scope) !== JSON.stringify(file.scope)) throw new MobileLaunchError('mobile-mcp-pairing-invalid');
      const connection = parseMobileMcpConnectionFile({ kind: 'keepany-mcp-mobile-connection-v1',
        endpoint: file.endpoint, certificatePem: file.certificatePem, spkiSha256: file.spkiSha256, instanceId: file.instanceId,
        grantId: reply.grantId, grantSecret: reply.grantSecret, expiresAt: reply.expiresAt, scope: reply.scope });
      if (stop.signal.aborted) throw new MobileLaunchError('mobile-mcp-aborted');
      return { connection, tls };
    }
  } catch (error) {
    tls?.close();
    if (signal.aborted) throw new MobileLaunchError('mobile-mcp-aborted');
    if (stop.signal.aborted) throw new MobileLaunchError('mobile-mcp-pairing-expired');
    throw error instanceof MobileLaunchError ? error : new MobileLaunchError('mobile-mcp-pairing-invalid');
  } finally { if (timer) clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

export async function launchMobileMcp(options: MobileLaunchOptions): Promise<RunningMobileLauncher> {
  if (Boolean(options.pairingPath) === Boolean(options.connectionPath) || options.connectionPath && options.stateDir)
    throw new MobileLaunchError('invalid-arguments');
  const diagnostic = options.diagnostic ?? (line => { process.stderr.write(`${line}\n`); });
  const controller = new AbortController(), signal = controller.signal;
  let tls: MobileTlsFetch | undefined, remote: Client | undefined;
  let stdio: ReturnType<typeof serveStdio> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    controller.abort(); tls?.close();
    closing = Promise.allSettled([stdio?.close(), remote?.close()]).then(() => undefined);
    return closing;
  };
  const abort = () => { void close(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (options.signal?.aborted) throw new MobileLaunchError('mobile-mcp-aborted');
    let connection: MobileMcpConnectionFile;
    if (options.pairingPath) { const paired = await pairMobileMcp(options.pairingPath, signal, diagnostic); connection = paired.connection; tls = paired.tls; }
    else { connection = await readMobileMcpConnectionFile(options.connectionPath ?? ''); tls = createMobileTlsFetch(connection); }
    if (signal.aborted) throw new MobileLaunchError('mobile-mcp-aborted');
    const expires = connection.expiresAt;
    timer = setTimeout(() => { void close(); }, Math.max(1, expires - Date.now()));
    remote = new Client({ name: 'keepany-mobile-desktop-proxy', version: '0.1.0' });
    // SDK diagnostics are deliberately not forwarded to MCP stdout or stderr.
    remote.onerror = () => {};
    const callContext = new AsyncLocalStorage<AbortSignal>(), transport = tls;
    const scopedFetch: typeof fetch = (input, init) => {
      const signals = [signal], requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined), scoped = callContext.getStore();
      if (requestSignal) signals.push(requestSignal);
      if (scoped) signals.push(scoped);
      return transport.fetch(input, { ...init, signal: AbortSignal.any(signals) });
    };
    await remote.connect(new StreamableHTTPClientTransport(new URL(connection.endpoint), { fetch: scopedFetch,
      requestInit: { headers: { authorization: `Bearer ${connection.grantId}.${connection.grantSecret}` } } }));
    const allowed = Object.keys(keepAnyMcpToolContracts).sort();
    const tools = await remote.listTools({}, { signal });
    if (tools.nextCursor !== undefined || tools.tools.length !== allowed.length || tools.tools.map(t => t.name).sort().some((name, index) => name !== allowed[index]))
      throw new MobileLaunchError('mobile-mcp-tools-invalid');
    if (signal.aborted || Date.now() >= expires) throw new MobileLaunchError('mobile-mcp-aborted');
    const profilePath = options.pairingPath ? await writeMobileMcpConnectionFile(connection, options.stateDir) : options.connectionPath ?? '';
    if (signal.aborted) throw new MobileLaunchError('mobile-mcp-aborted');
    if (options.pairingPath) {
      diagnostic(`KeepAny MCP private connection profile: ${profilePath}`);
      diagnostic('Use --mobile-connection with that private profile to reconnect during this phone session.');
    }
    const client = remote;
    const call = async (name: keyof typeof keepAnyMcpToolContracts, args: Record<string, unknown>, callSignal: AbortSignal): Promise<CallToolResult> => {
      if (signal.aborted || Date.now() >= expires) return { content: [{ type: 'text', text: 'mobile-mcp-unavailable' }], isError: true };
      try { return await callContext.run(callSignal, () => client.callTool({ name, arguments: args }, { signal: AbortSignal.any([signal, callSignal]), timeout: 30_000 })); }
      catch { return { content: [{ type: 'text', text: 'mobile-mcp-request-failed' }], isError: true }; }
    };
    stdio = serveStdio(() => {
      const server = new McpServer({ name: 'keepany-mobile-proxy', version: '0.1.0' });
      server.registerTool('list_assets', keepAnyMcpToolContracts.list_assets, (args, ctx) => call('list_assets', args, ctx.mcpReq.signal));
      server.registerTool('get_asset', keepAnyMcpToolContracts.get_asset, (args, ctx) => call('get_asset', args, ctx.mcpReq.signal));
      server.registerTool('preview_asset_update', keepAnyMcpToolContracts.preview_asset_update, (args, ctx) => call('preview_asset_update', args, ctx.mcpReq.signal));
      server.registerTool('confirm_asset_update', keepAnyMcpToolContracts.confirm_asset_update, (args, ctx) => call('confirm_asset_update', args, ctx.mcpReq.signal));
      return server;
    });
    return { profilePath, close };
  } catch (error) {
    if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', abort); await close();
    throw error instanceof MobileLaunchError ? error : new MobileLaunchError();
  }
}

