import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { BindingRepository } from "./store";
import { WebBindingBackend } from "./web-store";
import { instanceIdHash, newInstanceId } from "./ticket";

describe("Web binding compatibility and atomic snapshots", () => {
	it("opens existing v2 identities, non-extractable keys and credentials without replacing them", async () => {
		const name = `binding-v2-${crypto.randomUUID()}`,
			legacy = new Dexie(name);
		legacy
			.version(2)
			.stores({
				identities: "slot",
				pending: "localAccountId",
				bindings: "bindingId, localAccountId, instanceIdHash, subject, status",
				deviceKeys: "slot",
				credentials: "bindingId",
			});
		const identity = {
			slot: "default",
			localAccountId: crypto.randomUUID(),
			instanceId: newInstanceId(),
			createdAt: new Date().toISOString(),
		};
		const pair = await crypto.subtle.generateKey(
				{ name: "ECDSA", namedCurve: "P-256" },
				false,
				["sign", "verify"],
			),
			publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
		const bindingId = crypto.randomUUID();
		await legacy.table("identities").put(identity);
		await legacy
			.table("deviceKeys")
			.put({ slot: "default", privateKey: pair.privateKey, publicJwk });
		await legacy
			.table("bindings")
			.put({
				bindingId,
				localAccountId: identity.localAccountId,
				instanceIdHash: await instanceIdHash(identity.instanceId),
				subject: "keepanyadm:legacy",
				allowedScopes: ["sync:read"],
				status: "active",
				createdAt: identity.createdAt,
				updatedAt: identity.createdAt,
			});
		await legacy
			.table("credentials")
			.put({
				bindingId,
				refreshToken: "L".repeat(43),
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				updatedAt: identity.createdAt,
			});
		legacy.close();
		const repository = new BindingRepository(name);
		try {
			expect(await repository.identity()).toEqual(identity);
			expect((await repository.deviceKey()).privateKey.extractable).toBe(false);
			expect((await repository.deviceKey()).publicJwk).toEqual(publicJwk);
			expect((await repository.credential(bindingId))?.refreshToken).toBe(
				"L".repeat(43),
			);
		} finally {
			await repository.deleteDatabase();
		}
	});
	it("rejects a stale whole-state write across independent backend handles", async () => {
		const name = `binding-cas-${crypto.randomUUID()}`,
			first = new WebBindingBackend(name),
			second = new WebBindingBackend(name);
		try {
			const snapshot = await first.readState(),
				other = await second.readState();
			expect(other.revision).toBe(snapshot.revision);
			const identity = {
				slot: "default" as const,
				localAccountId: crypto.randomUUID(),
				instanceId: newInstanceId(),
				createdAt: new Date().toISOString(),
			};
			expect(
				await first.compareAndSet(snapshot.revision, {
					...snapshot.state,
					identity,
				}),
			).toBe(true);
			expect(await second.compareAndSet(other.revision, other.state)).toBe(
				false,
			);
			expect((await second.readState()).state.identity).toEqual(identity);
		} finally {
			second.close();
			await first.deleteDatabase();
		}
	});
});
