-- Durable Agent planning-job delivery intent. A run and its outbox record are
-- committed together so an App Server interruption cannot orphan a planning run.

BEGIN;

CREATE TABLE public.agent_run_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  run_id UUID NOT NULL,
  workspace_id UUID NOT NULL,

  event_type TEXT NOT NULL DEFAULT 'agent_run_requested',
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,

  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_run_outbox_run_fk
    FOREIGN KEY (run_id)
    REFERENCES public.agent_runs(id)
    ON DELETE CASCADE,

  CONSTRAINT agent_run_outbox_run_unique
    UNIQUE (run_id),

  CONSTRAINT agent_run_outbox_event_type_check
    CHECK (event_type = 'agent_run_requested'),

  CONSTRAINT agent_run_outbox_status_check
    CHECK (status IN ('pending', 'publishing', 'delivered', 'failed')),

  CONSTRAINT agent_run_outbox_attempt_count_check
    CHECK (attempt_count >= 0),

  CONSTRAINT agent_run_outbox_error_code_check
    CHECK (error_code IS NULL OR octet_length(error_code) BETWEEN 1 AND 80),

  CONSTRAINT agent_run_outbox_error_message_check
    CHECK (error_message IS NULL OR octet_length(error_message) <= 1000),

  CONSTRAINT agent_run_outbox_delivery_state_check
    CHECK (
      (status = 'pending' AND delivered_at IS NULL)
      OR (status = 'publishing' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL AND delivered_at IS NULL)
      OR (status = 'delivered' AND delivered_at IS NOT NULL)
      OR status = 'failed'
    )
);

CREATE INDEX idx_agent_run_outbox_pending_attempt
  ON public.agent_run_outbox(status, next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX idx_agent_run_outbox_publishing_claimed_at
  ON public.agent_run_outbox(claimed_at)
  WHERE status = 'publishing';

CREATE TRIGGER trg_agent_run_outbox_updated_at
BEFORE UPDATE ON public.agent_run_outbox
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.agent_run_outbox ENABLE ROW LEVEL SECURITY;

INSERT INTO public.agent_run_outbox (run_id, workspace_id)
SELECT id, workspace_id
FROM public.agent_runs
WHERE status = 'planning'
ON CONFLICT (run_id) DO NOTHING;

COMMENT ON TABLE public.agent_run_outbox IS
  'Durable Agent planning-job delivery intents. Publisher claims are at-least-once; AI Worker run locking makes duplicate SQS delivery safe.';

COMMIT;
