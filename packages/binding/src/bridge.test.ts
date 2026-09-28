import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { bridgeBindingKeys, createBindingBridgeFetch } from "./bridge";

const issuer = "http://127.0.0.1:3100";
const bridge = "http://127.0.0.1:3191";

describe("fixed local binding bridge client", () => {
	it("routes only pinned endpoints and keeps the issuer URL for signature verification", async () => {
		const { privateKey, publicKey } = await generateKeyPair("RS256", {
			modulusLength: 2048,
		});
		const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
		const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
			requests.push({ url: String(input), init });
			return Response.json({
				keys: [{ ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" }],
			});
		}) as typeof fetch;
		const keys = bridgeBindingKeys(issuer, bridge, fetcher);
		const token = await new SignJWT({ scope: "binding:complete" })
			.setProtectedHeader({ alg: "RS256", kid: "test" })
			.setIssuer(issuer)
			.setAudience("keepany-binding")
			.setIssuedAt()
			.setExpirationTime("1m")
			.sign(privateKey);
		expect((await jwtVerify(token, keys, { issuer })).payload.scope).toBe(
			"binding:complete",
		);
		expect(requests[0].url).toBe(`${bridge}/.well-known/jwks.json`);
		expect(requests[0].init?.credentials).toBe("omit");
		await expect(
			createBindingBridgeFetch(
				issuer,
				bridge,
			)("https://attacker.example/api/keepany/v1/bindings/device"),
		).rejects.toThrow("binding-bridge-path");
		await expect(
			createBindingBridgeFetch(issuer, bridge)(`${issuer}/admin`, {
				method: "POST",
			}),
		).rejects.toThrow("binding-bridge-path");
	});

	it("rejects public or path-bearing relay origins", () => {
		expect(() =>
			createBindingBridgeFetch(issuer, "https://relay.example"),
		).toThrow("binding-bridge-origin");
		expect(() => createBindingBridgeFetch(issuer, `${bridge}/proxy`)).toThrow(
			"binding-bridge-origin",
		);
	});
});
