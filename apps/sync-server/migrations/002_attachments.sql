-- Object bytes live in S3; only workspace-scoped integrity metadata lives in PostgreSQL.
CREATE TABLE sync_attachments (
  workspace_id uuid NOT NULL REFERENCES sync_workspaces(workspace_id) ON DELETE CASCADE,
  attachment_id uuid NOT NULL,
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 4194304),
  status text NOT NULL CHECK (status IN ('pending', 'ready')),
  uploaded_by text NOT NULL CHECK (length(uploaded_by) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, attachment_id)
);
