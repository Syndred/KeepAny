import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { expect, it } from "vitest";
import { migrateSyncDatabase } from "./migrate";

const directory = resolve(process.cwd(), "apps/sync-server/migrations");

// Opt in only with an isolated PostgreSQL test database. Never touches public schema.
it.skipIf(!process.env.KEEPANY_TEST_DATABASE_URL)(
	"upgrades a historical accepted change through 003, 004 and 005 in real PostgreSQL",
	async () => {
		const connectionString = process.env.KEEPANY_TEST_DATABASE_URL;
		if (!connectionString) throw Error("test-database-url");
		const schema = `keepany_migration_${crypto.randomUUID().replaceAll("-", "")}`;
		const admin = new pg.Pool({
			connectionString,
			max: 1,
			connectionTimeoutMillis: 5000,
		});
		const pool = new pg.Pool({
			connectionString,
			options: `-c search_path=${schema}`,
			max: 2,
			connectionTimeoutMillis: 5000,
		});
		let created = false;
		try {
			await admin.query(`CREATE SCHEMA "${schema}"`);
			created = true;
			const old = await Promise.all(
				["001_sync", "002_attachments"].map(async (id) => ({
					id,
					sql: await readFile(resolve(directory, `${id}.sql`), "utf8"),
				})),
			);
			for (const migration of old) await pool.query(migration.sql);
			await pool.query(
				"CREATE TABLE sync_schema_migrations (id text PRIMARY KEY, sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
			);
			for (const migration of old) {
				await pool.query(
					"INSERT INTO sync_schema_migrations (id,sha256) VALUES ($1,$2)",
					[
						migration.id,
						createHash("sha256").update(migration.sql).digest("hex"),
					],
				);
			}
			const workspaceId = crypto.randomUUID();
			const operationId = crypto.randomUUID();
			const docId = `asset:${crypto.randomUUID()}`;
			await pool.query(
				"INSERT INTO sync_workspaces (workspace_id,next_sequence) VALUES ($1,1)",
				[workspaceId],
			);
			await pool.query(
				`INSERT INTO sync_changes
      (workspace_id,sequence,doc_id,kind,schema_version,ciphertext,tombstone,version)
      VALUES ($1,1,$2,'asset',1,'historical-ciphertext',false,1)`,
				[workspaceId, docId],
			);
			await pool.query(
				`INSERT INTO sync_operations (workspace_id,operation_id,fingerprint,result)
      VALUES ($1,$2,$3,$4::jsonb)`,
				[
					workspaceId,
					operationId,
					"0".repeat(64),
					JSON.stringify({
						operationId,
						status: "accepted",
						version: 1,
						sequence: 1,
					}),
				],
			);
			await migrateSyncDatabase(pool, directory);
			await migrateSyncDatabase(pool, directory);
			expect(
				(
					await pool.query<{ operation_id: string }>(
						"SELECT operation_id FROM sync_changes",
					)
				).rows,
			).toEqual([{ operation_id: operationId }]);
			expect(
				(
					await pool.query<{ id: string }>(
						"SELECT id FROM sync_schema_migrations ORDER BY id",
					)
				).rows.map((row) => row.id),
			).toEqual([
				"001_sync",
				"002_attachments",
				"003_change_operation_id",
				"004_bound_state",
				"005_bound_state_guard",
			]);
			const bindingId = crypto.randomUUID();
			const jkt = "a".repeat(43);
			const proofHash = "b".repeat(64);
			await pool.query(
				`INSERT INTO sync_bound_bindings
      (binding_id,subject,instance_id_hash,jkt,scopes,status,epoch,token_valid_after,state_observed_at,state_expires_at)
      VALUES ($1,$2,$3,$4,$5,'active',1,0,now(),now()+interval '1 minute')`,
				[bindingId, "keepanyadm:test", "c".repeat(64), jkt, ["sync:read"]],
			);
			const insertProof = () =>
				pool.query(
					`INSERT INTO sync_bound_proofs
      (binding_id,jkt,proof_jti_hash,expires_at) VALUES ($1,$2,$3,now()+interval '2 minutes')`,
					[bindingId, jkt, proofHash],
				);
			await insertProof();
			await expect(insertProof()).rejects.toMatchObject({ code: "23505" });
			await expect(
				pool.query(
					"UPDATE sync_bound_bindings SET epoch=0 WHERE binding_id=$1",
					[bindingId],
				),
			).rejects.toMatchObject({ code: "P0001" });
			await expect(
				pool.query(
					"UPDATE sync_bound_bindings SET token_valid_after=1, epoch=2 WHERE binding_id=$1",
					[bindingId],
				),
			).resolves.toBeDefined();
			await expect(
				pool.query(
					"UPDATE sync_bound_bindings SET token_valid_after=0 WHERE binding_id=$1",
					[bindingId],
				),
			).rejects.toMatchObject({ code: "P0001" });
			await expect(
				pool.query(
					"UPDATE sync_bound_bindings SET status='revoked' WHERE binding_id=$1",
					[bindingId],
				),
			).resolves.toBeDefined();
			await expect(
				pool.query(
					"UPDATE sync_bound_bindings SET status='active' WHERE binding_id=$1",
					[bindingId],
				),
			).rejects.toMatchObject({ code: "P0001" });
			await expect(
				pool.query("DELETE FROM sync_bound_bindings WHERE binding_id=$1", [
					bindingId,
				]),
			).rejects.toMatchObject({ code: "P0001" });
		} finally {
			await pool.end();
			if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
			await admin.end();
		}
	},
	60_000,
);
