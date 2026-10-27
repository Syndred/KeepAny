import { Capacitor, registerPlugin } from "@capacitor/core";
import { z } from "zod";
import { BindingRepository } from "../../binding/src/store";
import type {
	BindingBackend,
	BindingState,
	DevicePublicJwk,
} from "../../binding/src/storage";

export interface NativeBindingPlugin {
	initialize(): Promise<void>;
	readState(): Promise<{ revision: string; payload: string }>;
	compareAndSet(input: {
		expectedRevision: string | null;
		payload: string;
	}): Promise<{ committed: boolean }>;
	publicKey(): Promise<DevicePublicJwk>;
	sign(input: {
		signingInputBase64: string;
	}): Promise<{ signatureBase64: string }>;
}
const plugin = registerPlugin<NativeBindingPlugin>("KeepAnyIdentity");
const scopes = z
	.array(z.enum(["sync:read", "sync:write"]))
	.min(1)
	.max(2)
	.refine(
		(value) =>
			value.includes("sync:read") && new Set(value).size === value.length,
	);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const timestamp = z.iso.datetime();
const stateSchema = z.strictObject({
	identity: z
		.strictObject({
			slot: z.literal("default"),
			localAccountId: z.uuid(),
			instanceId: token,
			createdAt: timestamp,
		})
		.optional(),
	pending: z
		.strictObject({
			localAccountId: z.uuid(),
			deviceCode: token,
			userCode: z.string().min(6).max(20),
			verificationUri: z.url().max(2048),
			requestedScopes: scopes,
			expiresAt: timestamp,
			nextPollAt: timestamp,
			intervalSeconds: z.number().int().min(5).max(300),
		})
		.optional(),
	bindings: z
		.array(
			z.strictObject({
				bindingId: z.uuid(),
				localAccountId: z.uuid(),
				instanceIdHash: z.string().regex(/^[0-9a-f]{64}$/),
				subject: z.string().regex(/^keepanyadm:[A-Za-z0-9_-]{1,128}$/),
				allowedScopes: scopes,
				status: z.enum(["active", "replaced", "revoked"]),
				createdAt: timestamp,
				updatedAt: timestamp,
			}),
		)
		.max(256),
	credentials: z
		.array(
			z.strictObject({
				bindingId: z.uuid(),
				refreshToken: token,
				expiresAt: timestamp,
				updatedAt: timestamp,
				pendingRequestId: token.optional(),
				pendingSince: timestamp.optional(),
			}),
		)
		.max(256),
});
function checkedState(value: unknown): BindingState {
	const result = stateSchema.safeParse(value);
	if (!result.success) throw Error("binding-native-state");
	const state = result.data;
	if (
		new Set(state.bindings.map((row) => row.bindingId)).size !==
			state.bindings.length ||
		new Set(state.credentials.map((row) => row.bindingId)).size !==
			state.credentials.length ||
		state.bindings.some(
			(row) =>
				!state.identity || row.localAccountId !== state.identity.localAccountId,
		) ||
		(state.pending &&
			state.pending.localAccountId !== state.identity?.localAccountId) ||
		state.credentials.some(
			(row) =>
				!state.bindings.some(
					(binding) =>
						binding.bindingId === row.bindingId && binding.status === "active",
				),
		)
	)
		throw Error("binding-native-state");
	return state;
}
const publicKeySchema = z.strictObject({
	kty: z.literal("EC"),
	crv: z.literal("P-256"),
	x: token,
	y: token,
});
const maxStateBytes = 256 * 1024;
function safeFailure(): Error {
	return Error("binding-native-unavailable");
}
function encode(bytes: Uint8Array) {
	return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}
function decode(signature: string): Uint8Array {
	if (
		typeof signature !== "string" ||
		signature.length !== 88 ||
		!/^[A-Za-z0-9+/]{86}==$/.test(signature)
	)
		throw Error("binding-device-signature");
	const bytes = Uint8Array.from(atob(signature), (character) =>
		character.charCodeAt(0),
	);
	if (bytes.length !== 64) throw Error("binding-device-signature");
	return bytes;
}
/** The backend never has an IndexedDB, SQL or Preferences fallback. */
export async function createNativeBindingBackend(
	bridge: NativeBindingPlugin,
): Promise<BindingBackend> {
	try {
		await bridge.initialize();
	} catch {
		throw safeFailure();
	}
	let publicJwk: DevicePublicJwk;
	try {
		publicJwk = publicKeySchema.parse(await bridge.publicKey());
	} catch {
		throw safeFailure();
	}
	const backend: BindingBackend = {
		async readState() {
			let response: Awaited<ReturnType<NativeBindingPlugin["readState"]>>;
			try {
				response = await bridge.readState();
			} catch {
				throw safeFailure();
			}
			if (
				!response ||
				typeof response.payload !== "string" ||
				new TextEncoder().encode(response.payload).length > maxStateBytes ||
				!z.uuid().safeParse(response.revision).success
			)
				throw Error("binding-native-state");
			let parsed: unknown;
			try {
				parsed = JSON.parse(response.payload);
			} catch {
				throw Error("binding-native-state");
			}
			return { revision: response.revision, state: checkedState(parsed) };
		},
		async compareAndSet(expectedRevision, state) {
			const payload = JSON.stringify(checkedState(state));
			if (new TextEncoder().encode(payload).length > maxStateBytes)
				throw Error("binding-native-state");
			try {
				const result = await bridge.compareAndSet({
					expectedRevision,
					payload,
				});
				if (typeof result?.committed !== "boolean") throw safeFailure();
				return result.committed;
			} catch {
				throw safeFailure();
			}
		},
		async deviceSigner() {
			return {
				publicJwk,
				async signES256(input) {
					if (input.length > 8192 || !input.length)
						throw Error("binding-device-signature");
					try {
						return decode(
							(await bridge.sign({ signingInputBase64: encode(input) }))
								.signatureBase64,
						);
					} catch {
						throw Error("binding-device-signature");
					}
				},
			};
		},
	};
	await backend.readState();
	return backend;
}
export async function openNativeBindingRepository(): Promise<BindingRepository> {
	const repository = createNativeBindingRepository();
	await repository.identity();
	return repository;
}

/** Register this synchronous factory at startup; experimental binding opens only on first use. */
export function createNativeBindingRepository(): BindingRepository {
	let initialized: Promise<BindingBackend> | undefined;
	const ready = () => {
		if (!initialized)
			initialized = (async () => {
				if (
					!Capacitor.isNativePlatform() ||
					!Capacitor.isPluginAvailable("KeepAnyIdentity")
				)
					throw safeFailure();
				return createNativeBindingBackend(plugin);
			})().catch((error) => {
				initialized = undefined;
				throw error;
			});
		return initialized;
	};
	return new BindingRepository("keepany-native-binding-v1", {
		async readState() {
			return (await ready()).readState();
		},
		async compareAndSet(expected, state) {
			return (await ready()).compareAndSet(expected, state);
		},
		async deviceSigner() {
			return (await ready()).deviceSigner();
		},
	});
}
