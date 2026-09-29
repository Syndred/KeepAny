import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

export type BoundProofClaim = {
  bindingId: string;
  subject: string;
  instanceIdHash: string;
  jkt: string;
  scope: 'sync:read' | 'sync:write';
  tokenIssuedAt: number;
  tokenExpiresAt: number;
  proofIssuedAt: number;
  proofJti: string;
};

export type BoundStateStore = {
  /** Atomically checks the current binding lease and consumes a proof across all server instances. */
  claimProof(claim: BoundProofClaim): Promise<boolean>;
  pruneExpiredProofs(): Promise<void>;
};

export type BoundDeviceStatus = 'active' | 'inactive' | 'device_limit' | 'credential_expired' | 'revoked' | 'unavailable';
export type BoundDevice = {
  bindingId: string;
  status: BoundDeviceStatus;
  stateObservedAt: string;
};
export type BoundDeviceReader = { listForSubject(subject: string): Promise<BoundDevice[]> };

/** Read-only view of verified binding states. An expired lease is never displayed as active. */
export function createPostgresBoundDeviceReader(pool: Pick<Pool, 'query'>): BoundDeviceReader {
  return {
    async listForSubject(subject) {
      if (!/^keepanyadm:[A-Za-z0-9_-]{1,128}$/.test(subject)) throw Error('bound-device-subject');
      const result = await pool.query<{ binding_id: string; status: BoundDeviceStatus; state_observed_at: Date }>(
        `SELECT binding_id,
          CASE WHEN status = 'active' AND state_expires_at <= clock_timestamp()
            THEN 'unavailable' ELSE status END AS status,
          state_observed_at
         FROM sync_bound_bindings WHERE subject=$1
         ORDER BY (status = 'revoked') ASC, state_observed_at DESC, binding_id DESC LIMIT 64`,
        [subject],
      );
      return result.rows.map(row => ({
        bindingId: row.binding_id,
        status: row.status,
        stateObservedAt: row.state_observed_at.toISOString(),
      }));
    },
  };
}

/** Resource requests only consume fresh trusted state and an atomic DPoP replay row. */
export function createPostgresBoundStateStore(pool: Pick<Pool, 'connect' | 'query'>): BoundStateStore {
  return {
    async claimProof(claim) {
      const proofJtiHash = createHash('sha256').update(claim.proofJti).digest('hex');
      const client = await pool.connect();
      let transactionOpen = false;
      try {
        await client.query('BEGIN');
        transactionOpen = true;
        const result = await client.query<{ binding_id: string }>(`
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
            AND state_observed_at <= clock_timestamp()
            AND state_expires_at > clock_timestamp()
            AND state_expires_at <= state_observed_at + INTERVAL '10 seconds'
            AND to_timestamp($9::bigint) > clock_timestamp()
            AND abs(extract(epoch FROM clock_timestamp()) - $8::bigint) <= 60
          FOR SHARE
          ON CONFLICT DO NOTHING
          RETURNING binding_id
        `, [claim.bindingId, claim.subject, claim.instanceIdHash, claim.jkt, claim.scope,
          claim.tokenIssuedAt, proofJtiHash, claim.proofIssuedAt, claim.tokenExpiresAt]);
        if (result.rows.length !== 1) {
          await client.query('ROLLBACK');
          transactionOpen = false;
          return false;
        }
        // A row lock, proof conflict, or a slow database can outlive a token.
        // Roll back the proof before granting access if either clock window closed.
        const fresh = await client.query<{ valid: boolean }>(`
          SELECT status = 'active'
            AND state_observed_at <= clock_timestamp()
            AND state_expires_at > clock_timestamp()
            AND to_timestamp($2::bigint) > clock_timestamp()
            AND abs(extract(epoch FROM clock_timestamp()) - $3::bigint) <= 60 AS valid
          FROM sync_bound_bindings WHERE binding_id = $1::uuid
        `, [claim.bindingId, claim.tokenExpiresAt, claim.proofIssuedAt]);
        if (fresh.rows[0]?.valid !== true) {
          await client.query('ROLLBACK');
          transactionOpen = false;
          return false;
        }
        await client.query('COMMIT');
        transactionOpen = false;
        return true;
      } catch (error) {
        if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async pruneExpiredProofs() {
      await pool.query('DELETE FROM sync_bound_proofs WHERE expires_at <= CURRENT_TIMESTAMP');
    },
  };
}
