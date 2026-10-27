import { base64url, calculateJwkThumbprint, SignJWT } from "jose";
import type { DeviceKey, DeviceSigner } from "./storage";

export async function deviceKeyThumbprint(
	key: Pick<DeviceKey, "publicJwk">,
): Promise<string> {
	return calculateJwkThumbprint(key.publicJwk, "sha256");
}

async function signProof(
	key: DeviceKey | DeviceSigner,
	claims: Record<string, string>,
) {
	const header = { alg: "ES256", typ: "dpop+jwt", jwk: key.publicJwk };
	const payload = {
		...claims,
		iat: Math.floor(Date.now() / 1000),
		jti: crypto.randomUUID(),
	};
	if (!("signES256" in key))
		return new SignJWT(payload).setProtectedHeader(header).sign(key.privateKey);
	const encoder = new TextEncoder();
	const signingInput = `${base64url.encode(encoder.encode(JSON.stringify(header)))}.${base64url.encode(encoder.encode(JSON.stringify(payload)))}`;
	const signature = await key.signES256(encoder.encode(signingInput));
	if (!(signature instanceof Uint8Array) || signature.length !== 64)
		throw Error("binding-device-signature");
	return `${signingInput}.${base64url.encode(signature)}`;
}

export async function tokenDigest(token: string): Promise<string> {
	const hash = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
	);
	return btoa(String.fromCharCode(...hash))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** Proof for a commercial refresh/state request. Private signing stays in its platform owner. */
export async function createDeviceProof(input: {
	deviceKey: DeviceKey | DeviceSigner;
	endpointUrl: string;
	refreshToken: string;
}): Promise<string> {
	const url = new URL(input.endpointUrl);
	if (
		url.search ||
		url.hash ||
		(url.protocol !== "https:" &&
			!(
				url.protocol === "http:" &&
				["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
			))
	) {
		throw Error("binding-proof-url");
	}
	if (!/^[A-Za-z0-9_-]{43}$/.test(input.refreshToken))
		throw Error("binding-refresh-token");
	return signProof(input.deviceKey, {
		htm: "POST",
		htu: url.href,
		ath: await tokenDigest(input.refreshToken),
	});
}

/** A fresh sender-constrained proof for one fixed-origin bound sync request. */
export async function createBoundResourceProof(input: {
	deviceKey: DeviceKey | DeviceSigner;
	method: "GET" | "POST" | "PUT";
	publicUrl: string;
	accessToken: string;
}): Promise<string> {
	const url = new URL(input.publicUrl);
	if (
		!(["GET", "POST", "PUT"] as string[]).includes(input.method) ||
		input.publicUrl.includes("?") ||
		input.publicUrl.includes("#") ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		(url.protocol !== "https:" &&
			!(
				url.protocol === "http:" &&
				["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
			)) ||
		!url.pathname.startsWith("/") ||
		!input.accessToken ||
		input.accessToken.length > 8192
	) {
		throw Error("binding-resource-proof");
	}
	return signProof(input.deviceKey, {
		htm: input.method,
		htu: `${url.origin}${url.pathname}`,
		ath: await tokenDigest(input.accessToken),
	});
}
