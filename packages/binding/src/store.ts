import type { JWTVerifyGetKey } from "jose";
import {
	instanceIdHash,
	newInstanceId,
	type VerifiedBinding,
	verifyBindingTicket,
} from "./ticket";
import {
	type BindingBackend,
	type BindingState,
	emptyBindingState,
	type LocalIdentity,
	type PendingBinding,
	type StoredBinding,
	type DeviceKey,
	type DeviceSigner,
} from "./storage";
export type {
	BindingCredential,
	BindingState,
	BindingBackend,
	DeviceKey,
	DeviceSigner,
	LocalIdentity,
	PendingBinding,
	StoredBinding,
} from "./storage";

/** Shared binding policy. Native and Web differ only in atomic persistence and signing. */
export class BindingRepository {
	private backendPromise?: Promise<BindingBackend>;
	constructor(
		private readonly name = "keepany-binding-v1",
		backend?: BindingBackend,
	) {
		if (backend) this.backendPromise = Promise.resolve(backend);
	}
	private backend() {
		this.backendPromise ??= import("./web-store").then(
			(module) => new module.WebBindingBackend(this.name),
		);
		return this.backendPromise;
	}
	private async state() {
		return (
			(await (await this.backend()).readState())?.state ?? emptyBindingState()
		);
	}
	private async mutate<T>(action: (state: BindingState) => T): Promise<T> {
		const backend = await this.backend();
		for (let attempt = 0; attempt < 32; attempt++) {
			const current = await backend.readState();
			const state = structuredClone(current?.state ?? emptyBindingState());
			const result = action(state);
			if (await backend.compareAndSet(current?.revision ?? null, state))
				return structuredClone(result);
		}
		throw Error("binding-write-conflict");
	}
	async identity(): Promise<LocalIdentity> {
		const existing = (await this.state()).identity;
		if (existing) return existing;
		return this.mutate(
			(state) =>
				(state.identity ??= {
					slot: "default",
					localAccountId: crypto.randomUUID(),
					instanceId: newInstanceId(),
					createdAt: new Date().toISOString(),
				}),
		);
	}
	async pendingChallenge(): Promise<PendingBinding | undefined> {
		const identity = await this.identity(),
			pending = (await this.state()).pending;
		return pending?.localAccountId === identity.localAccountId &&
			Date.parse(pending.expiresAt) > Date.now()
			? pending
			: undefined;
	}
	async deviceSigner(): Promise<DeviceSigner> {
		return (await this.backend()).deviceSigner();
	}
	/** Compatibility for existing Web consumers only; native private keys are never represented as CryptoKey. */
	async deviceKey(): Promise<DeviceKey> {
		const backend = await this.backend();
		if (!backend.legacyDeviceKey)
			throw Error("binding-native-key-nonexportable");
		return backend.legacyDeviceKey();
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
		await this.mutate((state) => {
			if (state.identity?.localAccountId !== identity.localAccountId)
				throw Error("binding-pending-identity");
			state.pending = structuredClone(value);
		});
	}
	async deferPending(deviceCode: string, seconds: number): Promise<boolean> {
		if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300)
			throw Error("binding-poll-interval");
		const identity = await this.identity();
		return this.mutate((state) => {
			const current = state.pending;
			if (
				current?.localAccountId !== identity.localAccountId ||
				current.deviceCode !== deviceCode
			)
				return false;
			current.nextPollAt = new Date(Date.now() + seconds * 1000).toISOString();
			return true;
		});
	}
	async clearPending(deviceCode: string): Promise<boolean> {
		const identity = await this.identity();
		return this.mutate((state) => {
			if (
				state.pending?.localAccountId !== identity.localAccountId ||
				state.pending.deviceCode !== deviceCode
			)
				return false;
			state.pending = undefined;
			return true;
		});
	}
	async activeBinding(): Promise<StoredBinding | undefined> {
		const identity = await this.identity(),
			hash = await instanceIdHash(identity.instanceId);
		return (await this.state()).bindings.find(
			(row) =>
				row.localAccountId === identity.localAccountId &&
				row.instanceIdHash === hash &&
				row.status === "active",
		);
	}
	async credential(bindingId: string) {
		const active = await this.activeBinding();
		if (active?.bindingId !== bindingId) return undefined;
		return (await this.state()).credentials.find(
			(row) => row.bindingId === bindingId,
		);
	}
	async beginRefresh(
		bindingId: string,
	): Promise<{ refreshToken: string; requestId: string }> {
		const active = await this.activeBinding();
		if (active?.bindingId !== bindingId) throw Error("binding-not-active");
		return this.mutate((state) => {
			const binding = state.bindings.find((row) => row.bindingId === bindingId),
				credential = state.credentials.find(
					(row) => row.bindingId === bindingId,
				);
			if (
				binding?.status !== "active" ||
				!credential ||
				Date.parse(credential.expiresAt) <= Date.now()
			)
				throw Error("binding-credential-expired");
			if (credential.pendingRequestId && credential.pendingSince) {
				if (Date.now() - Date.parse(credential.pendingSince) > 25_000)
					throw Error("binding-refresh-outcome-unknown");
				return {
					refreshToken: credential.refreshToken,
					requestId: credential.pendingRequestId,
				};
			}
			const requestId = newInstanceId();
			credential.pendingRequestId = requestId;
			credential.pendingSince = new Date().toISOString();
			return { refreshToken: credential.refreshToken, requestId };
		});
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
		)
			throw Error("binding-credential");
		await this.mutate((state) => {
			const binding = state.bindings.find(
					(row) => row.bindingId === input.bindingId,
				),
				credential = state.credentials.find(
					(row) => row.bindingId === input.bindingId,
				);
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
			)
				throw Error("binding-refresh-race");
			credential.refreshToken = input.refreshToken;
			credential.expiresAt = input.expiresAt;
			delete credential.pendingRequestId;
			delete credential.pendingSince;
			credential.updatedAt = new Date().toISOString();
		});
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
		const identity = await this.identity(),
			pending = await this.pendingChallenge();
		const existing = (await this.state()).bindings.find(
			(row) => row.bindingId === input.expectedBindingId,
		);
		const requestedScopes = pending?.requestedScopes ?? existing?.allowedScopes;
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
		return this.mutate((state) => {
			if (
				state.identity?.localAccountId !== identity.localAccountId ||
				state.identity.instanceId !== identity.instanceId
			)
				throw Error("binding-pending-identity");
			const byId = state.bindings.find(
				(row) => row.bindingId === verified.bindingId,
			);
			if (byId) {
				if (
					byId.localAccountId !== identity.localAccountId ||
					byId.instanceIdHash !== verified.instanceIdHash ||
					byId.subject !== verified.subject ||
					[...byId.allowedScopes].sort().join(" ") !==
						[...verified.allowedScopes].sort().join(" ") ||
					byId.status !== "active"
				)
					throw Error("binding-id-reused");
				if (
					credential &&
					!state.credentials.some((row) => row.bindingId === byId.bindingId)
				)
					state.credentials.push({
						bindingId: byId.bindingId,
						...credential,
						updatedAt: new Date().toISOString(),
					});
				return { status: "already-bound", binding: byId };
			}
			const current = state.pending;
			if (
				!pending ||
				!current ||
				current.localAccountId !== identity.localAccountId ||
				current.deviceCode !== pending.deviceCode ||
				Date.parse(current.expiresAt) <= Date.now()
			)
				throw Error("binding-no-challenge");
			if (
				[...current.requestedScopes].sort().join(" ") !==
				[...verified.allowedScopes].sort().join(" ")
			)
				throw Error("binding-scopes");
			const active = state.bindings.find(
				(row) =>
					row.localAccountId === identity.localAccountId &&
					row.instanceIdHash === verified.instanceIdHash &&
					row.status === "active",
			);
			if (active && active.subject !== verified.subject && !allowSwitch)
				throw Error("binding-switch-confirmation-required");
			if (active && active.subject === verified.subject)
				throw Error("binding-existing-subject");
			const now = new Date().toISOString();
			if (active) {
				active.status = "replaced";
				active.updatedAt = now;
				state.credentials = state.credentials.filter(
					(row) => row.bindingId !== active.bindingId,
				);
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
			state.bindings.push(created);
			if (credential)
				state.credentials.push({
					bindingId: created.bindingId,
					...credential,
					updatedAt: now,
				});
			state.pending = undefined;
			return { status: "created", binding: created };
		});
	}
	async revokeLocal(bindingId: string): Promise<boolean> {
		const identity = await this.identity();
		return this.mutate((state) => {
			const row = state.bindings.find((row) => row.bindingId === bindingId);
			if (
				!row ||
				row.localAccountId !== identity.localAccountId ||
				row.status !== "active"
			)
				return false;
			row.status = "revoked";
			row.updatedAt = new Date().toISOString();
			state.credentials = state.credentials.filter(
				(item) => item.bindingId !== bindingId,
			);
			return true;
		});
	}
	close(): void {
		if (this.backendPromise)
			void this.backendPromise
				.then((backend) => backend.close?.())
				.catch(() => undefined);
	}
	async deleteDatabase(): Promise<void> {
		const backend = await this.backend();
		if (!backend.deleteDatabase)
			throw Error("binding-native-reset-unavailable");
		await backend.deleteDatabase();
	}
}
const bindingGlobal = globalThis as typeof globalThis & {
	__keepanyBindingRepository?: BindingRepository;
	__keepanyBindingFactory?: () => BindingRepository;
};
export function registerBindingRepositoryFactory(
	factory: () => BindingRepository,
): () => void {
	bindingGlobal.__keepanyBindingRepository?.close();
	delete bindingGlobal.__keepanyBindingRepository;
	bindingGlobal.__keepanyBindingFactory = factory;
	return () => {
		if (bindingGlobal.__keepanyBindingFactory === factory) {
			bindingGlobal.__keepanyBindingRepository?.close();
			delete bindingGlobal.__keepanyBindingRepository;
			delete bindingGlobal.__keepanyBindingFactory;
		}
	};
}
export function defaultBindingRepository(): BindingRepository {
	bindingGlobal.__keepanyBindingRepository ??=
		bindingGlobal.__keepanyBindingFactory
			? bindingGlobal.__keepanyBindingFactory()
			: new BindingRepository();
	if (!bindingGlobal.__keepanyBindingRepository)
		throw Error("binding-platform-repository");
	return bindingGlobal.__keepanyBindingRepository;
}
