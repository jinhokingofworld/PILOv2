-- Persist immutable SQLtoERD source publish snapshots outside the durable
-- operation payload. Source snapshots are replayed by their operation FK.

BEGIN;

CREATE TABLE public.sql_erd_session_source_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  session_id UUID NOT NULL
    REFERENCES public.sql_erd_sessions(id) ON DELETE CASCADE,

  source_format TEXT NOT NULL,
  dialect TEXT NOT NULL,
  source_text TEXT NOT NULL,
  model_json JSONB NOT NULL,
  layout_json JSONB NOT NULL,
  table_count INTEGER NOT NULL,
  relation_count INTEGER NOT NULL,
  base_revision INTEGER NOT NULL,
  result_revision INTEGER NOT NULL,

  created_by UUID NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sql_erd_source_snapshots_workspace_session_id_unique
    UNIQUE (workspace_id, session_id, id),
  CONSTRAINT sql_erd_source_snapshots_source_format_check
    CHECK (source_format = 'sql'),
  CONSTRAINT sql_erd_source_snapshots_dialect_check
    CHECK (dialect IN ('auto', 'postgresql', 'mysql', 'sqlite')),
  CONSTRAINT sql_erd_source_snapshots_source_text_size_check
    CHECK (octet_length(source_text) <= 1024 * 1024),
  CONSTRAINT sql_erd_source_snapshots_model_json_size_check
    CHECK (octet_length(model_json::text) <= 1024 * 1024),
  CONSTRAINT sql_erd_source_snapshots_layout_json_size_check
    CHECK (octet_length(layout_json::text) <= 1024 * 1024),
  CONSTRAINT sql_erd_source_snapshots_total_size_check
    CHECK (
      octet_length(source_text)
      + octet_length(model_json::text)
      + octet_length(layout_json::text)
      <= 3 * 1024 * 1024
    ),
  CONSTRAINT sql_erd_source_snapshots_counts_non_negative_check
    CHECK (table_count >= 0 AND relation_count >= 0),
  CONSTRAINT sql_erd_source_snapshots_revisions_check
    CHECK (base_revision > 0 AND result_revision = base_revision + 1),
  CONSTRAINT sql_erd_source_snapshots_json_object_check
    CHECK (jsonb_typeof(model_json) = 'object' AND jsonb_typeof(layout_json) = 'object')
);

CREATE INDEX idx_sql_erd_source_snapshots_workspace_session_created
  ON public.sql_erd_session_source_snapshots(workspace_id, session_id, created_at);

CREATE TABLE public.sql_erd_session_source_locks (
  session_id UUID PRIMARY KEY
    REFERENCES public.sql_erd_sessions(id) ON DELETE CASCADE,

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  lease_id UUID NOT NULL,
  actor_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,
  source_base_revision INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sql_erd_source_locks_workspace_session_unique
    UNIQUE (workspace_id, session_id),
  CONSTRAINT sql_erd_source_locks_source_base_revision_check
    CHECK (source_base_revision > 0)
);

CREATE INDEX idx_sql_erd_source_locks_expires_at
  ON public.sql_erd_session_source_locks(expires_at);

ALTER TABLE public.sql_erd_session_operations
  ADD COLUMN source_snapshot_id UUID,
  ADD COLUMN request_fingerprint TEXT,
  DROP CONSTRAINT sql_erd_session_operations_type_check,
  ADD CONSTRAINT sql_erd_session_operations_type_check
    CHECK (operation_type IN ('layout_patch', 'source_snapshot')),
  ADD CONSTRAINT sql_erd_session_operations_source_snapshot_reference_check
    CHECK (
      (operation_type = 'layout_patch' AND source_snapshot_id IS NULL AND request_fingerprint IS NULL)
      OR (
        operation_type = 'source_snapshot'
        AND source_snapshot_id IS NOT NULL
        AND request_fingerprint ~ '^[0-9a-f]{64}$'
      )
    ),
  ADD CONSTRAINT sql_erd_session_operations_source_snapshot_fk
    FOREIGN KEY (workspace_id, session_id, source_snapshot_id)
    REFERENCES public.sql_erd_session_source_snapshots(workspace_id, session_id, id)
    ON DELETE RESTRICT;

CREATE INDEX idx_sql_erd_session_operations_source_snapshot_id
  ON public.sql_erd_session_operations(source_snapshot_id)
  WHERE source_snapshot_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_sql_erd_source_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'sql_erd_session_source_snapshots rows are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_prevent_sql_erd_source_snapshot_mutation
BEFORE UPDATE ON public.sql_erd_session_source_snapshots
FOR EACH ROW
EXECUTE FUNCTION public.prevent_sql_erd_source_snapshot_update();

CREATE TRIGGER trg_sql_erd_source_locks_updated_at
BEFORE UPDATE ON public.sql_erd_session_source_locks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.sql_erd_session_source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sql_erd_session_source_locks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.sql_erd_session_source_snapshots IS
  'Immutable SQLtoERD source/model/rebased-layout snapshots referenced by durable source_snapshot operations.';

COMMENT ON TABLE public.sql_erd_session_source_locks IS
  'Short-lived source-writer leases. Layout operations remain independent of this lease.';

COMMENT ON COLUMN public.sql_erd_session_operations.source_snapshot_id IS
  'Session-scoped immutable source snapshot reference. Required for source_snapshot and NULL for layout_patch.';

COMMENT ON COLUMN public.sql_erd_session_operations.request_fingerprint IS
  'SHA-256 fingerprint of normalized source publish input. Used to reject mismatched idempotency-key reuse.';

COMMIT;
