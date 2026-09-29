-- Opaque recovery/join wraps; the server never receives a data key or credential.
-- The fingerprint anchors the single supported workspace key epoch until a future rotation protocol exists.
ALTER TABLE sync_workspaces
  ADD COLUMN key_fingerprint char(64) CHECK (key_fingerprint ~ '^[0-9a-f]{64}$');

CREATE TABLE sync_key_envelopes (
  envelope_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES sync_workspaces(workspace_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('recovery', 'join')),
  key_epoch integer NOT NULL CHECK (key_epoch = 1),
  key_fingerprint char(64) NOT NULL CHECK (key_fingerprint ~ '^[0-9a-f]{64}$'),
  wrap jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  CHECK ((kind = 'recovery' AND expires_at IS NULL) OR (kind = 'join' AND expires_at IS NOT NULL))
);

CREATE UNIQUE INDEX sync_key_envelopes_active_recovery
  ON sync_key_envelopes (workspace_id, key_epoch)
  WHERE kind = 'recovery' AND revoked_at IS NULL;

CREATE INDEX sync_key_envelopes_active_lookup
  ON sync_key_envelopes (workspace_id, created_at DESC)
  WHERE revoked_at IS NULL;
