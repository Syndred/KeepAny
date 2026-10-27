import type { JWTVerifyGetKey } from "jose";
import { createBoundResourceProof } from "./proof";
import { type BindingTransport, refreshAndStoreBoundAccess } from "./remote";
import type { BindingRepository, StoredBinding } from "./store";
import { validatedIssuer } from "./ticket";

export interface BoundSyncAccess {
	readonly accountId: string;
	readonly bindingId: string;
	readonly subject: string;
	/** Recheck the exact local binding after each network response, before queue writes. */
	assertCurrent(): Promise<void>;
	/** The proof and access token are created for this one resource request only. */
	headers(
		method: "GET" | "POST" | "PUT",
		publicUrl: string,
	): Promise<Record<"Authorization" | "DPoP", string>>;
}

const resourcePaths = new Set([
	"/sync/identity",
	"/sync/devices",
	"/sync/preflight",
	"/sync/push",
	"/sync/pull",
	"/workspaces",
]);
const attachmentPath =
	/^\/workspaces\/[0-9a-f-]{36}\/attachments\/[0-9a-f-]{36}$/i;

function sameScopes(
	left: StoredBinding["allowedScopes"],
	right: StoredBinding["allowedScopes"],
): boolean {
	return [...left].sort().join(" ") === [...right].sort().join(" ");
}

/** Keeps a verified access token in this closure only; the repository stores refresh credentials. */
export async function createBoundSyncAccess(input: {
	repository: BindingRepository;
	transport: BindingTransport;
	keys: JWTVerifyGetKey;
	resourceOrigin: string;
}): Promise<BoundSyncAccess> {
	const resourceOrigin = validatedIssuer(input.resourceOrigin).origin;
	const original = await input.repository.activeBinding();
	if (!original) throw Error("binding-not-active");
	if (
		!original.allowedScopes.includes("sync:read") ||
		!original.allowedScopes.includes("sync:write")
	)
		throw Error("binding-access-scope");
	if (!(await input.repository.credential(original.bindingId)))
		throw Error("binding-credential-expired");

	let cached: { token: string; usableUntil: number } | undefined;
	let refreshing: Promise<void> | undefined;
	const assertCurrent = async () => {
		const current = await input.repository.activeBinding();
		if (
			!current ||
			current.bindingId !== original.bindingId ||
			current.localAccountId !== original.localAccountId ||
			current.instanceIdHash !== original.instanceIdHash ||
			current.subject !== original.subject ||
			!sameScopes(current.allowedScopes, original.allowedScopes)
		)
			throw Error("binding-not-active");
		const credential = await input.repository.credential(original.bindingId);
		if (!credential || Date.parse(credential.expiresAt) <= Date.now())
			throw Error("binding-credential-expired");
	};
	const accessToken = async (): Promise<string> => {
		await assertCurrent();
		if (cached && Date.now() < cached.usableUntil) return cached.token;
		if (!refreshing) {
			refreshing = (async () => {
				const result = await refreshAndStoreBoundAccess({
					repository: input.repository,
					transport: input.transport,
					keys: input.keys,
					requiredScope: "sync:write",
				});
				if (!result.scope.split(" ").includes("sync:read"))
					throw Error("binding-access-scope");
				await assertCurrent();
				const usableUntil =
					Math.min(Date.parse(result.accessExpiresAt), Date.now() + 60_000) -
					5_000;
				if (usableUntil <= Date.now()) throw Error("binding-access-expired");
				cached = { token: result.accessToken, usableUntil };
			})().finally(() => {
				refreshing = undefined;
			});
		}
		await refreshing;
		await assertCurrent();
		if (!cached || Date.now() >= cached.usableUntil)
			throw Error("binding-access-expired");
		return cached.token;
	};
	return {
		accountId: original.subject,
		bindingId: original.bindingId,
		subject: original.subject,
		assertCurrent,
		async headers(method, publicUrl) {
			if (method !== "GET" && method !== "POST" && method !== "PUT")
				throw Error("binding-resource-method");
			const url = new URL(publicUrl);
			if (
				url.origin !== resourceOrigin ||
				publicUrl.includes("?") ||
				publicUrl.includes("#") ||
				url.username ||
				url.password ||
				url.search ||
				url.hash ||
				!(resourcePaths.has(url.pathname) || attachmentPath.test(url.pathname))
			)
				throw Error("binding-resource-url");
			const token = await accessToken();
			const proof = await createBoundResourceProof({
				deviceKey: await input.repository.deviceSigner(),
				method,
				publicUrl: url.href,
				accessToken: token,
			});
			await assertCurrent();
			return { Authorization: `DPoP ${token}`, DPoP: proof };
		},
	};
}
