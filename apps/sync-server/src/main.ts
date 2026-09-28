import { serve } from '@hono/node-server';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { AttachmentService } from '../../../packages/sync-core/src/attachments';
import { PostgresSyncService } from '../../../packages/sync-core/src/postgres';
import { createPostgresSyncApp } from './app';
import { createConfiguredAuthenticator } from './auth';
import { createPostgresBoundStateStore } from './bound-state';
import { createBoundStateFeed } from './bound-state-feed';
import { createPostgresBoundStateWriter } from './bound-state-writer-db';
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
  let boundFeed: ReturnType<typeof createBoundStateFeed> | undefined;
  try {
    const boundStateStore = process.env.KEEPANY_SYNC_AUTH_MODE === 'bound' ? createPostgresBoundStateStore(pool) : undefined;
    if (boundStateStore) {
      const env = process.env;
      if (env.KEEPANY_SYNC_WEB_ORIGIN) throw Error('KEEPANY_SYNC_WEB_ORIGIN-not-allowed-in-bound-mode');
      if (!env.KEEPANY_BOUND_STATE_READER_PRIVATE_KEY_FILE || !env.KEEPANY_BOUND_STATE_READER_ISSUER ||
        !env.KEEPANY_BOUND_STATE_READER_KID || !env.KEEPANY_BOUND_STATE_COMMERCIAL_ORIGIN ||
        !env.KEEPANY_BOUND_ISSUER || !env.KEEPANY_BOUND_JWKS_JSON) throw Error('bound-state-feed-configuration-required');
      boundFeed = createBoundStateFeed({
        readerIssuer: env.KEEPANY_BOUND_STATE_READER_ISSUER,
        readerPrivatePem: await readFile(env.KEEPANY_BOUND_STATE_READER_PRIVATE_KEY_FILE, 'utf8'),
        readerKid: env.KEEPANY_BOUND_STATE_READER_KID,
        commercialOrigin: env.KEEPANY_BOUND_STATE_COMMERCIAL_ORIGIN,
        commercialIssuer: env.KEEPANY_BOUND_ISSUER,
        commercialJwks: JSON.parse(env.KEEPANY_BOUND_JWKS_JSON),
        store: createPostgresBoundStateWriter(pool),
      });
    }
    const authenticate = createConfiguredAuthenticator(process.env, boundStateStore, boundFeed?.bootstrapIfMissing);
    const service = new PostgresSyncService(pool);
    const objects = createS3CiphertextObjectStore(process.env);
    const attachments = objects ? new AttachmentService(pool, objects) : undefined;
    const app = createPostgresSyncApp(service, authenticate, attachments,
      process.env.KEEPANY_SYNC_AUTH_MODE === 'self-host' ? { webOrigin: process.env.KEEPANY_SYNC_WEB_ORIGIN } : undefined);
    const port = Number(process.env.PORT ?? '8787');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT-invalid');
    const hostname = process.env.HOST ?? '127.0.0.1';
    await boundFeed?.start();
    const server = serve({ fetch: app.fetch, port, hostname });
    console.info(`KeepAny sync listening on ${hostname}:${port}`);
    const proofCleanup = boundStateStore && setInterval(() => {
      void boundStateStore.pruneExpiredProofs().catch(() => console.error('KeepAny sync proof cleanup failed'));
    }, 60 * 60 * 1000);
    proofCleanup?.unref();
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      if (proofCleanup) clearInterval(proofCleanup);
      const feedStopped = boundFeed?.close();
      server.close(async () => {
        await feedStopped;
        await pool.end();
        process.exit(0);
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    await boundFeed?.close();
    await pool.end();
    throw error;
  }
}
