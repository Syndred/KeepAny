-- Trusted binding-state mirror and cross-process DPoP replay records.
-- No public HTTP endpoint writes these tables. A separately trusted state updater
-- must supply short leases; without one bound authentication fails closed.
CREATE TABLE sync_bound_bindings (
  binding_id uuid PRIMARY KEY,
  subject text NOT NULL CHECK (subject ~ '^keepanyadm:[A-Za-z0-9_-]{1,128}$'),
  instance_id_hash text NOT NULL CHECK (instance_id_hash ~ '^[0-9a-f]{64}$'),
  jkt text NOT NULL CHECK (jkt ~ '^[A-Za-z0-9_-]{43}$'),
  scopes text[] NOT NULL CHECK (
    cardinality(scopes) BETWEEN 1 AND 2
    AND scopes <@ ARRAY['sync:read', 'sync:write']::text[]
    AND 'sync:read' = ANY(scopes)
  ),
  status text NOT NULL CHECK (status IN ('active', 'inactive', 'device_limit', 'credential_expired', 'revoked')),
  epoch bigint NOT NULL CHECK (epoch > 0),
  token_valid_after bigint NOT NULL CHECK (token_valid_after >= 0),
  state_observed_at timestamptz NOT NULL,
  state_expires_at timestamptz NOT NULL CHECK (state_expires_at > state_observed_at)
);
CREATE INDEX sync_bound_bindings_lease_idx ON sync_bound_bindings (state_expires_at);

CREATE TABLE sync_bound_proofs (
  binding_id uuid NOT NULL REFERENCES sync_bound_bindings(binding_id) ON DELETE CASCADE,
  jkt text NOT NULL CHECK (jkt ~ '^[A-Za-z0-9_-]{43}$'),
  proof_jti_hash text NOT NULL CHECK (proof_jti_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (binding_id, jkt, proof_jti_hash)
);
CREATE INDEX sync_bound_proofs_expiry_idx ON sync_bound_proofs (expires_at);
