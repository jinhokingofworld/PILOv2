-- Add server-side user sessions for PILO API authentication.
--
-- Store only a hash of the session token. The raw bearer token must never be
-- persisted in the database or returned by API responses.

BEGIN;

CREATE TABLE public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,

  token_hash TEXT NOT NULL,

  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_sessions_token_hash_not_empty_check
    CHECK (length(token_hash) > 0),

  CONSTRAINT user_sessions_expiration_order_check
    CHECK (expires_at > created_at),

  CONSTRAINT user_sessions_revocation_order_check
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),

  CONSTRAINT user_sessions_last_used_order_check
    CHECK (last_used_at IS NULL OR last_used_at >= created_at)
);

CREATE UNIQUE INDEX idx_user_sessions_token_hash
  ON public.user_sessions(token_hash);

CREATE INDEX idx_user_sessions_user_id
  ON public.user_sessions(user_id);

CREATE INDEX idx_user_sessions_active_expires_at
  ON public.user_sessions(expires_at)
  WHERE revoked_at IS NULL;

CREATE TRIGGER trg_user_sessions_updated_at
BEFORE UPDATE ON public.user_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

COMMIT;
