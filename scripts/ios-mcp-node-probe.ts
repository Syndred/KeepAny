// Invoked only by the Swift transport integration test. The input contains
// freshly generated public session certificates, never private keys or tickets.
import { readFileSync } from 'node:fs';
import { connect as connectTls } from 'node:tls';
import { createMobileTlsFetch, MobileTlsFetchError, type MobileTlsFetchOptions } from '../apps/mcp-launcher/src/mobile-tls-fetch';

type Input = { trusted: MobileTlsFetchOptions; unrelatedCertificatePem: string; wrongIp: MobileTlsFetchOptions };
const deadline = setTimeout(() => { process.stderr.write('node-probe-deadline\n'); process.exit(72); }, 15_000);
try {
  const bytes = readFileSync(0);
  if (bytes.length > 24_000) throw Error('probe-input-limit');
  const input = JSON.parse(bytes.toString('utf8')) as Input;
  const results: Record<string, string> = {};
  const good = createMobileTlsFetch(input.trusted);
  try {
    const response = await good.fetch(input.trusted.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (response.status !== 200 || await response.text() !== '{"ok":true}') throw Error('probe-response');
    results.trusted = 'response-verified';
  } finally { good.close(); }
  // Check the actual SAN error independently before the production adapter
  // deliberately reduces transport errors to its public fixed error code.
  const wrongAddress = new URL(input.wrongIp.endpoint);
  await new Promise<void>((resolve, reject) => {
    const socket = connectTls({ host: wrongAddress.hostname, port: Number(wrongAddress.port),
      ca: input.wrongIp.certificatePem, rejectUnauthorized: true });
    socket.once('secureConnect', () => { socket.destroy(); reject(Error('probe-wrong-ip-accepted')); });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code !== 'ERR_TLS_CERT_ALTNAME_INVALID') { reject(Error('probe-wrong-ip-cause')); return; }
      results.wrongIpSan = error.code;
      resolve();
    });
  });
  const cases: [string, MobileTlsFetchOptions][] = [
    ['untrusted', { ...input.trusted, certificatePem: input.unrelatedCertificatePem }],
    ['wrongPin', { ...input.trusted, spkiSha256: '0'.repeat(64) }],
    ['wrongIp', input.wrongIp],
  ];
  for (const [name, options] of cases) {
    const client = createMobileTlsFetch(options);
    try {
      await client.fetch(options.endpoint, { method: 'POST', body: '{}' });
      throw Error('probe-negative-accepted');
    } catch (error) {
      if (!(error instanceof MobileTlsFetchError) || error.code !== 'mobile-mcp-network') throw error;
      results[name] = error.code;
    } finally { client.close(); }
  }
  process.stdout.write(JSON.stringify(results));
} catch {
  // Preserve a fixed failure code without certificates, URLs or nested errors.
  process.stderr.write('node-probe-failed\n');
  process.exitCode = 1;
} finally { clearTimeout(deadline); }
