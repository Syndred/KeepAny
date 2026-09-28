import "fake-indexeddb/auto";
import { importJWK, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { createDeviceProof, deviceKeyThumbprint, tokenDigest } from "./proof";
import { BindingRepository } from "./store";

describe("sender-constrained device proof", () => {
	it("signs a fresh proof with the non-extractable local key and binds the exact token and endpoint", async () => {
		const repo = new BindingRepository(`binding-${crypto.randomUUID()}`);
		try {
			const deviceKey = await repo.deviceKey();
			const token = "R".repeat(43);
			const endpointUrl =
				"http://127.0.0.1:3100/api/keepany/v1/bindings/refresh";
			const proof = await createDeviceProof({
				deviceKey,
				refreshToken: token,
				endpointUrl,
			});
			expect(deviceKey.privateKey.extractable).toBe(false);
			const key = await importJWK(deviceKey.publicJwk, "ES256");
			const { payload, protectedHeader } = await jwtVerify(proof, key, {
				algorithms: ["ES256"],
			});
			expect(protectedHeader).toMatchObject({
				alg: "ES256",
				typ: "dpop+jwt",
				jwk: deviceKey.publicJwk,
			});
			expect(payload).toMatchObject({
				htm: "POST",
				htu: endpointUrl,
				ath: await tokenDigest(token),
			});
			expect(payload.jti).toMatch(/^[a-zA-Z0-9_-]{22,128}$/);
			expect(await deviceKeyThumbprint(deviceKey)).toMatch(
				/^[A-Za-z0-9_-]{43}$/,
			);
			expect(
				await createDeviceProof({
					deviceKey,
					refreshToken: token,
					endpointUrl,
				}),
			).not.toBe(proof);
			await expect(
				createDeviceProof({
					deviceKey,
					refreshToken: token,
					endpointUrl: "https://wrong.example/refresh?x=1",
				}),
			).rejects.toThrow("binding-proof-url");
		} finally {
			await repo.deleteDatabase();
		}
	});
});
