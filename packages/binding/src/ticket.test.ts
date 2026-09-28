import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
	type BindingScope,
	instanceIdHash,
	newInstanceId,
	validatedIssuer,
	verifyBindingTicket,
	verifyBoundAccessToken,
} from "./ticket";

const issuer = "http://127.0.0.1:3100";
async function signer() {
	const { privateKey, publicKey } = await generateKeyPair("RS256", {
		modulusLength: 2048,
	});
	const publicJwk = {
		...(await exportJWK(publicKey)),
		kid: "fixture-key",
		alg: "RS256",
		use: "sig",
	};
	const keys = createLocalJWKSet({ keys: [publicJwk] });
	const instanceId = newInstanceId();
	const bindingId = crypto.randomUUID();
	const subject = `keepanyadm:${crypto.randomUUID()}`;
	const now = Math.floor(Date.now() / 1000);
	const issue = async (
		overrides: Record<string, unknown> = {},
		aud = "keepany-binding",
		age = 60,
	) =>
		new SignJWT({
			scope: "binding:complete",
			binding_id: bindingId,
			instance_id_hash: await instanceIdHash(instanceId),
			allowed_scopes: ["sync:read"],
			...overrides,
		})
			.setProtectedHeader({ alg: "RS256", kid: "fixture-key", typ: "JWT" })
			.setIssuer(issuer)
			.setAudience(aud)
			.setSubject(subject)
			.setJti(crypto.randomUUID())
			.setIssuedAt(now)
			.setExpirationTime(now + age)
			.sign(privateKey);
	return { keys, issue, instanceId, bindingId, subject };
}

describe("commercial binding ticket consumer", () => {
	it("pins issuer and accepts only correctly signed, instance-bound completion scope", async () => {
		const fixture = await signer();
		const result = await verifyBindingTicket({
			ticket: await fixture.issue(),
			issuer,
			keys: fixture.keys,
			instanceId: fixture.instanceId,
			requestedScopes: ["sync:read"],
			expectedBindingId: fixture.bindingId,
			expectedSubject: fixture.subject,
		});
		expect(result).toMatchObject({
			bindingId: fixture.bindingId,
			subject: fixture.subject,
			allowedScopes: ["sync:read"],
		});
		expect(() => validatedIssuer("http://billing.example")).toThrow(
			"binding-issuer",
		);
		expect(() => validatedIssuer("https://billing.example/path")).toThrow(
			"binding-issuer",
		);
	});

	it("rejects wrong audience, tampering, instance, scope and response mismatch", async () => {
		const fixture = await signer();
		const input = {
			issuer,
			keys: fixture.keys,
			instanceId: fixture.instanceId,
			requestedScopes: ["sync:read"] as BindingScope[],
			expectedBindingId: fixture.bindingId,
			expectedSubject: fixture.subject,
		};
		await expect(
			verifyBindingTicket({
				...input,
				ticket: await fixture.issue({}, "keepany-sync"),
			}),
		).rejects.toThrow();
		const valid = await fixture.issue();
		await expect(
			verifyBindingTicket({ ...input, ticket: `${valid.slice(0, -3)}abc` }),
		).rejects.toThrow();
		await expect(
			verifyBindingTicket({
				...input,
				ticket: valid,
				instanceId: newInstanceId(),
			}),
		).rejects.toThrow("binding-instance-mismatch");
		await expect(
			verifyBindingTicket({
				...input,
				ticket: valid,
				requestedScopes: ["sync:read", "sync:write"],
			}),
		).rejects.toThrow("binding-scopes");
		await expect(
			verifyBindingTicket({
				...input,
				ticket: valid,
				expectedSubject: `keepanyadm:${crypto.randomUUID()}`,
			}),
		).rejects.toThrow("binding-subject-mismatch");
		await expect(
			verifyBindingTicket({
				...input,
				ticket: valid,
				expectedBindingId: crypto.randomUUID(),
			}),
		).rejects.toThrow("binding-id-mismatch");
		await expect(
			verifyBindingTicket({
				...input,
				ticket: await fixture.issue({ scope: "sync:read" }),
			}),
		).rejects.toThrow();
	});

	it("rejects excess lifetime, missing read scope and duplicate scopes", async () => {
		const fixture = await signer();
		const input = {
			issuer,
			keys: fixture.keys,
			instanceId: fixture.instanceId,
			requestedScopes: ["sync:read"] as BindingScope[],
			expectedBindingId: fixture.bindingId,
			expectedSubject: fixture.subject,
		};
		await expect(
			verifyBindingTicket({
				...input,
				ticket: await fixture.issue({}, "keepany-binding", 61),
			}),
		).rejects.toThrow("binding-lifetime");
		await expect(
			verifyBindingTicket({
				...input,
				ticket: await fixture.issue({ allowed_scopes: ["sync:write"] }),
				requestedScopes: ["sync:write"],
			}),
		).rejects.toThrow("binding-scopes");
		await expect(
			verifyBindingTicket({
				...input,
				ticket: await fixture.issue({
					allowed_scopes: ["sync:read", "sync:read"],
				}),
				requestedScopes: ["sync:read", "sync:read"],
			}),
		).rejects.toThrow("binding-scopes");
	});
});

describe("bound commercial access token", () => {
	it("requires the exact account, binding, instance and device key", async () => {
		const fixture = await signer();
		const jkt = "A".repeat(43);
		const token = await fixture.issue(
			{
				scope: "sync:read sync:write",
				cnf: { jkt },
				entitlements_version: 1,
			},
			"keepany-sync-bound",
		);
		const input = {
			token,
			issuer,
			keys: fixture.keys,
			bindingId: fixture.bindingId,
			subject: fixture.subject,
			instanceIdHash: await instanceIdHash(fixture.instanceId),
			deviceKeyThumbprint: jkt,
			requiredScope: "sync:write" as const,
		};
		expect((await verifyBoundAccessToken(input)).scopes).toEqual([
			"sync:read",
			"sync:write",
		]);
		await expect(
			verifyBoundAccessToken({ ...input, deviceKeyThumbprint: "B".repeat(43) }),
		).rejects.toThrow("binding-access-identity");
		await expect(
			verifyBoundAccessToken({ ...input, bindingId: crypto.randomUUID() }),
		).rejects.toThrow("binding-access-identity");
		await expect(
			verifyBoundAccessToken({
				...input,
				subject: `keepanyadm:${crypto.randomUUID()}`,
			}),
		).rejects.toThrow("binding-access-identity");
		await expect(
			verifyBoundAccessToken({ ...input, token: await fixture.issue() }),
		).rejects.toThrow();
		await expect(
			verifyBoundAccessToken({
				...input,
				token: await fixture.issue(
					{
						scope: "sync:read",
						cnf: { jkt },
						entitlements_version: 1,
					},
					"keepany-sync-bound",
				),
			}),
		).rejects.toThrow("binding-access-scope");
	});
});
