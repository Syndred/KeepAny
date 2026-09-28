import type { Pool } from 'pg';
import type { VerifiedBoundState } from './bound-state-record';

const MAX_NON_REVOKED_BINDINGS = 32;

export interface BoundStateWriterDatabase {
  /** Admission and the existing CAS write are one short PostgreSQL transaction. */
  upsertVerifiedState(state: VerifiedBoundState): Promise<'applied' | 'ignored'>;
  hasState(bindingId: string): Promise<boolean>;
  /** Includes expired leases so a later paid-state recovery can be observed. */
  listKnownNonRevokedIds(): Promise<string[]>;
}

export function createPostgresBoundStateWriter(pool: Pick<Pool, 'connect' | 'query'>): BoundStateWriterDatabase {
  return {
    async upsertVerifiedState(state) {
      const client = await pool.connect();
      let begun = false;
      try {
        await client.query('BEGIN');
        begun = true;
        const existing = await client.query<{ binding_id: string }>(
          'SELECT binding_id FROM sync_bound_bindings WHERE binding_id=$1::uuid FOR UPDATE',
          [state.bindingId],
        );
        if (existing.rows.length === 0) {
          // A missing row has no row lock. Serialize admission across writers,
          // then recheck: another transaction may have inserted this same ID.
          await client.query("SELECT pg_advisory_xact_lock(hashtext('keepany-bound-state-feed-capacity'))");
          const admittedWhileWaiting = await client.query<{ binding_id: string }>(
            'SELECT binding_id FROM sync_bound_bindings WHERE binding_id=$1::uuid FOR UPDATE',
            [state.bindingId],
          );
          if (admittedWhileWaiting.rows.length === 0 && state.status !== 'revoked') {
            const count = await client.query<{ admitted: number }>(
              "SELECT count(*)::int AS admitted FROM sync_bound_bindings WHERE status <> 'revoked'",
            );
            if ((count.rows[0]?.admitted ?? 0) >= MAX_NON_REVOKED_BINDINGS) {
              throw Error('bound-state-feed-capacity-exceeded');
            }
          }
        }
        const result = await client.query<{ binding_id: string }>(`
        INSERT INTO sync_bound_bindings
          (binding_id, subject, instance_id_hash, jkt, scopes, status, epoch,
           token_valid_after, state_observed_at, state_expires_at)
        VALUES ($1::uuid, $2, $3, $4, $5::text[], $6, $7::bigint,
                $8::bigint, $9::timestamptz, $10::timestamptz)
        ON CONFLICT (binding_id) DO UPDATE SET
          subject = EXCLUDED.subject,
          instance_id_hash = EXCLUDED.instance_id_hash,
          jkt = EXCLUDED.jkt,
          scopes = EXCLUDED.scopes,
          status = EXCLUDED.status,
          epoch = EXCLUDED.epoch,
          token_valid_after = EXCLUDED.token_valid_after,
          state_observed_at = EXCLUDED.state_observed_at,
          state_expires_at = EXCLUDED.state_expires_at
        WHERE (sync_bound_bindings.status <> 'revoked' OR EXCLUDED.status = 'revoked')
          AND EXCLUDED.state_observed_at >= sync_bound_bindings.state_observed_at
          AND (
            (EXCLUDED.epoch > sync_bound_bindings.epoch
             AND EXCLUDED.token_valid_after > sync_bound_bindings.token_valid_after)
            OR
            (EXCLUDED.epoch = sync_bound_bindings.epoch
             AND EXCLUDED.token_valid_after = sync_bound_bindings.token_valid_after
             AND EXCLUDED.subject = sync_bound_bindings.subject
             AND EXCLUDED.instance_id_hash = sync_bound_bindings.instance_id_hash
             AND EXCLUDED.jkt = sync_bound_bindings.jkt
             AND EXCLUDED.status = sync_bound_bindings.status
             AND cardinality(EXCLUDED.scopes) = cardinality(sync_bound_bindings.scopes)
             AND EXCLUDED.scopes @> sync_bound_bindings.scopes
             AND sync_bound_bindings.scopes @> EXCLUDED.scopes
             AND EXCLUDED.state_observed_at > sync_bound_bindings.state_observed_at)
          )
        RETURNING binding_id
        `, [state.bindingId, state.subject, state.instanceIdHash, state.jkt,
          state.scopes, state.status, state.epoch, state.tokenValidAfter,
          state.stateObservedAt, state.stateExpiresAt]);
        await client.query('COMMIT');
        begun = false;
        return result.rows.length === 1 ? 'applied' : 'ignored';
      } catch (error) {
        if (begun) await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async hasState(bindingId) {
      const result = await pool.query('SELECT 1 FROM sync_bound_bindings WHERE binding_id=$1::uuid', [bindingId]);
      return result.rows.length === 1;
    },
    async listKnownNonRevokedIds() {
      const result = await pool.query<{ binding_id: string }>(
        "SELECT binding_id FROM sync_bound_bindings WHERE status <> 'revoked' ORDER BY binding_id",
      );
      return result.rows.map(row => row.binding_id);
    },
  };
}
