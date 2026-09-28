import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { z } from "zod";

export const BINDING_AUDIENCE = "keepany-binding";
export const BOUND_SYNC_AUDIENCE = "keepany-sync-bound";
export const BINDING_MAX_AGE_SECONDS = 60;
export const bindingScopeSchema = z.enum(["sync:read", "sync:write"]);
export type BindingScope = z.infer<typeof bindingScopeSchema>;

const claimsSchema = z.object({
	sub: z.string().regex(/^keepanyadm:[A-Za-z0-9_-]{1,128}$/),
	scope: z.literal("binding:complete"),
	binding_id: z.uuid(),
	instance_id_hash: z.string().regex(/^[0-9a-f]{64}$/),
	allowed_scopes: z.array(bindingScopeSchema).min(1).max(2),
	iat: z.number().int().positive(),
	exp: z.number().int().positive(),
	jti: z.uuid(),
});

export interface VerifiedBinding {
	bindingId: string;
	subject: string;
	instanceIdHash: string;
	allowedScopes: BindingScope[];
	issuedAt: number;
	expiresAt: number;
}

export function validatedIssuer(value: string): URL {
	const url = new URL(value);
	if (
		url.origin !== value ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw Error("binding-issuer");
	if (
		url.protocol !== "https:" &&
		!(
			url.protocol === "http:" &&
			["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
		)
	) {
		throw Error("binding-issuer");
	}
	return url;
}

// Call with deployment-fixed issuer, never with a URL supplied by the challenge or ticket.
export function remoteBindingKeys(issuer: string): JWTVerifyGetKey {
	const url = validatedIssuer(issuer);
	return createRemoteJWKSet(new URL("/.well-known/jwks.json", url), {
		cacheMaxAge: 30_000,
		cooldownDuration: 5_000,
		timeoutDuration: 5_000,
	});
}

export async function instanceIdHash(instanceId: string): Promise<string> {
	if (!/^[A-Za-z0-9_-]{43}$/.test(instanceId))
		throw Error("binding-instance-id");
	const bytes = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(instanceId)),
	);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

export function newInstanceId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export async function verifyBindingTicket(input: {
	ticket: string;
	issuer: string;
	keys: JWTVerifyGetKey;
	instanceId: string;
	requestedScopes: BindingScope[];
	expectedBindingId?: string;
	expectedSubject?: string;
}): Promise<VerifiedBinding> {
	validatedIssuer(input.issuer);
	if (input.ticket.length > 8192) throw Error("binding-ticket-size");
	const { payload, protectedHeader } = await jwtVerify(
		input.ticket,
		input.keys,
		{
			issuer: input.issuer,
			audience: BINDING_AUDIENCE,
			algorithms: ["RS256"],
			typ: "JWT",
			maxTokenAge: BINDING_MAX_AGE_SECONDS,
			requiredClaims: [
				"sub",
				"jti",
				"iat",
				"exp",
				"scope",
				"binding_id",
				"instance_id_hash",
				"allowed_scopes",
			],
		},
	);
	if (
		protectedHeader.alg !== "RS256" ||
		typeof protectedHeader.kid !== "string" ||
		!protectedHeader.kid
	)
		throw Error("binding-header");
	const claims = claimsSchema.parse(payload);
	if (
		claims.exp <= claims.iat ||
		claims.exp - claims.iat > BINDING_MAX_AGE_SECONDS
	)
		throw Error("binding-lifetime");
	if (
		new Set(claims.allowed_scopes).size !== claims.allowed_scopes.length ||
		!claims.allowed_scopes.includes("sync:read")
	)
		throw Error("binding-scopes");
	const requested = [...new Set(input.requestedScopes)].sort();
	if (
		requested.length !== input.requestedScopes.length ||
		requested.join(" ") !== [...claims.allowed_scopes].sort().join(" ")
	)
		throw Error("binding-scopes");
	if (claims.instance_id_hash !== (await instanceIdHash(input.instanceId)))
		throw Error("binding-instance-mismatch");
	if (input.expectedBindingId && claims.binding_id !== input.expectedBindingId)
		throw Error("binding-id-mismatch");
	if (input.expectedSubject && claims.sub !== input.expectedSubject)
		throw Error("binding-subject-mismatch");
	return {
		bindingId: claims.binding_id,
		subject: claims.sub,
		instanceIdHash: claims.instance_id_hash,
		allowedScopes: claims.allowed_scopes,
		issuedAt: claims.iat,
		expiresAt: claims.exp,
	};
}

export async function verifyBoundAccessToken(input: {
	token: string;
	issuer: string;
	keys: JWTVerifyGetKey;
	bindingId: string;
	subject: string;
	instanceIdHash: string;
	deviceKeyThumbprint: string;
	requiredScope: BindingScope;
}): Promise<{ expiresAt: number; scopes: BindingScope[] }> {
	validatedIssuer(input.issuer);
	if (input.token.length > 8192) throw Error("binding-access-token-size");
	const { payload, protectedHeader } = await jwtVerify(
		input.token,
		input.keys,
		{
			issuer: input.issuer,
			audience: BOUND_SYNC_AUDIENCE,
			algorithms: ["RS256"],
			typ: "JWT",
			maxTokenAge: BINDING_MAX_AGE_SECONDS,
			requiredClaims: [
				"sub",
				"jti",
				"iat",
				"exp",
				"binding_id",
				"instance_id_hash",
				"cnf",
				"scope",
			],
		},
	);
	if (
		protectedHeader.alg !== "RS256" ||
		typeof protectedHeader.kid !== "string" ||
		!protectedHeader.kid
	)
		throw Error("binding-access-header");
	const claims = z
		.object({
			sub: z.string(),
			binding_id: z.uuid(),
			instance_id_hash: z.string(),
			cnf: z.object({ jkt: z.string() }),
			scope: z.string(),
			iat: z.number().int().positive(),
			exp: z.number().int().positive(),
			jti: z.uuid(),
			entitlements_version: z.literal(1),
		})
		.parse(payload);
	if (
		claims.exp <= claims.iat ||
		claims.exp - claims.iat > BINDING_MAX_AGE_SECONDS
	)
		throw Error("binding-access-lifetime");
	if (
		claims.sub !== input.subject ||
		claims.binding_id !== input.bindingId ||
		claims.instance_id_hash !== input.instanceIdHash ||
		claims.cnf.jkt !== input.deviceKeyThumbprint
	) {
		throw Error("binding-access-identity");
	}
	const parts = claims.scope.split(" ");
	const scopes = parts.map((part) => bindingScopeSchema.parse(part));
	if (
		new Set(scopes).size !== scopes.length ||
		!scopes.includes(input.requiredScope)
	)
		throw Error("binding-access-scope");
	return { expiresAt: claims.exp, scopes };
}
