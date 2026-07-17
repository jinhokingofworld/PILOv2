-- Retryable Redis delivery intents for Workspace membership revocation.
BEGIN;

CREATE TABLE public.workspace_membership_revocation_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error_code TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT workspace_membership_revocation_outbox_status_check
    CHECK (status IN ('pending', 'publishing', 'delivered')),
  CONSTRAINT workspace_membership_revocation_outbox_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT workspace_membership_revocation_outbox_last_error_code_check
    CHECK (
      last_error_code IS NULL
      OR octet_length(last_error_code) BETWEEN 1 AND 80
    ),
  CONSTRAINT workspace_membership_revocation_outbox_delivery_state_check
    CHECK (
      (status = 'pending' AND claim_token IS NULL AND claimed_at IS NULL AND delivered_at IS NULL)
      OR (status = 'publishing' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL AND delivered_at IS NULL)
      OR (status = 'delivered' AND claim_token IS NULL AND claimed_at IS NULL AND delivered_at IS NOT NULL)
    )
);

CREATE INDEX idx_workspace_membership_revocation_outbox_pending_attempt
  ON public.workspace_membership_revocation_outbox(next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX idx_workspace_membership_revocation_outbox_publishing_claimed_at
  ON public.workspace_membership_revocation_outbox(claimed_at)
  WHERE status = 'publishing';

CREATE TRIGGER trg_workspace_membership_revocation_outbox_updated_at
BEFORE UPDATE ON public.workspace_membership_revocation_outbox
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workspace_membership_revocation_outbox ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.workspace_membership_revocation_outbox IS
  'Durable Workspace membership revocation delivery intents. Redis delivery is retried until published.';

COMMIT;
