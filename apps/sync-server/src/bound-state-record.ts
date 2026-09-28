export type BoundStateStatus = 'active' | 'inactive' | 'device_limit' | 'credential_expired' | 'revoked';

// Only a successfully verified commercial assertion may be converted to this value.
export interface VerifiedBoundState {
  bindingId: string;
  subject: string;
  instanceIdHash: string;
  jkt: string;
  scopes: Array<'sync:read' | 'sync:write'>;
  status: BoundStateStatus;
  epoch: number;
  tokenValidAfter: number;
  stateObservedAt: Date;
  // Already narrowed to the earlier of signed state_expires_at and JWT exp.
  stateExpiresAt: Date;
}
