import "fake-indexeddb/auto";
import {
	createLocalJWKSet,
	exportJWK,
	generateKeyPair,
	importJWK,
	jwtVerify,
	SignJWT,
} from "jose";
import { describe, expect, it } from "vitest";
import { deviceKeyThumbprint, tokenDigest } from "./proof";
import {
	BindingTransport,
	pollAndConsumeBinding,
	refreshAndStoreBoundAccess,
	startBindingChallenge,
} from "./remote";
import { BindingRepository } from "./store";
import { instanceIdHash } from "./ticket";

const issuer = "http://127.0.0.1:3100";

describe("commercial challenge transport", () => {
	it("sends the persisted device public key and consumes the exact signed approval once", async () => {
		const repo = new BindingRepository(`binding-${crypto.randomUUID()}`);
		const deviceCode = "D".repeat(43);
		const bindingId = crypto.randomUUID();
		const subject = `keepanyadm:${crypto.randomUUID()}`;
		const refreshToken = "R".repeat(43);
		const nextRefreshToken = "S".repeat(43);
		const refreshExpiresAt = new Date(Date.now() + 86_400_000).toISOString();
		const { privateKey, publicKey } = await generateKeyPair("RS256", {
			modulusLength: 2048,
		});
		const jwk = {
			...(await exportJWK(publicKey)),
			kid: "binding-test",
			alg: "RS256",
			use: "sig",
		};
		const keys = createLocalJWKSet({ keys: [jwk] });
		const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
		const fetcher = (async (request: URL | RequestInfo, init?: RequestInit) => {
			const url = new URL(request.toString());
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			requests.push({ path: url.pathname, body });
			if (url.pathname.endsWith("/device")) {
				return Response.json({
					code: 0,
					data: {
						deviceCode,
						userCode: "TEST-CODE",
						verificationUri: `${issuer}/settings/connect`,
						expiresIn: 300,
						interval: 5,
					},
				});
			}
			if (url.pathname.endsWith("/refresh")) {
				const key = await repo.deviceKey();
				const publicKey = await importJWK(key.publicJwk, "ES256");
				const headers = init?.headers as Record<string, string> | undefined;
				const proof = String(headers?.DPoP);
				const verified = await jwtVerify(proof, publicKey, {
					algorithms: ["ES256"],
				});
				expect(verified.payload).toMatchObject({
					htm: "POST",
					htu: url.href,
					ath: await tokenDigest(refreshToken),
				});
				expect(body).toMatchObject({
					bindingId,
					refreshToken,
					requestId: expect.any(String),
				});
				const now = Math.floor(Date.now() / 1000);
				const identity = await repo.identity();
				const accessToken = await new SignJWT({
					scope: "sync:read",
					binding_id: bindingId,
					instance_id_hash: await instanceIdHash(identity.instanceId),
					cnf: { jkt: await deviceKeyThumbprint(key) },
					entitlements_version: 1,
				})
					.setProtectedHeader({ alg: "RS256", kid: "binding-test", typ: "JWT" })
					.setIssuer(issuer)
					.setAudience("keepany-sync-bound")
					.setSubject(subject)
					.setJti(crypto.randomUUID())
					.setIssuedAt(now)
					.setExpirationTime(now + 60)
					.sign(privateKey);
				return Response.json({
					code: 0,
					data: {
						status: "active",
						bindingId,
						subject,
						refreshToken: nextRefreshToken,
						refreshExpiresAt,
						accessToken,
						accessExpiresAt: new Date((now + 60) * 1000).toISOString(),
						tokenType: "DPoP",
						scope: "sync:read",
					},
				});
			}
			const identity = await repo.identity();
			const now = Math.floor(Date.now() / 1000);
			const bindingTicket = await new SignJWT({
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
			return Response.json({
				code: 0,
				data: {
					status: "approved",
					bindingId,
					subject,
					bindingTicket,
					expiresAt: new Date((now + 60) * 1000).toISOString(),
					retryUntil: new Date(Date.now() + 600_000).toISOString(),
					refreshToken,
					refreshExpiresAt,
				},
			});
		}) as typeof fetch;
		try {
			const transport = new BindingTransport(issuer, fetcher);
			const challenge = await startBindingChallenge({
				repository: repo,
				transport,
				instanceName: "Local Mac",
				scopes: ["sync:read"],
			});
			expect(challenge).toMatchObject({ userCode: "TEST-CODE", interval: 5 });
			expect(requests[0].body).toMatchObject({
				instanceName: "Local Mac",
				scopes: ["sync:read"],
			});
			expect(requests[0].body.devicePublicKey).toEqual(
				(await repo.deviceKey()).publicJwk,
			);
			expect(
				await pollAndConsumeBinding({ repository: repo, transport, keys }),
			).toEqual({ status: "wait", retryAfterSeconds: expect.any(Number) });
			expect(requests).toHaveLength(1);
			const pending = await repo.pendingChallenge();
			if (!pending) throw Error("missing pending challenge");
			await repo.savePending({
				...pending,
				nextPollAt: new Date().toISOString(),
			});
			expect(
				await pollAndConsumeBinding({ repository: repo, transport, keys }),
			).toMatchObject({
				status: "created",
				binding: { bindingId, subject },
			});
			expect(requests[1]).toEqual({
				path: "/api/keepany/v1/bindings/poll",
				body: { deviceCode },
			});
			expect((await repo.credential(bindingId))?.refreshToken).toBe(
				refreshToken,
			);
			expect(await repo.pendingChallenge()).toBeUndefined();
			const access = await refreshAndStoreBoundAccess({
				repository: repo,
				transport,
				keys,
			});
			expect(access.scope).toBe("sync:read");
			expect((await repo.credential(bindingId))?.refreshToken).toBe(
				nextRefreshToken,
			);
		} finally {
			await repo.deleteDatabase();
		}
	});

	it("enforces the fixed approval URL and honors a server retry interval", async () => {
		const repo = new BindingRepository(`binding-${crypto.randomUUID()}`);
		try {
			const bad = new BindingTransport(issuer, (async () =>
				Response.json({
					code: 0,
					data: {
						deviceCode: "D".repeat(43),
						userCode: "TEST-CODE",
						verificationUri: "https://attacker.example/connect",
						expiresIn: 300,
						interval: 5,
					},
				})) as typeof fetch);
			await expect(
				startBindingChallenge({
					repository: repo,
					transport: bad,
					instanceName: "Mac",
					scopes: ["sync:read"],
				}),
			).rejects.toThrow("binding-verification-uri");
			expect(await repo.pendingChallenge()).toBeUndefined();

			const transport = new BindingTransport(
				issuer,
				(async () =>
					new Response(null, {
						status: 429,
						headers: { "Retry-After": "9" },
					})) as typeof fetch,
			);
			const identity = await repo.identity();
			await repo.savePending({
				localAccountId: identity.localAccountId,
				deviceCode: "D".repeat(43),
				userCode: "TEST-CODE",
				verificationUri: `${issuer}/settings/connect`,
				requestedScopes: ["sync:read"],
				expiresAt: new Date(Date.now() + 300_000).toISOString(),
				nextPollAt: new Date().toISOString(),
				intervalSeconds: 5,
			});
			expect(
				await pollAndConsumeBinding({
					repository: repo,
					transport,
					keys: async () => {
						throw Error("unused");
					},
				}),
			).toEqual({ status: "slow_down", retryAfterSeconds: 9 });
			const pending = await repo.pendingChallenge();
			if (!pending) throw Error("missing pending challenge");
			expect(Date.parse(pending.nextPollAt)).toBeGreaterThan(
				Date.now() + 7_000,
			);
		} finally {
			await repo.deleteDatabase();
		}
	});
});
