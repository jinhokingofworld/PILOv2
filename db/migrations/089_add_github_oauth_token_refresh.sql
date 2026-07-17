ALTER TABLE public.github_oauth_connections
  ADD COLUMN refresh_token_encrypted TEXT,
  ADD COLUMN access_token_expires_at TIMESTAMPTZ,
  ADD COLUMN refresh_token_expires_at TIMESTAMPTZ;
