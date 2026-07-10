-- Enable multiple active SQLtoERD sessions per Workspace.
-- Apply this migration to shared environments only after the compatible
-- app-server create lock and plural API have been deployed.

BEGIN;

DROP INDEX IF EXISTS public.ux_sql_erd_sessions_workspace_active;
DROP INDEX IF EXISTS public.idx_sql_erd_sessions_workspace_updated_at;

CREATE INDEX idx_sql_erd_sessions_workspace_updated_at_id
  ON public.sql_erd_sessions(workspace_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;

COMMIT;
