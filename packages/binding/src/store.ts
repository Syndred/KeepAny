import Dexie, { type Table } from "dexie";
import type { JWTVerifyGetKey } from "jose";
import {
	type BindingScope,
	instanceIdHash,
	newInstanceId,
	type VerifiedBinding,
	verifyBindingTicket,
} from "./ticket";

export interface LocalIdentity {
	slot: "default";
	localAccountId: string;
	instanceId: string;
	createdAt: string;
}
export interface PendingBinding {
	localAccountId: string;
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	requestedScopes: BindingScope[];
	expiresAt: string;
	nextPollAt: string;
	intervalSeconds: number;
}
export interface DeviceKey {
	slot: "default";
	privateKey: CryptoKey;
	publicJwk: { kty: "EC"; crv: "P-256"; x: string; y: string };
}
export interface BindingCredential {
	bindingId: string;
	refreshToken: string;
	expiresAt: string;
	updatedAt: string;
	pendingRequestId?: string;
	pendingSince?: string;
}
export interface StoredBinding {
	bindingId: string;
	localAccountId: string;
	instanceIdHash: string;
	subject: string;
	allowedScopes: BindingScope[];
	status: "active" | "replaced" | "revoked";
	createdAt: string;
	updatedAt: string;
}

class BindingDatabase extends Dexie {
	identities!: Table<LocalIdentity, string>;
	pending!: Table<PendingBinding, string>;
	bindings!: Table<StoredBinding, string>;
	deviceKeys!: Table<DeviceKey, string>;
	credentials!: Table<BindingCredential, string>;
	constructor(name: string) {
		super(name);
		this.version(1).stores({
			identities: "slot",
			pending: "localAccountId",
			bindings: "bindingId, localAccountId, instanceIdHash, subject, status",
		});
		this.version(2).stores({
			identities: "slot",
			pending: "localAccountId",
			bindings: "bindingId, localAccountId, instanceIdHash, subject, status",
			deviceKeys: "slot",
			credentials: "bindingId",
		});
	}
}

export class BindingRepository {
	private readonly db: BindingDatabase;
	constructor(name = "keepany-binding-v1") {
		this.db = new BindingDatabase(name);
	}

	async identity(): Promise<LocalIdentity> {
		return this.db.transaction("rw", this.db.identities, async () => {
			const existing = await this.db.identities.get("default");
			if (existing) return existing;
			const created: LocalIdentity = {
				slot: "default",
				localAccountId: crypto.randomUUID(),
				instanceId: newInstanceId(),
				createdAt: new Date().toISOString(),
			};
			await this.db.identities.add(created);
			return created;
		});
	}

	async pendingChallenge(): Promise<PendingBinding | undefined> {
		const identity = await this.identity();
		const pending = await this.db.pending.get(identity.localAccountId);
		if (!pending || Date.parse(pending.expiresAt) <= Date.now())
			return undefined;
		return pending;
	}

	async deviceKey(): Promise<DeviceKey> {
		const saved = await this.db.deviceKeys.get("default");
		if (saved) return saved;
		const pair = await crypto.subtle.generateKey(
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["sign", "verify"],
		);
		const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
		if (
			exported.kty !== "EC" ||
			exported.crv !== "P-256" ||
			!exported.x ||
			!exported.y
		)
			throw Error("binding-device-key");
		const proposed: DeviceKey = {
			slot: "default",
			privateKey: pair.privateKey,
			publicJwk: { kty: "EC", crv: "P-256", x: exported.x, y: exported.y },
		};
		return this.db.transaction("rw", this.db.deviceKeys, async () => {
			const current = await this.db.deviceKeys.get("default");
			if (current) return current;
			await this.db.deviceKeys.add(proposed);
			return proposed;
		});
	}

	async savePending(value: PendingBinding): Promise<void> {
		const identity = await this.identity();
		if (
			value.localAccountId !== identity.localAccountId ||
			!/^[A-Za-z0-9_-]{43}$/.test(value.deviceCode)
		)
			throw Error("binding-pending-identity");
		if (
			!value.requestedScopes.includes("sync:read") ||
			new Set(value.requestedScopes).size !== value.requestedScopes.length
		)
			throw Error("binding-pending-scopes");
		if (Date.parse(value.expiresAt) <= Date.now())
			throw Error("binding-pending-expired");
		if (
			!Number.isInteger(value.intervalSeconds) ||
			value.intervalSeconds < 5 ||
			value.intervalSeconds > 300
		)
			throw Error("binding-poll-interval");
		await this.db.pending.put(value);
	}

	async deferPending(deviceCode: string, seconds: number): Promise<boolean> {
		const identity = await this.identity();
		if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300)
			throw Error("binding-poll-interval");
		return this.db.transaction("rw", this.db.pending, async () => {
			const current = await this.db.pending.get(identity.localAccountId);
			if (!current || current.deviceCode !== deviceCode) return false;
			await this.db.pending.update(identity.localAccountId, {
				nextPollAt: new Date(Date.now() + seconds * 1000).toISOString(),
			});
			return true;
		});
	}

	async clearPending(deviceCode: string): Promise<boolean> {
		const identity = await this.identity();
		return this.db.transaction("rw", this.db.pending, async () => {
			const current = await this.db.pending.get(identity.localAccountId);
			if (!current || current.deviceCode !== deviceCode) return false;
			await this.db.pending.delete(identity.localAccountId);
			return true;
		});
	}

	async activeBinding(): Promise<StoredBinding | undefined> {
		const identity = await this.identity();
		const hash = await instanceIdHash(identity.instanceId);
		const rows = await this.db.bindings
			.where("localAccountId")
			.equals(identity.localAccountId)
			.toArray();
		return rows.find(
			(row) => row.instanceIdHash === hash && row.status === "active",
		);
	}

	async credential(bindingId: string): Promise<BindingCredential | undefined> {
		const active = await this.activeBinding();
		if (!active || active.bindingId !== bindingId) return undefined;
		return this.db.credentials.get(bindingId);
	}

	async beginRefresh(
		bindingId: string,
	): Promise<{ refreshToken: string; requestId: string }> {
		const active = await this.activeBinding();
		if (!active || active.bindingId !== bindingId)
			throw Error("binding-not-active");
		return this.db.transaction(
			"rw",
			this.db.bindings,
			this.db.credentials,
			async () => {
				const latest = await this.db.bindings.get(bindingId);
				const credential = await this.db.credentials.get(bindingId);
				if (
					latest?.status !== "active" ||
					!credential ||
					Date.parse(credential.expiresAt) <= Date.now()
				) {
					throw Error("binding-credential-expired");
				}
				if (credential.pendingRequestId && credential.pendingSince) {
					if (Date.now() - Date.parse(credential.pendingSince) > 25_000)
						throw Error("binding-refresh-outcome-unknown");
					return {
						refreshToken: credential.refreshToken,
						requestId: credential.pendingRequestId,
					};
				}
				const requestId = newInstanceId();
				await this.db.credentials.update(bindingId, {
					pendingRequestId: requestId,
					pendingSince: new Date().toISOString(),
				});
				return { refreshToken: credential.refreshToken, requestId };
			},
		);
	}

	async finishRefresh(input: {
		bindingId: string;
		previousToken: string;
		requestId: string;
		refreshToken: string;
		expiresAt: string;
	}): Promise<void> {
		if (
			!/^[A-Za-z0-9_-]{43}$/.test(input.refreshToken) ||
			Date.parse(input.expiresAt) <= Date.now()
		) {
			throw Error("binding-credential");
		}
		await this.db.transaction(
			"rw",
			this.db.bindings,
			this.db.credentials,
			async () => {
				const binding = await this.db.bindings.get(input.bindingId);
				const credential = await this.db.credentials.get(input.bindingId);
				if (binding?.status !== "active" || !credential)
					throw Error("binding-not-active");
				if (
					credential.refreshToken === input.refreshToken &&
					!credential.pendingRequestId
				)
					return;
				if (
					credential.refreshToken !== input.previousToken ||
					credential.pendingRequestId !== input.requestId
				) {
					throw Error("binding-refresh-race");
				}
				await this.db.credentials.update(input.bindingId, {
					refreshToken: input.refreshToken,
					expiresAt: input.expiresAt,
					pendingRequestId: undefined,
					pendingSince: undefined,
					updatedAt: new Date().toISOString(),
				});
			},
		);
	}

	async consume(input: {
		ticket: string;
		issuer: string;
		keys: JWTVerifyGetKey;
		expectedBindingId: string;
		expectedSubject: string;
		refreshToken?: string;
		refreshExpiresAt?: string;
		allowSwitch?: boolean;
	}): Promise<{ status: "created" | "already-bound"; binding: StoredBinding }> {
		const identity = await this.identity();
		const pending = await this.pendingChallenge();
		const existingId = input.expectedBindingId
			? await this.db.bindings.get(input.expectedBindingId)
			: undefined;
		const requestedScopes =
			pending?.requestedScopes ?? existingId?.allowedScopes;
		if (!requestedScopes) throw Error("binding-no-challenge");
		const verified = await verifyBindingTicket({
			ticket: input.ticket,
			issuer: input.issuer,
			keys: input.keys,
			instanceId: identity.instanceId,
			requestedScopes,
			expectedBindingId: input.expectedBindingId,
			expectedSubject: input.expectedSubject,
		});
		if (
			input.refreshToken !== undefined ||
			input.refreshExpiresAt !== undefined
		) {
			if (
				!input.refreshToken ||
				!/^[A-Za-z0-9_-]{43}$/.test(input.refreshToken) ||
				!input.refreshExpiresAt ||
				Date.parse(input.refreshExpiresAt) <= Date.now()
			)
				throw Error("binding-credential");
		}
		return this.commitVerified(
			verified,
			identity,
			pending,
			input.allowSwitch === true,
			input.refreshToken && input.refreshExpiresAt
				? {
						refreshToken: input.refreshToken,
						expiresAt: input.refreshExpiresAt,
					}
				: undefined,
		);
	}

	private async commitVerified(
		verified: VerifiedBinding,
		identity: LocalIdentity,
		pending: PendingBinding | undefined,
		allowSwitch: boolean,
		credential?: { refreshToken: string; expiresAt: string },
	): Promise<{ status: "created" | "already-bound"; binding: StoredBinding }> {
		return this.db.transaction(
			"rw",
			this.db.bindings,
			this.db.pending,
			this.db.credentials,
			async () => {
				const byId = await this.db.bindings.get(verified.bindingId);
				if (byId) {
					if (
						byId.localAccountId !== identity.localAccountId ||
						byId.instanceIdHash !== verified.instanceIdHash ||
						byId.subject !== verified.subject ||
						[...byId.allowedScopes].sort().join(" ") !==
							[...verified.allowedScopes].sort().join(" ") ||
						byId.status !== "active"
					) {
						throw Error("binding-id-reused");
					}
					if (credential && !(await this.db.credentials.get(byId.bindingId))) {
						await this.db.credentials.add({
							bindingId: byId.bindingId,
							...credential,
							updatedAt: new Date().toISOString(),
						});
					}
					return { status: "already-bound" as const, binding: byId };
				}
				// A new binding can only complete the locally stored, unexpired challenge.
				const currentPending = await this.db.pending.get(
					identity.localAccountId,
				);
				if (
					!pending ||
					!currentPending ||
					currentPending.deviceCode !== pending.deviceCode ||
					Date.parse(currentPending.expiresAt) <= Date.now()
				)
					throw Error("binding-no-challenge");
				if (
					[...currentPending.requestedScopes].sort().join(" ") !==
					[...verified.allowedScopes].sort().join(" ")
				)
					throw Error("binding-scopes");
				const rows = await this.db.bindings
					.where("localAccountId")
					.equals(identity.localAccountId)
					.toArray();
				const active = rows.find(
					(row) =>
						row.instanceIdHash === verified.instanceIdHash &&
						row.status === "active",
				);
				if (active && active.subject !== verified.subject && !allowSwitch)
					throw Error("binding-switch-confirmation-required");
				if (active && active.subject === verified.subject)
					throw Error("binding-existing-subject");
				const now = new Date().toISOString();
				if (active) {
					await this.db.bindings.update(active.bindingId, {
						status: "replaced",
						updatedAt: now,
					});
					await this.db.credentials.delete(active.bindingId);
				}
				const created: StoredBinding = {
					bindingId: verified.bindingId,
					localAccountId: identity.localAccountId,
					instanceIdHash: verified.instanceIdHash,
					subject: verified.subject,
					allowedScopes: verified.allowedScopes,
					status: "active",
					createdAt: now,
					updatedAt: now,
				};
				await this.db.bindings.add(created);
				if (credential)
					await this.db.credentials.add({
						bindingId: created.bindingId,
						...credential,
						updatedAt: now,
					});
				await this.db.pending.delete(identity.localAccountId);
				return { status: "created" as const, binding: created };
			},
		);
	}

	async revokeLocal(bindingId: string): Promise<boolean> {
		const identity = await this.identity();
		return this.db.transaction(
			"rw",
			this.db.bindings,
			this.db.credentials,
			async () => {
				const row = await this.db.bindings.get(bindingId);
				if (
					!row ||
					row.localAccountId !== identity.localAccountId ||
					row.status !== "active"
				)
					return false;
				await this.db.bindings.update(bindingId, {
					status: "revoked",
					updatedAt: new Date().toISOString(),
				});
				await this.db.credentials.delete(bindingId);
				return true;
			},
		);
	}

	close(): void {
		this.db.close();
	}
	async deleteDatabase(): Promise<void> {
		this.db.close();
		await Dexie.delete(this.db.name);
	}
}

const bindingGlobal = globalThis as typeof globalThis & {
	__keepanyBindingRepository?: BindingRepository;
};
export function defaultBindingRepository(): BindingRepository {
	if (!bindingGlobal.__keepanyBindingRepository)
		bindingGlobal.__keepanyBindingRepository = new BindingRepository();
	return bindingGlobal.__keepanyBindingRepository;
}
