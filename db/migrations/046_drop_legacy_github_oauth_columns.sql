BEGIN;

ALTER TABLE users
  DROP COLUMN IF EXISTS github_access_token_encrypted,
  DROP COLUMN IF EXISTS github_token_scope,
  DROP COLUMN IF EXISTS github_connected_at,
  DROP COLUMN IF EXISTS github_revoked_at,
  DROP COLUMN IF EXISTS github_project_user_id,
  DROP COLUMN IF EXISTS github_project_login,
  DROP COLUMN IF EXISTS github_project_access_token_encrypted,
  DROP COLUMN IF EXISTS github_project_token_scope,
  DROP COLUMN IF EXISTS github_project_connected_at,
  DROP COLUMN IF EXISTS github_project_revoked_at;

COMMIT;
