import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { expect, it } from "vitest";
import { migrateSyncDatabase } from "./migrate";

const directory = resolve(process.cwd(), "apps/sync-server/migrations");
function migrationPool(pg: PGlite): Pool {
	return {
		connect: async () => ({
			query: async (text: string, values?: unknown[]) => {
				if (
					text.includes("CREATE TABLE IF NOT EXISTS sync_workspaces") ||
					text.includes("ALTER TABLE sync_changes") ||
					text.includes("CREATE TABLE sync_bound_bindings") ||
					text.includes("CREATE FUNCTION sync_bound_binding_guard") ||
					text.includes("ADD CONSTRAINT sync_bound_binding_signed_lease") ||
					text.includes('create table "user"')
				) {
					await pg.exec(text);
					return { rows: [] };
				}
				return pg.query(text, values);
			},
			release: () => {},
		}),
	} as unknown as Pool;
}

it("applies the migration once and records its checksum", async () => {
	const pg = new PGlite();
	const pool = migrationPool(pg);
	try {
		await migrateSyncDatabase(pool, directory);
		await migrateSyncDatabase(pool, directory);
		const migration = await pg.query<{ id: string; sha256: string }>(
			"SELECT id,sha256 FROM sync_schema_migrations",
		);
		expect(migration.rows).toHaveLength(7);
		expect(migration.rows[0].id).toBe("001_sync");
		expect(migration.rows[0].sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(migration.rows[1].id).toBe("002_attachments");
		expect(migration.rows[2].id).toBe("003_change_operation_id");
		expect(migration.rows[3].id).toBe("004_bound_state");
		expect(migration.rows[4].id).toBe("005_bound_state_guard");
		expect(migration.rows[5].id).toBe("006_bound_state_writer_guard");
		expect(migration.rows[6].id).toBe("007_self_host_session");
		expect(
			(await pg.query("SELECT attachment_id FROM sync_attachments")).rows,
		).toHaveLength(0);
		expect(
			(await pg.query("SELECT operation_id FROM sync_changes")).rows,
		).toHaveLength(0);
		expect(
			(await pg.query("SELECT binding_id FROM sync_bound_bindings")).rows,
		).toHaveLength(0);
		expect(
			(await pg.query("SELECT proof_jti_hash FROM sync_bound_proofs")).rows,
		).toHaveLength(0);
		expect((await pg.query('SELECT id FROM "user"')).rows).toHaveLength(0);
	} finally {
		await pg.close();
	}
}, 20_000);

it("upgrades historical changes from accepted operation results without changing older checksums", async () => {
	const pg = new PGlite();
	try {
		const oldMigrations = await Promise.all(
			["001_sync", "002_attachments"].map(async (id) => ({
				id,
				sql: await readFile(resolve(directory, `${id}.sql`), "utf8"),
			})),
		);
		for (const migration of oldMigrations) await pg.exec(migration.sql);
		await pg.exec(
			"CREATE TABLE sync_schema_migrations (id text PRIMARY KEY, sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
		);
		for (const { id, sql } of oldMigrations) {
			await pg.query(
				"INSERT INTO sync_schema_migrations (id,sha256) VALUES ($1,$2)",
				[id, createHash("sha256").update(sql).digest("hex")],
			);
		}
		const workspaceId = crypto.randomUUID();
		const docId = `asset:${crypto.randomUUID()}`;
		const acceptedId = crypto.randomUUID();
		const rejectedId = crypto.randomUUID();
		await pg.query(
			"INSERT INTO sync_workspaces (workspace_id,next_sequence) VALUES ($1,1)",
			[workspaceId],
		);
		await pg.query(
			`INSERT INTO sync_changes
      (workspace_id,sequence,doc_id,kind,schema_version,ciphertext,tombstone,version)
      VALUES ($1,1,$2,'asset',1,'old-ciphertext',false,1)`,
			[workspaceId, docId],
		);
		for (const [operationId, status] of [
			[acceptedId, "accepted"],
			[rejectedId, "conflict"],
		]) {
			await pg.query(
				`INSERT INTO sync_operations (workspace_id,operation_id,fingerprint,result)
        VALUES ($1,$2,$3,$4::jsonb)`,
				[
					workspaceId,
					operationId,
					"0".repeat(64),
					JSON.stringify({ operationId, status, version: 1, sequence: 1 }),
				],
			);
		}
		await migrateSyncDatabase(migrationPool(pg), directory);
		const change = await pg.query<{ operation_id: string }>(
			"SELECT operation_id FROM sync_changes",
		);
		expect(change.rows[0].operation_id).toBe(acceptedId);
		const nullable = await pg.query<{
			is_nullable: string;
		}>(`SELECT is_nullable FROM information_schema.columns
      WHERE table_name='sync_changes' AND column_name='operation_id'`);
		expect(nullable.rows[0].is_nullable).toBe("NO");
		expect(
			(
				await pg.query<{ id: string }>(
					"SELECT id FROM sync_schema_migrations ORDER BY id",
				)
			).rows.map((row) => row.id),
		).toEqual([
			"001_sync",
			"002_attachments",
			"003_change_operation_id",
			"004_bound_state",
			"005_bound_state_guard",
			"006_bound_state_writer_guard",
			"007_self_host_session",
		]);
	} finally {
		await pg.close();
	}
}, 20_000);
