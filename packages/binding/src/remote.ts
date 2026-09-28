import type { JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { createDeviceProof, deviceKeyThumbprint } from "./proof";
import type { BindingRepository, StoredBinding } from "./store";
import {
	type BindingScope,
	bindingScopeSchema,
	validatedIssuer,
	verifyBoundAccessToken,
} from "./ticket";

const challengeSchema = z.strictObject({
	deviceCode: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	userCode: z.string().min(6).max(20),
	verificationUri: z.url(),
	expiresIn: z.number().int().min(1).max(300),
	interval: z.number().int().min(5).max(300),
});
const pollingSchema = z.discriminatedUnion("status", [
	z.strictObject({ status: z.literal("authorization_pending") }),
	z.strictObject({ status: z.literal("denied") }),
	z.strictObject({ status: z.literal("expired") }),
	z.strictObject({ status: z.literal("revoked") }),
	z.strictObject({
		status: z.literal("approved"),
		bindingId: z.uuid(),
		subject: z.string().regex(/^keepanyadm:[A-Za-z0-9_-]{1,128}$/),
		bindingTicket: z.string().min(1).max(8192),
		expiresAt: z.iso.datetime(),
		retryUntil: z.iso.datetime(),
		refreshToken: z
			.string()
			.regex(/^[A-Za-z0-9_-]{43}$/)
			.optional(),
		refreshExpiresAt: z.iso.datetime().optional(),
	}),
]);
const envelopeSchema = z.object({ code: z.literal(0), data: z.unknown() });
const refreshedSchema = z.strictObject({
	status: z.literal("active"),
	bindingId: z.uuid(),
	subject: z.string().regex(/^keepanyadm:[A-Za-z0-9_-]{1,128}$/),
	refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
	refreshExpiresAt: z.iso.datetime(),
	accessToken: z.string().min(1).max(8192),
	accessExpiresAt: z.iso.datetime(),
	tokenType: z.literal("DPoP"),
	scope: z.string().min(1),
});
const stateSchema = z.discriminatedUnion("state", [
	z.strictObject({ bindingId: z.uuid(), state: z.literal("revoked") }),
	z.strictObject({
		bindingId: z.uuid(),
		state: z.literal("credential_expired"),
	}),
	z.strictObject({
		bindingId: z.uuid(),
		subject: z.string().regex(/^keepanyadm:[A-Za-z0-9_-]{1,128}$/),
		state: z.enum(["active", "inactive", "device_limit"]),
		scopes: z.array(bindingScopeSchema),
		credentialExpiresAt: z.iso.datetime(),
		entitlements: z.unknown(),
	}),
]);

export class BindingRemoteError extends Error {
	constructor(
		readonly code: "slow_down" | "unavailable",
		readonly retryAfterSeconds = 0,
	) {
		super(code);
	}
}

// This transport belongs in the core service or an explicitly configured local bridge.
// The commercial device/poll endpoints do not grant cross-origin browser CORS.
export class BindingTransport {
	readonly issuer: string;
	constructor(
		issuer: string,
		private readonly fetcher: typeof fetch = fetch,
	) {
		this.issuer = validatedIssuer(issuer).origin;
	}

	private async post(
		path: string,
		body: unknown,
		proof?: string,
	): Promise<unknown> {
		let response: Response;
		try {
			response = await this.fetcher(new URL(path, this.issuer), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(proof ? { DPoP: proof } : {}),
				},
				body: JSON.stringify(body),
				credentials: "omit",
				cache: "no-store",
				redirect: "error",
			});
		} catch {
			throw new BindingRemoteError("unavailable");
		}
		if (response.status === 429) {
			const retry = Number(response.headers.get("Retry-After"));
			throw new BindingRemoteError(
				"slow_down",
				Number.isInteger(retry) && retry > 0 ? Math.min(retry, 300) : 5,
			);
		}
		if (!response.ok) throw new BindingRemoteError("unavailable");
		try {
			return envelopeSchema.parse(await response.json()).data;
		} catch {
			throw new BindingRemoteError("unavailable");
		}
	}

	async request(
		instanceId: string,
		instanceName: string,
		scopes: BindingScope[],
		devicePublicKey: { kty: "EC"; crv: "P-256"; x: string; y: string },
	) {
		if (
			!/^[A-Za-z0-9_-]{43}$/.test(instanceId) ||
			!instanceName.trim() ||
			instanceName.length > 80 ||
			!scopes.includes("sync:read") ||
			scopes.length > 2 ||
			new Set(scopes).size !== scopes.length ||
			!scopes.every((scope) => bindingScopeSchema.safeParse(scope).success) ||
			!/^[A-Za-z0-9_-]{43}$/.test(devicePublicKey.x) ||
			!/^[A-Za-z0-9_-]{43}$/.test(devicePublicKey.y)
		)
			throw Error("binding-request");
		const result = challengeSchema.parse(
			await this.post("/api/keepany/v1/bindings/device", {
				instanceId,
				instanceName: instanceName.trim(),
				scopes,
				devicePublicKey,
			}),
		);
		if (
			result.verificationUri !== new URL("/settings/connect", this.issuer).href
		)
			throw Error("binding-verification-uri");
		return result;
	}

	async poll(deviceCode: string): Promise<z.infer<typeof pollingSchema>> {
		if (!/^[A-Za-z0-9_-]{43}$/.test(deviceCode))
			throw Error("binding-device-code");
		return pollingSchema.parse(
			await this.post("/api/keepany/v1/bindings/poll", { deviceCode }),
		);
	}

	endpoint(
		path: "/api/keepany/v1/bindings/refresh" | "/api/keepany/v1/bindings/state",
	): string {
		return new URL(path, this.issuer).href;
	}

	async refresh(input: {
		bindingId: string;
		refreshToken: string;
		requestId: string;
		proof: string;
	}) {
		return refreshedSchema.parse(
			await this.post(
				"/api/keepany/v1/bindings/refresh",
				{
					bindingId: input.bindingId,
					refreshToken: input.refreshToken,
					requestId: input.requestId,
				},
				input.proof,
			),
		);
	}

	async state(input: {
		bindingId: string;
		refreshToken: string;
		proof: string;
	}) {
		return stateSchema.parse(
			await this.post(
				"/api/keepany/v1/bindings/state",
				{
					bindingId: input.bindingId,
					refreshToken: input.refreshToken,
				},
				input.proof,
			),
		);
	}
}

export async function readBindingState(input: {
	repository: BindingRepository;
	transport: BindingTransport;
}) {
	const binding = await input.repository.activeBinding();
	if (!binding) throw Error("binding-not-active");
	const credential = await input.repository.credential(binding.bindingId);
	if (!credential || Date.parse(credential.expiresAt) <= Date.now())
		throw Error("binding-credential-expired");
	const proof = await createDeviceProof({
		deviceKey: await input.repository.deviceKey(),
		refreshToken: credential.refreshToken,
		endpointUrl: input.transport.endpoint("/api/keepany/v1/bindings/state"),
	});
	const result = await input.transport.state({
		bindingId: binding.bindingId,
		refreshToken: credential.refreshToken,
		proof,
	});
	if (
		result.bindingId !== binding.bindingId ||
		("subject" in result && result.subject !== binding.subject)
	)
		throw Error("binding-state-mismatch");
	if (result.state === "revoked")
		await input.repository.revokeLocal(binding.bindingId);
	return result;
}

export async function refreshAndStoreBoundAccess(input: {
	repository: BindingRepository;
	transport: BindingTransport;
	keys: JWTVerifyGetKey;
}): Promise<{ accessToken: string; accessExpiresAt: string; scope: string }> {
	const binding = await input.repository.activeBinding();
	if (!binding) throw Error("binding-not-active");
	const pending = await input.repository.beginRefresh(binding.bindingId);
	const deviceKey = await input.repository.deviceKey();
	const proof = await createDeviceProof({
		deviceKey,
		refreshToken: pending.refreshToken,
		endpointUrl: input.transport.endpoint("/api/keepany/v1/bindings/refresh"),
	});
	const result = await input.transport.refresh({
		bindingId: binding.bindingId,
		refreshToken: pending.refreshToken,
		requestId: pending.requestId,
		proof,
	});
	if (
		result.bindingId !== binding.bindingId ||
		result.subject !== binding.subject
	)
		throw Error("binding-refresh-mismatch");
	const verified = await verifyBoundAccessToken({
		token: result.accessToken,
		issuer: input.transport.issuer,
		keys: input.keys,
		bindingId: binding.bindingId,
		subject: binding.subject,
		instanceIdHash: binding.instanceIdHash,
		deviceKeyThumbprint: await deviceKeyThumbprint(deviceKey),
		requiredScope: "sync:read",
	});
	if (
		verified.expiresAt * 1000 !== Date.parse(result.accessExpiresAt) ||
		[...verified.scopes].sort().join(" ") !==
			result.scope.split(" ").sort().join(" ")
	) {
		throw Error("binding-refresh-token-mismatch");
	}
	await input.repository.finishRefresh({
		bindingId: binding.bindingId,
		previousToken: pending.refreshToken,
		requestId: pending.requestId,
		refreshToken: result.refreshToken,
		expiresAt: result.refreshExpiresAt,
	});
	return {
		accessToken: result.accessToken,
		accessExpiresAt: result.accessExpiresAt,
		scope: result.scope,
	};
}

export async function startBindingChallenge(input: {
	repository: BindingRepository;
	transport: BindingTransport;
	instanceName: string;
	scopes: BindingScope[];
}): Promise<{
	userCode: string;
	verificationUri: string;
	expiresAt: string;
	interval: number;
}> {
	const identity = await input.repository.identity();
	const deviceKey = await input.repository.deviceKey();
	const result = await input.transport.request(
		identity.instanceId,
		input.instanceName,
		input.scopes,
		deviceKey.publicJwk,
	);
	const expiresAt = new Date(
		Date.now() + result.expiresIn * 1000,
	).toISOString();
	await input.repository.savePending({
		localAccountId: identity.localAccountId,
		deviceCode: result.deviceCode,
		userCode: result.userCode,
		verificationUri: result.verificationUri,
		requestedScopes: input.scopes,
		expiresAt,
		nextPollAt: new Date(Date.now() + result.interval * 1000).toISOString(),
		intervalSeconds: result.interval,
	});
	return {
		userCode: result.userCode,
		verificationUri: result.verificationUri,
		expiresAt,
		interval: result.interval,
	};
}

export type BindingPollResult =
	| { status: "wait" | "slow_down"; retryAfterSeconds: number }
	| { status: "denied" | "expired" | "revoked" }
	| { status: "created" | "already-bound"; binding: StoredBinding };

export async function pollAndConsumeBinding(input: {
	repository: BindingRepository;
	transport: BindingTransport;
	keys: JWTVerifyGetKey;
	allowSwitch?: boolean;
}): Promise<BindingPollResult> {
	const pending = await input.repository.pendingChallenge();
	if (!pending) throw Error("binding-no-challenge");
	const remaining = Math.ceil(
		(Date.parse(pending.nextPollAt) - Date.now()) / 1000,
	);
	if (remaining > 0) return { status: "wait", retryAfterSeconds: remaining };
	let result: Awaited<ReturnType<BindingTransport["poll"]>>;
	try {
		result = await input.transport.poll(pending.deviceCode);
	} catch (error) {
		if (error instanceof BindingRemoteError && error.code === "slow_down") {
			await input.repository.deferPending(
				pending.deviceCode,
				error.retryAfterSeconds,
			);
			return {
				status: "slow_down",
				retryAfterSeconds: error.retryAfterSeconds,
			};
		}
		throw error;
	}
	if (result.status === "authorization_pending") {
		await input.repository.deferPending(
			pending.deviceCode,
			pending.intervalSeconds,
		);
		return { status: "wait", retryAfterSeconds: pending.intervalSeconds };
	}
	if (result.status !== "approved") {
		await input.repository.clearPending(pending.deviceCode);
		return result;
	}
	return input.repository.consume({
		ticket: result.bindingTicket,
		issuer: input.transport.issuer,
		keys: input.keys,
		expectedBindingId: result.bindingId,
		expectedSubject: result.subject,
		refreshToken: result.refreshToken,
		refreshExpiresAt: result.refreshExpiresAt,
		allowSwitch: input.allowSwitch,
	});
}
