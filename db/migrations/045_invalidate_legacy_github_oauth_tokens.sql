BEGIN;

UPDATE users
SET
  github_access_token_encrypted = NULL,
  github_token_scope = NULL,
  github_revoked_at = CASE
    WHEN github_access_token_encrypted IS NOT NULL THEN now()
    ELSE github_revoked_at
  END,
  github_project_access_token_encrypted = NULL,
  github_project_token_scope = NULL,
  github_project_revoked_at = CASE
    WHEN github_project_access_token_encrypted IS NOT NULL THEN now()
    ELSE github_project_revoked_at
  END
WHERE github_access_token_encrypted IS NOT NULL
   OR github_project_access_token_encrypted IS NOT NULL;

COMMIT;
