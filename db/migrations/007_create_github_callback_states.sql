-- Add server-side state storage for GitHub OAuth and GitHub App callbacks.
--
-- Callback state rows bind a signed state nonce to the initiating PILO user,
-- browser cookie, expiry, and one-time consumption status. Raw browser binding
-- tokens are never stored; only SHA-256 hashes are persisted.

BEGIN;

CREATE TABLE public.github_callback_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  flow TEXT NOT NULL,
  state_nonce TEXT NOT NULL,

  user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,

  workspace_id UUID
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  return_url TEXT,
  binding_token_hash TEXT NOT NULL,

  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT github_callback_states_flow_check
    CHECK (flow IN ('oauth', 'app_installation')),

  CONSTRAINT github_callback_states_nonce_not_empty_check
    CHECK (length(state_nonce) > 0),

  CONSTRAINT github_callback_states_binding_hash_not_empty_check
    CHECK (length(binding_token_hash) > 0),

  CONSTRAINT github_callback_states_expiration_order_check
    CHECK (expires_at > created_at),

  CONSTRAINT github_callback_states_consumed_order_check
    CHECK (consumed_at IS NULL OR consumed_at >= created_at),

  CONSTRAINT github_callback_states_app_workspace_check
    CHECK (
      (flow = 'oauth' AND workspace_id IS NULL)
      OR (flow = 'app_installation' AND workspace_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX idx_github_callback_states_state_nonce
  ON public.github_callback_states(state_nonce);

CREATE INDEX idx_github_callback_states_active_expiry
  ON public.github_callback_states(expires_at)
  WHERE consumed_at IS NULL;

CREATE INDEX idx_github_callback_states_user_id
  ON public.github_callback_states(user_id);

CREATE INDEX idx_github_callback_states_workspace_id
  ON public.github_callback_states(workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE TRIGGER trg_github_callback_states_updated_at
BEFORE UPDATE ON public.github_callback_states
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.github_callback_states ENABLE ROW LEVEL SECURITY;

COMMIT;
