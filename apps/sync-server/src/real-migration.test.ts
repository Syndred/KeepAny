import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { expect, it } from "vitest";
import { createPostgresBoundStateStore } from "./bound-state";
import { migrateSyncDatabase } from "./migrate";

const directory = resolve(process.cwd(), "apps/sync-server/migrations");

// Opt in only with an isolated PostgreSQL test database. Never touches public schema.
it.skipIf(!process.env.KEEPANY_TEST_DATABASE_URL)(
	"upgrades a historical accepted change through 003, 004, 005 and 006 in real PostgreSQL",
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
			"006_bound_state_writer_guard",
			]);
			const bindingId = crypto.randomUUID();
			const jkt = "a".repeat(43);
			const proofHash = "b".repeat(64);
			await pool.query(
				`INSERT INTO sync_bound_bindings
      (binding_id,subject,instance_id_hash,jkt,scopes,status,epoch,token_valid_after,state_observed_at,state_expires_at)
      VALUES ($1,$2,$3,$4,$5,'active',1,0,now(),now()+interval '10 seconds')`,
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
					"UPDATE sync_bound_bindings SET status='inactive' WHERE binding_id=$1",
					[bindingId],
				),
			).rejects.toMatchObject({ code: "P0001" });
			const secondInstance = new pg.Pool({
				connectionString,
				options: `-c search_path=${schema}`,
				max: 1,
			});
			try {
				const firstStore = createPostgresBoundStateStore(pool);
				const secondStore = createPostgresBoundStateStore(secondInstance);
				const claim = {
					bindingId,
					subject: "keepanyadm:test",
					instanceIdHash: "c".repeat(64),
					jkt,
					scope: "sync:read" as const,
					tokenIssuedAt: Math.floor(Date.now() / 1000) + 1,
					tokenExpiresAt: Math.floor(Date.now() / 1000) + 60,
					proofIssuedAt: Math.floor(Date.now() / 1000),
					proofJti: crypto.randomUUID(),
				};
				const results = await Promise.all([
					firstStore.claimProof(claim),
					secondStore.claimProof(claim),
				]);
				expect(results.sort()).toEqual([false, true]);
				const secondPid = (await secondInstance.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
				const waitPastExpiry = async (proofJti: string, tokenExpiresAt: number, proofIssuedAt: number) => {
					const locker = await pool.connect();
					try {
						await locker.query('BEGIN');
						await locker.query('SELECT binding_id FROM sync_bound_bindings WHERE binding_id=$1 FOR UPDATE', [bindingId]);
						const pending = secondStore.claimProof({ ...claim, proofJti, tokenExpiresAt, proofIssuedAt });
						let waiting = false;
						for (let attempt = 0; attempt < 30; attempt++) {
							const activity = await admin.query<{ wait_event_type: string | null }>(
								'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [secondPid]);
							if (activity.rows[0]?.wait_event_type === 'Lock') { waiting = true; break; }
							await new Promise(resolve => setTimeout(resolve, 20));
						}
						expect(waiting).toBe(true);
						const deadline = Math.min(tokenExpiresAt, proofIssuedAt + 60) * 1000;
						await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - Date.now() + 100)));
						await locker.query('COMMIT');
						expect(await pending).toBe(false);
						const proofHash = createHash('sha256').update(proofJti).digest('hex');
						const persisted = await pool.query<{ count: string }>(
							'SELECT count(*) FROM sync_bound_proofs WHERE proof_jti_hash=$1', [proofHash]);
						expect(persisted.rows[0].count).toBe('0');
					} finally {
						await locker.query('ROLLBACK').catch(() => {});
						locker.release();
					}
				};
				await waitPastExpiry(crypto.randomUUID(), Math.floor(Date.now() / 1000) + 2,
					Math.floor(Date.now() / 1000));
				await waitPastExpiry(crypto.randomUUID(), Math.floor(Date.now() / 1000) + 60,
					Math.floor(Date.now() / 1000) - 59);
				await pool.query(
					`UPDATE sync_bound_bindings SET status='revoked', epoch=3, token_valid_after=2,
          state_observed_at=now(), state_expires_at=now()+interval '10 seconds' WHERE binding_id=$1`,
					[bindingId],
				);
				await expect(pool.query(
					`UPDATE sync_bound_bindings SET status='active', epoch=4, token_valid_after=3,
          state_observed_at=now(), state_expires_at=now()+interval '10 seconds' WHERE binding_id=$1`,
					[bindingId],
				)).rejects.toMatchObject({ code: "P0001" });
				expect(
					await secondStore.claimProof({
						...claim,
						proofJti: crypto.randomUUID(),
					}),
				).toBe(false);
			} finally {
				await secondInstance.end();
			}
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
