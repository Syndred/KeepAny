import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'pg';

export async function migrateSyncDatabase(pool: Pool, migrationsDir = resolve(process.cwd(), 'apps/sync-server/migrations')): Promise<void> {
  const id = '001_sync';
  const sql = await readFile(resolve(migrationsDir, `${id}.sql`), 'utf8');
  const digest = createHash('sha256').update(sql).digest('hex');
  const client = await pool.connect();
  let begun = false;
  try {
    await client.query('BEGIN');
    begun = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('keepany-sync-migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS sync_schema_migrations (
      id text PRIMARY KEY, sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const existing = await client.query<{ sha256: string }>('SELECT sha256 FROM sync_schema_migrations WHERE id=$1', [id]);
    if (existing.rows[0]) {
      if (existing.rows[0].sha256 !== digest) throw Error('migration-checksum');
    } else {
      await client.query(sql);
      await client.query('INSERT INTO sync_schema_migrations (id,sha256) VALUES ($1,$2)', [id, digest]);
    }
    await client.query('COMMIT');
  } catch (error) {
    if (begun) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
