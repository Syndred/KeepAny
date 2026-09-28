import { serve } from '@hono/node-server';
import pg from 'pg';
import { AttachmentService } from '../../../packages/sync-core/src/attachments';
import { PostgresSyncService } from '../../../packages/sync-core/src/postgres';
import { createPostgresSyncApp } from './app';
import { createConfiguredAuthenticator } from './auth';
import { migrateSyncDatabase } from './migrate';
import { createS3CiphertextObjectStore } from './s3-objects';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw Error('DATABASE_URL-required');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
pool.on('error', () => { console.error('KeepAny sync database idle connection failed'); });

if (process.argv[2] === 'migrate') {
  try { await migrateSyncDatabase(pool, process.env.KEEPANY_MIGRATIONS_DIR); }
  finally { await pool.end(); }
} else {
  const authenticate = createConfiguredAuthenticator(process.env);
  const service = new PostgresSyncService(pool);
  const objects = createS3CiphertextObjectStore(process.env);
  const attachments = objects ? new AttachmentService(pool, objects) : undefined;
  const app = createPostgresSyncApp(service, authenticate, attachments);
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
