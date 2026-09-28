import { calculateJwkThumbprint, SignJWT } from "jose";
import type { DeviceKey } from "./store";

export async function deviceKeyThumbprint(key: DeviceKey): Promise<string> {
	return calculateJwkThumbprint(key.publicJwk, "sha256");
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

/** Proof for a commercial refresh/state request. The private key never leaves local IndexedDB. */
export async function createDeviceProof(input: {
	deviceKey: DeviceKey;
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
	return new SignJWT({
		htm: "POST",
		htu: url.href,
		ath: await tokenDigest(input.refreshToken),
	})
		.setProtectedHeader({
			alg: "ES256",
			typ: "dpop+jwt",
			jwk: input.deviceKey.publicJwk,
		})
		.setIssuedAt()
		.setJti(crypto.randomUUID())
		.sign(input.deviceKey.privateKey);
}
