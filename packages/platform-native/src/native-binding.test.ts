import "fake-indexeddb/auto";
import { importJWK, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import {
	createNativeBindingBackend,
	type NativeBindingPlugin,
} from "./native-binding";
import {
	BindingRepository,
	defaultBindingRepository,
	registerBindingRepositoryFactory,
} from "../../binding/src/store";
import {
	createDeviceProof,
	createBoundResourceProof,
	tokenDigest,
} from "../../binding/src/proof";
import type { BindingState } from "../../binding/src/storage";
import { instanceIdHash } from "../../binding/src/ticket";

async function fixture() {
	const keys = await crypto.subtle.generateKey(
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign", "verify"],
	);
	const exported = await crypto.subtle.exportKey("jwk", keys.publicKey);
	if (!exported.x || !exported.y) throw Error("fixture-key");
	const publicJwk = {
		kty: "EC" as const,
		crv: "P-256" as const,
		x: exported.x,
		y: exported.y,
	};
	let revision = crypto.randomUUID(),
		payload = JSON.stringify({ bindings: [], credentials: [] });
	const controls = { fail: false, conflict: false, writes: 0 };
	const plugin: NativeBindingPlugin = {
		async initialize() {},
		async publicKey() {
			return publicJwk;
		},
		async readState() {
			return { revision, payload };
		},
		async compareAndSet(input) {
			controls.writes++;
			if (controls.fail) {
				controls.fail = false;
				throw Error("secret response body must not escape");
			}
			if (controls.conflict) {
				controls.conflict = false;
				revision = crypto.randomUUID();
				return { committed: false };
			}
			if (input.expectedRevision !== revision) return { committed: false };
			payload = input.payload;
			revision = crypto.randomUUID();
			return { committed: true };
		},
		async sign(input) {
			const data = Uint8Array.from(atob(input.signingInputBase64), (char) =>
				char.charCodeAt(0),
			);
			const signature = new Uint8Array(
				await crypto.subtle.sign(
					{ name: "ECDSA", hash: "SHA-256" },
					keys.privateKey,
					data,
				),
			);
			return {
				signatureBase64: btoa(
					Array.from(signature, (byte) => String.fromCharCode(byte)).join(""),
				),
			};
		},
	};
	return {
		plugin,
		controls,
		backend: await createNativeBindingBackend(plugin),
	};
}
async function boundState(
	repository: BindingRepository,
): Promise<BindingState> {
	const identity = await repository.identity(),
		now = new Date().toISOString(),
		bindingId = crypto.randomUUID();
	return {
		identity,
		bindings: [
			{
				bindingId,
				localAccountId: identity.localAccountId,
				instanceIdHash: await instanceIdHash(identity.instanceId),
				subject: "keepanyadm:fixture",
				allowedScopes: ["sync:read", "sync:write"],
				status: "active",
				createdAt: now,
				updatedAt: now,
			},
		],
		credentials: [
			{
				bindingId,
				refreshToken: "R".repeat(43),
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				updatedAt: now,
			},
		],
	};
}

describe("native binding contract (software bridge fixture, not Keystore/device evidence)", () => {
	it("creates a separate identity, retries CAS and never requires a Web CryptoKey", async () => {
		const a = await fixture(),
			b = await fixture();
		a.controls.conflict = true;
		const first = new BindingRepository("native-fixture-a", a.backend),
			second = new BindingRepository("native-fixture-b", b.backend);
		const [one, two] = await Promise.all([first.identity(), first.identity()]);
		expect(one).toEqual(two);
		expect(a.controls.writes).toBeGreaterThan(1);
		expect((await second.identity()).instanceId).not.toBe(one.instanceId);
		await expect(first.deviceKey()).rejects.toThrow(
			"binding-native-key-nonexportable",
		);
		const unregister = registerBindingRepositoryFactory(() => first);
		try {
			expect(defaultBindingRepository()).toBe(first);
		} finally {
			unregister();
		}
		const unregisterFailure = registerBindingRepositoryFactory(() => {
			throw Error("native-open-failed");
		});
		try {
			expect(() => defaultBindingRepository()).toThrow("native-open-failed");
		} finally {
			unregisterFailure();
		}
	});
	it("produces the existing ES256 DPoP claims and JOSE signature format through a signer only", async () => {
		const { backend } = await fixture();
		const signer = await backend.deviceSigner();
		expect("privateKey" in signer).toBe(false);
		const refresh = "R".repeat(43),
			endpoint = "https://issuer.example/api/keepany/v1/bindings/refresh";
		const proof = await createDeviceProof({
			deviceKey: signer,
			refreshToken: refresh,
			endpointUrl: endpoint,
		});
		const verified = await jwtVerify(
			proof,
			await importJWK(signer.publicJwk, "ES256"),
			{ algorithms: ["ES256"] },
		);
		expect(verified.protectedHeader).toMatchObject({
			typ: "dpop+jwt",
			jwk: signer.publicJwk,
		});
		expect(verified.payload).toMatchObject({
			htm: "POST",
			htu: endpoint,
			ath: await tokenDigest(refresh),
		});
		const resource = await createBoundResourceProof({
			deviceKey: signer,
			method: "GET",
			publicUrl: "https://sync.example/sync/pull",
			accessToken: "access-fixture",
		});
		expect(
			(await jwtVerify(resource, await importJWK(signer.publicJwk, "ES256")))
				.payload,
		).toMatchObject({
			htm: "GET",
			htu: "https://sync.example/sync/pull",
			ath: await tokenDigest("access-fixture"),
		});
	});
	it("keeps old refresh credentials on write failure, handles rotation races and revokes atomically", async () => {
		const { backend, controls } = await fixture(),
			repository = new BindingRepository("native-fixture", backend);
		const state = await boundState(repository),
			snapshot = await backend.readState();
		expect(snapshot).not.toBeNull();
		await backend.compareAndSet(snapshot?.revision ?? null, state);
		const id = state.bindings[0].bindingId,
			pending = await repository.beginRefresh(id);
		controls.fail = true;
		const update = {
			bindingId: id,
			previousToken: pending.refreshToken,
			requestId: pending.requestId,
			refreshToken: "S".repeat(43),
			expiresAt: new Date(Date.now() + 120_000).toISOString(),
		};
		await expect(repository.finishRefresh(update)).rejects.toThrow(
			"binding-native-unavailable",
		);
		expect((await repository.credential(id))?.refreshToken).toBe(
			"R".repeat(43),
		);
		await repository.finishRefresh(update);
		expect((await repository.credential(id))?.refreshToken).toBe(
			"S".repeat(43),
		);
		await expect(
			repository.finishRefresh({ ...update, refreshToken: "T".repeat(43) }),
		).rejects.toThrow("binding-refresh-race");
		controls.fail = true;
		await expect(repository.revokeLocal(id)).rejects.toThrow(
			"binding-native-unavailable",
		);
		expect(await repository.activeBinding()).toBeDefined();
		await repository.revokeLocal(id);
		expect(await repository.activeBinding()).toBeUndefined();
		expect((await backend.readState())?.state.credentials).toEqual([]);
	});
	it("rejects invalid state and bridge errors without reflecting secret response text", async () => {
		const item = await fixture();
		const backend = await createNativeBindingBackend({
			...item.plugin,
			async readState() {
				return {
					revision: crypto.randomUUID(),
					payload: '{"bindings":[],"credentials":[]}',
				};
			},
		});
		await expect(
			backend.compareAndSet(
				null,
				Object.assign(
					{ bindings: [], credentials: [] },
					{ privateKey: "secret" },
				),
			),
		).rejects.toThrow("binding-native-state");
		await expect(
			createNativeBindingBackend({
				...item.plugin,
				async initialize() {
					throw Error("raw token");
				},
			}),
		).rejects.toThrow(/^binding-native-unavailable$/);
	});
});
