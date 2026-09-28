import "fake-indexeddb/auto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { BindingRepository, type LocalIdentity } from "./store";
import { instanceIdHash } from "./ticket";

const issuer = "http://127.0.0.1:3100";
async function ticket(
	identity: LocalIdentity,
	subject = `keepanyadm:${crypto.randomUUID()}`,
	bindingId = crypto.randomUUID(),
) {
	const { privateKey, publicKey } = await generateKeyPair("RS256", {
		modulusLength: 2048,
	});
	const jwk = {
		...(await exportJWK(publicKey)),
		kid: "binding-test",
		alg: "RS256",
		use: "sig",
	};
	const now = Math.floor(Date.now() / 1000);
	const signed = await new SignJWT({
		scope: "binding:complete",
		binding_id: bindingId,
		instance_id_hash: await instanceIdHash(identity.instanceId),
		allowed_scopes: ["sync:read"],
	})
		.setProtectedHeader({ alg: "RS256", kid: "binding-test", typ: "JWT" })
		.setIssuer(issuer)
		.setAudience("keepany-binding")
		.setSubject(subject)
		.setJti(crypto.randomUUID())
		.setIssuedAt(now)
		.setExpirationTime(now + 60)
		.sign(privateKey);
	return {
		ticket: signed,
		keys: createLocalJWKSet({ keys: [jwk] }),
		issuer,
		expectedBindingId: bindingId,
		expectedSubject: subject,
	};
}
async function pending(repo: BindingRepository, identity: LocalIdentity) {
	await repo.savePending({
		localAccountId: identity.localAccountId,
		deviceCode: "A".repeat(43),
		userCode: "TEST-CODE",
		verificationUri: `${issuer}/settings/connect`,
		requestedScopes: ["sync:read"],
		expiresAt: new Date(Date.now() + 300_000).toISOString(),
		nextPollAt: new Date().toISOString(),
		intervalSeconds: 5,
	});
}

describe("atomic local binding consumption", () => {
	it("stores exact subject and binding ID once, survives reopen, and never persists ticket", async () => {
		const name = `binding-${crypto.randomUUID()}`;
		const repo = new BindingRepository(name);
		try {
			const identity = await repo.identity();
			const deviceKey = await repo.deviceKey();
			expect(deviceKey.privateKey.extractable).toBe(false);
			expect((await repo.deviceKey()).publicJwk).toEqual(deviceKey.publicJwk);
			await pending(repo, identity);
			const response = await ticket(identity);
			const refreshToken = "B".repeat(43);
			const refreshExpiresAt = new Date(Date.now() + 86_400_000).toISOString();
			expect(
				(await repo.consume({ ...response, refreshToken, refreshExpiresAt }))
					.status,
			).toBe("created");
			expect((await repo.consume(response)).status).toBe("already-bound");
			expect(
				(await repo.credential(response.expectedBindingId))?.refreshToken,
			).toBe(refreshToken);
			const active = await repo.activeBinding();
			expect(active).toMatchObject({
				bindingId: response.expectedBindingId,
				subject: response.expectedSubject,
				status: "active",
			});
			expect(JSON.stringify(active)).not.toContain(response.ticket);
			repo.close();
			const reopened = new BindingRepository(name);
			expect((await reopened.activeBinding())?.bindingId).toBe(
				response.expectedBindingId,
			);
			expect((await reopened.deviceKey()).publicJwk).toEqual(
				deviceKey.publicJwk,
			);
			expect(
				(await reopened.credential(response.expectedBindingId))?.refreshToken,
			).toBe(refreshToken);
			expect((await reopened.consume(response)).status).toBe("already-bound");
			reopened.close();
		} finally {
			await repo.deleteDatabase();
		}
	});

	it("requires explicit switch to another commercial subject and keeps old binding on rejection", async () => {
		const repo = new BindingRepository(`binding-${crypto.randomUUID()}`);
		try {
			const identity = await repo.identity();
			await pending(repo, identity);
			const first = await ticket(identity);
			await repo.consume(first);
			await pending(repo, identity);
			const second = await ticket(identity);
			await expect(repo.consume(second)).rejects.toThrow(
				"binding-switch-confirmation-required",
			);
			expect((await repo.activeBinding())?.subject).toBe(first.expectedSubject);
			const switched = await repo.consume({ ...second, allowSwitch: true });
			expect(switched).toMatchObject({
				status: "created",
				binding: { subject: second.expectedSubject },
			});
			expect((await repo.activeBinding())?.subject).toBe(
				second.expectedSubject,
			);
			await expect(repo.consume(first)).rejects.toThrow("binding-id-reused");
		} finally {
			await repo.deleteDatabase();
		}
	});

	it("serializes racing completions so one pending challenge creates one active binding", async () => {
		const repo = new BindingRepository(`binding-${crypto.randomUUID()}`);
		try {
			const identity = await repo.identity();
			await pending(repo, identity);
			const subject = `keepanyadm:${crypto.randomUUID()}`;
			const [a, b] = await Promise.all([
				ticket(identity, subject),
				ticket(identity, subject),
			]);
			const results = await Promise.allSettled([
				repo.consume(a),
				repo.consume(b),
			]);
			expect(
				results.filter((result) => result.status === "fulfilled"),
			).toHaveLength(1);
			expect(
				results.filter((result) => result.status === "rejected"),
			).toHaveLength(1);
			expect((await repo.activeBinding())?.subject).toBe(subject);
		} finally {
			await repo.deleteDatabase();
		}
	});

	it("does not attach an existing binding ID to a different subject and handles local revoke", async () => {
		const repo = new BindingRepository(`binding-${crypto.randomUUID()}`);
		try {
			const identity = await repo.identity();
			await pending(repo, identity);
			const first = await ticket(identity);
			await repo.consume(first);
			const reusedId = await ticket(
				identity,
				`keepanyadm:${crypto.randomUUID()}`,
				first.expectedBindingId,
			);
			await expect(repo.consume(reusedId)).rejects.toThrow("binding-id-reused");
			expect(await repo.revokeLocal(first.expectedBindingId)).toBe(true);
			expect(await repo.activeBinding()).toBeUndefined();
			await expect(repo.consume(first)).rejects.toThrow("binding-id-reused");
		} finally {
			await repo.deleteDatabase();
		}
	});

	it("retains one refresh request ID across retries and rotates the local credential atomically", async () => {
		const repo = new BindingRepository(`binding-${crypto.randomUUID()}`);
		try {
			const identity = await repo.identity();
			await pending(repo, identity);
			const signed = await ticket(identity);
			const previousToken = "R".repeat(43);
			const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
			await repo.consume({
				...signed,
				refreshToken: previousToken,
				refreshExpiresAt: expiresAt,
			});
			const first = await repo.beginRefresh(signed.expectedBindingId);
			const retry = await repo.beginRefresh(signed.expectedBindingId);
			expect(retry).toEqual(first);
			expect(first.refreshToken).toBe(previousToken);
			const nextToken = "S".repeat(43);
			await repo.finishRefresh({
				bindingId: signed.expectedBindingId,
				previousToken,
				requestId: first.requestId,
				refreshToken: nextToken,
				expiresAt,
			});
			await repo.finishRefresh({
				bindingId: signed.expectedBindingId,
				previousToken,
				requestId: first.requestId,
				refreshToken: nextToken,
				expiresAt,
			});
			expect(
				(await repo.credential(signed.expectedBindingId))?.refreshToken,
			).toBe(nextToken);
			expect(
				(await repo.beginRefresh(signed.expectedBindingId)).requestId,
			).not.toBe(first.requestId);
		} finally {
			await repo.deleteDatabase();
		}
	});
});
