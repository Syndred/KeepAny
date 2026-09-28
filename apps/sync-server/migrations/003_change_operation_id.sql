-- Keep old migration checksums stable. Historical accepted operations identify each
-- change by the workspace-local sequence stored in their durable result.
ALTER TABLE sync_changes ADD COLUMN operation_id uuid;

UPDATE sync_changes AS change
SET operation_id = operation.operation_id
FROM sync_operations AS operation
WHERE operation.workspace_id = change.workspace_id
  AND operation.result->>'status' = 'accepted'
  AND (operation.result->>'sequence')::bigint = change.sequence;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sync_changes WHERE operation_id IS NULL) THEN
    RAISE EXCEPTION 'sync-change-operation-backfill-incomplete';
  END IF;
END $$;

ALTER TABLE sync_changes ALTER COLUMN operation_id SET NOT NULL;
