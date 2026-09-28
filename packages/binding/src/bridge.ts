import { createRemoteJWKSet, customFetch } from "jose";
import { validatedIssuer } from "./ticket";

const allowedPaths = new Set([
	"/api/keepany/v1/bindings/device",
	"/api/keepany/v1/bindings/poll",
	"/api/keepany/v1/bindings/refresh",
	"/api/keepany/v1/bindings/state",
	"/.well-known/jwks.json",
]);

function fixedBridgeOrigin(value: string): string {
	const url = new URL(value);
	if (
		url.origin !== value ||
		url.protocol !== "http:" ||
		!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
		!url.port ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw Error("binding-bridge-origin");
	return url.origin;
}

/** Keeps all protocol URLs on the pinned issuer while routing the network hop locally. */
export function createBindingBridgeFetch(
	issuer: string,
	bridgeOrigin: string,
	fetcher: typeof fetch = fetch,
): typeof fetch {
	const expectedIssuer = validatedIssuer(issuer).origin;
	const bridge = fixedBridgeOrigin(bridgeOrigin);
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (
			url.origin !== expectedIssuer ||
			!allowedPaths.has(url.pathname) ||
			url.search ||
			url.hash
		)
			throw Error("binding-bridge-path");
		const method = init?.method ?? "GET";
		if (
			(url.pathname === "/.well-known/jwks.json" && method !== "GET") ||
			(url.pathname !== "/.well-known/jwks.json" && method !== "POST")
		)
			throw Error("binding-bridge-method");
		const supplied = new Headers(init?.headers);
		const headers = new Headers();
		if (method === "POST") headers.set("Content-Type", "application/json");
		if (supplied.has("DPoP")) headers.set("DPoP", supplied.get("DPoP") ?? "");
		return fetcher(new URL(url.pathname, bridge), {
			method,
			headers,
			body: init?.body,
			credentials: "omit",
			cache: "no-store",
			redirect: "error",
			signal: init?.signal,
		});
	}) as typeof fetch;
}

export function bridgeBindingKeys(
	issuer: string,
	bridgeOrigin: string,
	fetcher: typeof fetch = fetch,
) {
	const validated = validatedIssuer(issuer);
	const mappedFetch = createBindingBridgeFetch(issuer, bridgeOrigin, fetcher);
	return createRemoteJWKSet(new URL("/.well-known/jwks.json", validated), {
		cacheMaxAge: 30_000,
		cooldownDuration: 5_000,
		timeoutDuration: 5_000,
		[customFetch]: (url, options) =>
			mappedFetch(url, {
				method: options.method,
				signal: options.signal,
			}),
	});
}
