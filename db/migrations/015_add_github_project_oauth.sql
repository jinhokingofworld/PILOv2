-- Store a separate regular GitHub OAuth App token for personal ProjectV2 access.
--
-- GitHub App user access tokens are intentionally scope-less, so personal
-- ProjectV2 GraphQL reads/writes use these project-scoped OAuth columns instead.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS github_project_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS github_project_login VARCHAR(255),
  ADD COLUMN IF NOT EXISTS github_project_access_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS github_project_token_scope TEXT,
  ADD COLUMN IF NOT EXISTS github_project_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS github_project_revoked_at TIMESTAMPTZ;

ALTER TABLE public.github_callback_states
  DROP CONSTRAINT IF EXISTS github_callback_states_flow_check,
  ADD CONSTRAINT github_callback_states_flow_check
    CHECK (flow IN ('oauth', 'app_installation', 'project_oauth'));

ALTER TABLE public.github_callback_states
  DROP CONSTRAINT IF EXISTS github_callback_states_app_workspace_check,
  ADD CONSTRAINT github_callback_states_app_workspace_check
    CHECK (
      (flow IN ('oauth', 'project_oauth') AND workspace_id IS NULL)
      OR (flow = 'app_installation' AND workspace_id IS NOT NULL)
    );

COMMIT;
