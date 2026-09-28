-- KeepAny optional sync. The server stores opaque ciphertext and visible routing metadata.
-- Apply with the migration command before serving traffic.
CREATE TABLE IF NOT EXISTS sync_workspaces (
  workspace_id uuid PRIMARY KEY,
  next_sequence bigint NOT NULL DEFAULT 0 CHECK (next_sequence >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_memberships (
  workspace_id uuid NOT NULL REFERENCES sync_workspaces(workspace_id) ON DELETE CASCADE,
  subject_id text NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 200),
  can_read boolean NOT NULL DEFAULT false,
  can_write boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, subject_id)
);

CREATE TABLE IF NOT EXISTS sync_documents (
  workspace_id uuid NOT NULL REFERENCES sync_workspaces(workspace_id) ON DELETE CASCADE,
  doc_id varchar(120) NOT NULL,
  kind varchar(20) NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version BETWEEN 1 AND 100),
  ciphertext text NOT NULL CHECK (length(ciphertext) BETWEEN 1 AND 2000000),
  tombstone boolean NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  sequence bigint NOT NULL CHECK (sequence > 0),
  PRIMARY KEY (workspace_id, doc_id),
  UNIQUE (workspace_id, sequence)
);

CREATE TABLE IF NOT EXISTS sync_changes (
  workspace_id uuid NOT NULL REFERENCES sync_workspaces(workspace_id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  doc_id varchar(120) NOT NULL,
  kind varchar(20) NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version BETWEEN 1 AND 100),
  ciphertext text NOT NULL CHECK (length(ciphertext) BETWEEN 1 AND 2000000),
  tombstone boolean NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  PRIMARY KEY (workspace_id, sequence)
);

CREATE TABLE IF NOT EXISTS sync_operations (
  workspace_id uuid NOT NULL REFERENCES sync_workspaces(workspace_id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  fingerprint char(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, operation_id)
);
