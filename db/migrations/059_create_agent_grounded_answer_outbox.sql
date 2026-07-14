BEGIN;

CREATE TABLE public.agent_grounded_answer_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  claim_token UUID,
  delivered_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_grounded_answer_outbox_run_unique UNIQUE (run_id),
  CONSTRAINT agent_grounded_answer_outbox_source_ids_check CHECK (jsonb_typeof(source_ids) = 'array'),
  CONSTRAINT agent_grounded_answer_outbox_status_check CHECK (status IN ('pending', 'publishing', 'delivered', 'failed')),
  CONSTRAINT agent_grounded_answer_outbox_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT agent_grounded_answer_outbox_error_message_check CHECK (error_message IS NULL OR octet_length(error_message) <= 4096)
);

CREATE INDEX idx_agent_grounded_answer_outbox_due
  ON public.agent_grounded_answer_outbox (next_attempt_at)
  WHERE status IN ('pending', 'publishing');

CREATE TRIGGER trg_agent_grounded_answer_outbox_updated_at
BEFORE UPDATE ON public.agent_grounded_answer_outbox
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.agent_grounded_answer_outbox ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.agent_grounded_answer_outbox IS
  'Durable server-only dispatch intents for grounded Agent answers. It stores chunk identifiers only; transcript excerpts are never persisted here or sent to SQS.';

COMMIT;
