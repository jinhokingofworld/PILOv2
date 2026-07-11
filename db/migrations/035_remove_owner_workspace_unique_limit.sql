-- Allow one user to own multiple workspaces while preserving owner lookups.

BEGIN;

DROP INDEX IF EXISTS public.unique_workspace_per_owner_user_id;

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_user_id
  ON public.workspaces(owner_user_id);

COMMIT;
