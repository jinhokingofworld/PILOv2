ALTER TABLE public.agent_run_outbox
  ADD COLUMN planning_started_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX idx_agent_run_outbox_planning_deadline
  ON public.agent_run_outbox(planning_started_at)
  WHERE status IN ('pending', 'publishing', 'delivered', 'failed');

COMMENT ON COLUMN public.agent_run_outbox.planning_started_at IS
  'Server-owned start time of the current planning turn. Publisher claim and retry updates must not change it.';
