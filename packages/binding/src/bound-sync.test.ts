import "fake-indexeddb/auto";
import {
	createLocalJWKSet,
	exportJWK,
	generateKeyPair,
	importJWK,
	jwtVerify,
	SignJWT,
} from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoundSyncAccess } from "./bound-sync";
import { tokenDigest } from "./proof";
import { BindingTransport, startBindingChallenge } from "./remote";
import { BindingRepository } from "./store";
import { deviceKeyThumbprint } from "./proof";
import { instanceIdHash, type BindingScope } from "./ticket";

const issuer = "http://127.0.0.1:3199";
const resourceOrigin = "http://127.0.0.1:4181";

async function fixture(allowedScopes: BindingScope[], issuedScopes = allowedScopes) {
	const databaseName = `binding-bound-${crypto.randomUUID()}`;
	const repository = new BindingRepository(databaseName);
	const secondTab = new BindingRepository(databaseName);
	const bindingId = crypto.randomUUID();
	const subject = `keepanyadm:${crypto.randomUUID()}`;
	const firstRefreshToken = "R".repeat(43);
	const { privateKey, publicKey } = await generateKeyPair("RS256", { modulusLength: 2048 });
	const keys = createLocalJWKSet({ keys: [{
		...(await exportJWK(publicKey)), kid: "bound-adapter", alg: "RS256", use: "sig",
	}] });
	let refreshCount = 0;
	const transport = new BindingTransport(issuer, (async (request, init) => {
		const url = new URL(request.toString());
		if (url.pathname.endsWith("/device")) return Response.json({ code: 0, data: {
			deviceCode: "D".repeat(43), userCode: "TEST-CODE",
			verificationUri: `${issuer}/settings/connect`, expiresIn: 300, interval: 5,
		} });
		if (!url.pathname.endsWith("/refresh")) throw Error(`unexpected ${url.pathname}`);
		const body = JSON.parse(String(init?.body)) as { refreshToken: string };
		const expected = refreshCount === 0 ? firstRefreshToken : String.fromCharCode(82 + refreshCount).repeat(43);
		expect(body.refreshToken).toBe(expected);
		const deviceKey = await repository.deviceKey();
		const devicePublic = await importJWK(deviceKey.publicJwk, "ES256");
		const proof = String(new Headers(init?.headers).get("DPoP"));
		const verifiedProof = await jwtVerify(proof, devicePublic, { algorithms: ["ES256"] });
		expect(verifiedProof.payload).toMatchObject({
			htm: "POST", htu: url.href, ath: await tokenDigest(expected),
		});
		refreshCount += 1;
		const nextRefreshToken = String.fromCharCode(82 + refreshCount).repeat(43);
		const now = Math.floor(Date.now() / 1000);
		const identity = await repository.identity();
		const accessToken = await new SignJWT({
			scope: issuedScopes.join(" "), binding_id: bindingId,
			instance_id_hash: await instanceIdHash(identity.instanceId),
			cnf: { jkt: await deviceKeyThumbprint(deviceKey) }, entitlements_version: 1,
		})
			.setProtectedHeader({ alg: "RS256", kid: "bound-adapter", typ: "JWT" })
			.setIssuer(issuer).setAudience("keepany-sync-bound").setSubject(subject)
			.setJti(crypto.randomUUID()).setIssuedAt(now).setExpirationTime(now + 60)
			.sign(privateKey);
		return Response.json({ code: 0, data: {
			status: "active", bindingId, subject, refreshToken: nextRefreshToken,
			refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
			accessToken, accessExpiresAt: new Date((now + 60) * 1000).toISOString(),
			tokenType: "DPoP", scope: issuedScopes.join(" "),
		} });
	}) as typeof fetch);
	await startBindingChallenge({ repository, transport, instanceName: "Local Web", scopes: allowedScopes });
	const identity = await repository.identity();
	const now = Math.floor(Date.now() / 1000);
	const ticket = await new SignJWT({
		scope: "binding:complete", binding_id: bindingId,
		instance_id_hash: await instanceIdHash(identity.instanceId), allowed_scopes: allowedScopes,
	})
		.setProtectedHeader({ alg: "RS256", kid: "bound-adapter", typ: "JWT" })
		.setIssuer(issuer).setAudience("keepany-binding").setSubject(subject)
		.setJti(crypto.randomUUID()).setIssuedAt(now).setExpirationTime(now + 60)
		.sign(privateKey);
	await repository.consume({
		ticket, issuer, keys, expectedBindingId: bindingId, expectedSubject: subject,
		refreshToken: firstRefreshToken,
		refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
	});
	return {
		repository, secondTab, transport, keys, bindingId, subject,
		get refreshCount() { return refreshCount; },
		async close() { secondTab.close(); await repository.deleteDatabase(); },
	};
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("bound sync access adapter", () => {
	it("rejects an old read-only binding without rotating a credential", async () => {
		const item = await fixture(["sync:read"]);
		try {
			await expect(createBoundSyncAccess({ ...item, resourceOrigin })).rejects.toThrow("binding-access-scope");
			expect(item.refreshCount).toBe(0);
		} finally { await item.close(); }
	});

	it("rejects a token that lacks the ticket's write scope", async () => {
		const item = await fixture(["sync:read", "sync:write"], ["sync:read"]);
		try {
			const access = await createBoundSyncAccess({ ...item, resourceOrigin });
			await expect(access.headers("POST", `${resourceOrigin}/sync/preflight`))
				.rejects.toThrow("binding-access-scope");
			expect(item.refreshCount).toBe(1);
		} finally { await item.close(); }
	});

	it("signs a unique method and URL proof per request, rejects other origins, and rotates short tokens", async () => {
		const item = await fixture(["sync:read", "sync:write"]);
		try {
			const access = await createBoundSyncAccess({ ...item, resourceOrigin });
			expect(access.accountId).toBe(item.subject);
			expect(access.bindingId).toBe(item.bindingId);
			const path = `${resourceOrigin}/sync/preflight`;
			const [first, second] = await Promise.all([
				access.headers("POST", path), access.headers("POST", path),
			]);
			expect(item.refreshCount).toBe(1);
			expect(first.Authorization).toBe(second.Authorization);
			expect(first.DPoP).not.toBe(second.DPoP);
			const publicKey = await importJWK((await item.repository.deviceKey()).publicJwk, "ES256");
			for (const headers of [first, second]) {
				const proof = await jwtVerify(headers.DPoP, publicKey, { algorithms: ["ES256"] });
				expect(proof.payload).toMatchObject({
					htm: "POST", htu: path, ath: await tokenDigest(headers.Authorization.slice(5)),
				});
			}
			await expect(access.headers("GET", "http://evil.example/workspaces"))
				.rejects.toThrow("binding-resource-url");
			await expect(access.headers("GET", `${resourceOrigin}/workspaces?leak=1`))
				.rejects.toThrow("binding-resource-url");
			await expect(access.headers("GET", `${resourceOrigin}/workspaces?`))
				.rejects.toThrow("binding-resource-url");
			await expect(access.headers("GET", `${resourceOrigin}/not-sync`))
				.rejects.toThrow("binding-resource-url");
			const later = Date.now() + 56_000;
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(later);
			const rotated = await access.headers("GET", `${resourceOrigin}/workspaces`);
			expect(item.refreshCount).toBe(2);
			expect(rotated.Authorization).not.toBe(first.Authorization);
			const proof = await jwtVerify(rotated.DPoP, publicKey, { algorithms: ["ES256"] });
			expect(proof.payload).toMatchObject({
				htm: "GET", htu: `${resourceOrigin}/workspaces`,
				ath: await tokenDigest(rotated.Authorization.slice(5)),
			});
		} finally { await item.close(); }
	});

	it("rejects stale access after another tab removes the binding", async () => {
		const item = await fixture(["sync:read", "sync:write"]);
		try {
			const access = await createBoundSyncAccess({ ...item, resourceOrigin });
			await access.headers("POST", `${resourceOrigin}/sync/preflight`);
			expect(await item.secondTab.revokeLocal(item.bindingId)).toBe(true);
			await expect(access.assertCurrent()).rejects.toThrow("binding-not-active");
			await expect(access.headers("POST", `${resourceOrigin}/sync/push`))
				.rejects.toThrow("binding-not-active");
			expect(item.refreshCount).toBe(1);
		} finally { await item.close(); }
	});

	it("does not store or return an in-flight refresh after local removal", async () => {
		const item = await fixture(["sync:read", "sync:write"]);
		let release!: () => void;
		let started!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const requested = new Promise<void>((resolve) => { started = resolve; });
		const refresh = item.transport.refresh.bind(item.transport);
		item.transport.refresh = async (input) => {
			started();
			await gate;
			return refresh(input);
		};
		try {
			const access = await createBoundSyncAccess({ ...item, resourceOrigin });
			const stale = access.headers("POST", `${resourceOrigin}/sync/push`);
			await requested;
			expect(await item.secondTab.revokeLocal(item.bindingId)).toBe(true);
			release();
			await expect(stale).rejects.toThrow("binding-not-active");
			expect(await item.repository.credential(item.bindingId)).toBeUndefined();
		} finally { release(); await item.close(); }
	});
});
