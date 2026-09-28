import { serve } from '@hono/node-server';
import pg from 'pg';
import { PostgresSyncService } from '../../../packages/sync-core/src/postgres';
import { createPostgresSyncApp } from './app';
import { createStaticTokenAuthenticator } from './auth';
import { migrateSyncDatabase } from './migrate';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw Error('DATABASE_URL-required');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
pool.on('error', () => { console.error('KeepAny sync database idle connection failed'); });

if (process.argv[2] === 'migrate') {
  try { await migrateSyncDatabase(pool, process.env.KEEPANY_MIGRATIONS_DIR); }
  finally { await pool.end(); }
} else {
  const token = process.env.KEEPANY_SYNC_TOKEN;
  if (!token) throw Error('KEEPANY_SYNC_TOKEN-required');
  const authenticate = createStaticTokenAuthenticator(token);
  const service = new PostgresSyncService(pool);
  const app = createPostgresSyncApp(service, authenticate);
  const port = Number(process.env.PORT ?? '8787');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT-invalid');
  const hostname = process.env.HOST ?? '127.0.0.1';
  const server = serve({ fetch: app.fetch, port, hostname });
  console.info(`KeepAny sync listening on ${hostname}:${port}`);
  const shutdown = () => {
    server.close(async () => { await pool.end(); process.exit(0); });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
