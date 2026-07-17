ALTER TABLE public.github_oauth_connections
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ;
