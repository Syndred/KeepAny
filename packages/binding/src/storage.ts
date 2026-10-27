import type { BindingScope } from "./ticket";
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

export type DevicePublicJwk = DeviceKey["publicJwk"];
export interface DeviceSigner {
	publicJwk: DevicePublicJwk;
	signES256(input: Uint8Array): Promise<Uint8Array>;
}
export interface BindingState {
	identity?: LocalIdentity;
	pending?: PendingBinding;
	bindings: StoredBinding[];
	credentials: BindingCredential[];
}
export interface BindingSnapshot {
	revision: string;
	state: BindingState;
}
export interface BindingBackend {
	readState(): Promise<BindingSnapshot | null>;
	compareAndSet(
		expectedRevision: string | null,
		state: BindingState,
	): Promise<boolean>;
	deviceSigner(): Promise<DeviceSigner>;
	legacyDeviceKey?(): Promise<DeviceKey>;
	close?(): void;
	deleteDatabase?(): Promise<void>;
}
export const emptyBindingState = (): BindingState => ({
	bindings: [],
	credentials: [],
});
