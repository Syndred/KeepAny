import "fake-indexeddb/auto";
import { once } from "node:events";
import { serve } from "@hono/node-server";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { generateWorkspaceKey } from "../../../packages/crypto/src";
import { type Asset, newAsset } from "../../../packages/domain/src";
import {
	type LocalRepository,
	openLocalRepository,
} from "../../../packages/local-db/src";
import {
	createSelfHostedWorkspace,
	SelfHostSyncClient,
} from "../../../packages/sync-client/src";
import { PostgresSyncService } from "../../../packages/sync-core/src/postgres";
import { createPostgresSyncApp } from "./app";
import { migrateSyncDatabase } from "./migrate";

// Opt in with an isolated PostgreSQL database; all rows live in a disposable schema.
it.skipIf(!process.env.KEEPANY_TEST_DATABASE_URL)(
	"syncs two RxDB clients through real HTTP and PostgreSQL across lost ack, conflict and tombstone",
	async () => {
		const connectionString = process.env.KEEPANY_TEST_DATABASE_URL;
		if (!connectionString) throw Error("test-database-url");
		const schema = `keepany_client_${crypto.randomUUID().replaceAll("-", "")}`;
		const admin = new pg.Pool({
			connectionString,
			max: 1,
			connectionTimeoutMillis: 5000,
		});
		const pool = new pg.Pool({
			connectionString,
			options: `-c search_path=${schema}`,
			max: 4,
			connectionTimeoutMillis: 5000,
		});
		const tokenA = "a".repeat(40);
		const tokenB = "b".repeat(40);
		let server: ReturnType<typeof serve> | undefined;
		let first: LocalRepository | undefined;
		let reopened: LocalRepository | undefined;
		let second: LocalRepository | undefined;
		let created = false;
		try {
			await admin.query(`CREATE SCHEMA "${schema}"`);
			created = true;
			await migrateSyncDatabase(pool);
			const service = new PostgresSyncService(pool);
			const app = createPostgresSyncApp(service, async (authorization) =>
				authorization === `Bearer ${tokenA}` ||
				authorization === `Bearer ${tokenB}`
					? "self-host-owner"
					: null,
			);
			server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
			if (!server.listening) await once(server, "listening");
			const address = server.address();
			if (!address || typeof address === "string") throw Error("http-address");
			const endpoint = `http://127.0.0.1:${address.port}`;
			const workspaceId = await createSelfHostedWorkspace(endpoint, tokenA);
			const key = await generateWorkspaceKey();
			const firstName = `test-${crypto.randomUUID().slice(0, 12)}`;
			first = await openLocalRepository(firstName);
			second = await openLocalRepository(
				`test-${crypto.randomUUID().slice(0, 12)}`,
			);
			const asset = { ...newAsset("project"), name: "Initial" };
			await first.save("asset", asset);
			const firstClient = new SelfHostSyncClient(first, {
				endpoint,
				token: tokenA,
				workspaceId,
				key,
			});
			const secondClient = new SelfHostSyncClient(second, {
				endpoint,
				token: tokenB,
				workspaceId,
				key,
			});
			expect((await firstClient.run()).status).toBe("synced");
			expect((await secondClient.run()).status).toBe("synced");
			expect((await second.get<Asset>("asset", asset.id))?.name).toBe(
				"Initial",
			);

			await first.save("asset", { ...asset, name: "From A" });
			await second.save("asset", { ...asset, name: "From B" });
			const originalFetch = globalThis.fetch;
			let lost = false;
			vi.stubGlobal(
				"fetch",
				async (input: RequestInfo | URL, init?: RequestInit) => {
					const response = await originalFetch(input, init);
					if (!lost && String(input).endsWith("/sync/push")) {
						lost = true;
						throw Error("simulated-lost-ack");
					}
					return response;
				},
			);
			expect((await firstClient.run()).status).toBe("failed");
			expect(lost).toBe(true);
			vi.unstubAllGlobals();
			await first.close();
			first = undefined;
			reopened = await openLocalRepository(firstName);
			// Rotating the bearer token retains the same self-host account scope and pending operation.
			const resumed = new SelfHostSyncClient(reopened, {
				endpoint,
				token: tokenB,
				workspaceId,
				key,
			});
			expect((await resumed.run()).status).toBe("synced");
			expect((await secondClient.run()).status).toBe("conflict");
			expect((await secondClient.resolve("local")).status).toBe("pending");
			expect((await secondClient.run()).status).toBe("synced");
			await second.deleteEntity("asset", asset.id);
			expect((await secondClient.run()).status).toBe("synced");
			expect((await resumed.run()).status).toBe("synced");
			expect((await reopened.get<Asset>("asset", asset.id))?.deleted).toBe(
				true,
			);
			await expect(
				reopened.save("asset", {
					...asset,
					name: "Implicit restore",
					deleted: false,
				}),
			).rejects.toThrow("tombstone-restore-required");
			const changes = await service.pull(
				{ workspaceId, cursor: 0, limit: 20 },
				"self-host-owner",
			);
			expect(changes.changes.map((change) => change.version)).toEqual([
				1, 2, 3, 4,
			]);
			expect(changes.changes[3].tombstone).toBe(true);
			expect(changes.changes[3].ciphertext).not.toContain("From B");
		} finally {
			vi.unstubAllGlobals();
			await Promise.all([first?.close(), reopened?.close(), second?.close()]);
			if (server)
				await new Promise<void>((resolve, reject) =>
					server?.close((error) => (error ? reject(error) : resolve())),
				);
			await pool.end();
			if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
			await admin.end();
		}
	},
	60_000,
);
