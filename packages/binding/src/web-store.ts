import Dexie, { type Table } from "dexie";
import type {
	BindingBackend,
	BindingCredential,
	BindingSnapshot,
	BindingState,
	DeviceKey,
	LocalIdentity,
	PendingBinding,
	StoredBinding,
} from "./storage";
class BindingDatabase extends Dexie {
	identities!: Table<LocalIdentity, string>;
	pending!: Table<PendingBinding, string>;
	bindings!: Table<StoredBinding, string>;
	deviceKeys!: Table<DeviceKey, string>;
	credentials!: Table<BindingCredential, string>;
	metadata!: Table<{ slot: string; revision: string }, string>;
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
		this.version(3).stores({
			identities: "slot",
			pending: "localAccountId",
			bindings: "bindingId, localAccountId, instanceIdHash, subject, status",
			deviceKeys: "slot",
			credentials: "bindingId",
			metadata: "slot",
		});
	}
}

export class WebBindingBackend implements BindingBackend {
	private readonly db: BindingDatabase;
	constructor(name: string) {
		this.db = new BindingDatabase(name);
	}
	private async ensureRevision() {
		await this.db.transaction("rw", this.db.metadata, async () => {
			if (!(await this.db.metadata.get("default")))
				await this.db.metadata.add({
					slot: "default",
					revision: crypto.randomUUID(),
				});
		});
	}
	async readState(): Promise<BindingSnapshot> {
		await this.ensureRevision();
		return this.db.transaction(
			"r",
			[
				this.db.identities,
				this.db.pending,
				this.db.bindings,
				this.db.credentials,
				this.db.metadata,
			],
			async () => {
				const identity = await this.db.identities.get("default");
				const metadata = await this.db.metadata.get("default");
				if (!metadata) throw Error("binding-storage-revision");
				return {
					revision: metadata.revision,
					state: {
						identity,
						pending: identity
							? await this.db.pending.get(identity.localAccountId)
							: undefined,
						bindings: await this.db.bindings.toArray(),
						credentials: await this.db.credentials.toArray(),
					},
				};
			},
		);
	}
	async compareAndSet(
		expectedRevision: string | null,
		state: BindingState,
	): Promise<boolean> {
		await this.ensureRevision();
		return this.db.transaction(
			"rw",
			[
				this.db.identities,
				this.db.pending,
				this.db.bindings,
				this.db.credentials,
				this.db.metadata,
			],
			async () => {
				if (
					(await this.db.metadata.get("default"))?.revision !== expectedRevision
				)
					return false;
				await this.db.identities.clear();
				await this.db.pending.clear();
				await this.db.bindings.clear();
				await this.db.credentials.clear();
				if (state.identity) await this.db.identities.put(state.identity);
				if (state.pending) await this.db.pending.put(state.pending);
				await this.db.bindings.bulkPut(state.bindings);
				await this.db.credentials.bulkPut(state.credentials);
				await this.db.metadata.put({
					slot: "default",
					revision: crypto.randomUUID(),
				});
				return true;
			},
		);
	}
	async legacyDeviceKey(): Promise<DeviceKey> {
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

	async deviceSigner() {
		const key = await this.legacyDeviceKey();
		return {
			publicJwk: key.publicJwk,
			signES256: async (input: Uint8Array) =>
				new Uint8Array(
					await crypto.subtle.sign(
						{ name: "ECDSA", hash: "SHA-256" },
						key.privateKey,
						new Uint8Array(input),
					),
				),
		};
	}
	close() {
		this.db.close();
	}
	async deleteDatabase() {
		this.db.close();
		await Dexie.delete(this.db.name);
	}
}
