BEGIN;

CREATE TABLE github_oauth_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('app_user', 'project_v2')),
  github_user_id BIGINT NOT NULL,
  github_login VARCHAR(255) NOT NULL,
  access_token_encrypted TEXT,
  token_scope TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_github_oauth_connections_active_user_purpose
  ON github_oauth_connections(user_id, purpose)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX uq_github_oauth_connections_active_github_account_purpose
  ON github_oauth_connections(purpose, github_user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_github_oauth_connections_user_purpose
  ON github_oauth_connections(user_id, purpose);

CREATE TRIGGER trg_github_oauth_connections_updated_at
BEFORE UPDATE ON github_oauth_connections
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE github_oauth_connections ENABLE ROW LEVEL SECURITY;

COMMIT;
