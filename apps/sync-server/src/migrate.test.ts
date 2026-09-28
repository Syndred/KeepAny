import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { expect, it } from 'vitest';
import { migrateSyncDatabase } from './migrate';

it('applies the migration once and records its checksum', async () => {
  const pg = new PGlite();
  const pool = { connect: async () => ({
    query: async (text: string, values?: unknown[]) => {
      if (text.includes('CREATE TABLE IF NOT EXISTS sync_workspaces')) {
        await pg.exec(text);
        return { rows: [] };
      }
      return pg.query(text, values);
    },
    release: () => {},
  }) } as unknown as Pool;
  try {
    const directory = resolve(process.cwd(), 'apps/sync-server/migrations');
    await migrateSyncDatabase(pool, directory);
    await migrateSyncDatabase(pool, directory);
    const migration = await pg.query<{ id: string; sha256: string }>('SELECT id,sha256 FROM sync_schema_migrations');
    expect(migration.rows).toHaveLength(1);
    expect(migration.rows[0].id).toBe('001_sync');
    expect(migration.rows[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  } finally { await pg.close(); }
}, 20_000);
