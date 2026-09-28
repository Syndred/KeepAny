import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

export type BoundProofClaim = {
  bindingId: string;
  subject: string;
  instanceIdHash: string;
  jkt: string;
  scope: 'sync:read' | 'sync:write';
  tokenIssuedAt: number;
  proofIssuedAt: number;
  proofJti: string;
};

export type BoundStateStore = {
  /** Atomically checks the current binding lease and consumes a proof across all server instances. */
  claimProof(claim: BoundProofClaim): Promise<boolean>;
  pruneExpiredProofs(): Promise<void>;
};

/** Resource requests only consume fresh trusted state and an atomic DPoP replay row. */
export function createPostgresBoundStateStore(pool: Pick<Pool, 'query'>): BoundStateStore {
  return {
    async claimProof(claim) {
      const proofJtiHash = createHash('sha256').update(claim.proofJti).digest('hex');
      const result = await pool.query<{ binding_id: string }>(`
        INSERT INTO sync_bound_proofs (binding_id, jkt, proof_jti_hash, expires_at)
        SELECT binding_id, jkt, $7, to_timestamp($8::bigint + 121)
        FROM sync_bound_bindings
        WHERE binding_id = $1::uuid
          AND subject = $2
          AND instance_id_hash = $3
          AND jkt = $4
          AND status = 'active'
          AND scopes @> ARRAY[$5]::text[]
          AND epoch > 0
          AND token_valid_after < $6::bigint
          AND state_observed_at <= CURRENT_TIMESTAMP
          AND state_expires_at > CURRENT_TIMESTAMP
          AND state_expires_at <= state_observed_at + INTERVAL '10 seconds'
        ON CONFLICT DO NOTHING
        RETURNING binding_id
      `, [claim.bindingId, claim.subject, claim.instanceIdHash, claim.jkt, claim.scope,
        claim.tokenIssuedAt, proofJtiHash, claim.proofIssuedAt]);
      return result.rows.length === 1;
    },
    async pruneExpiredProofs() {
      await pool.query('DELETE FROM sync_bound_proofs WHERE expires_at <= CURRENT_TIMESTAMP');
    },
  };
}
