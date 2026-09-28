import { serve } from '@hono/node-server';
import { createBindingBridgeApp } from './app';

const issuer = process.env.KEEPANY_BINDING_ISSUER;
const webOrigin = process.env.KEEPANY_BINDING_WEB_ORIGIN;
if (!issuer || !webOrigin) throw Error('binding-bridge-configuration-required');
const port = Number(process.env.KEEPANY_BINDING_BRIDGE_PORT ?? '0');
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw Error('binding-bridge-port');

let boundPort = port;
const app = createBindingBridgeApp({
  issuer, webOrigin,
  expectedHost: () => `127.0.0.1:${boundPort}`,
});
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port });
server.on('listening', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('binding-bridge-listener');
  boundPort = address.port;
  console.info(`KeepAny binding bridge listening on http://127.0.0.1:${boundPort}`);
});
const shutdown = () => server.close();
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
