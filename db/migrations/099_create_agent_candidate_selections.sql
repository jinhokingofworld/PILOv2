BEGIN;

CREATE TABLE public.agent_candidate_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  tool_step_id UUID NOT NULL REFERENCES public.agent_steps(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  report_id UUID,
  label TEXT NOT NULL,
  description TEXT,
  status TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '15 minutes'),
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_candidate_selections_resource_type_check
    CHECK (resource_type IN (
      'meeting_room',
      'meeting',
      'meeting_report',
      'workspace_member',
      'meeting_report_action_item'
    )),
  CONSTRAINT agent_candidate_selections_label_check
    CHECK (label = btrim(label) AND octet_length(label) BETWEEN 1 AND 500),
  CONSTRAINT agent_candidate_selections_description_check
    CHECK (description IS NULL OR (
      description = btrim(description) AND octet_length(description) BETWEEN 1 AND 1000
    )),
  CONSTRAINT agent_candidate_selections_status_check
    CHECK (status IS NULL OR (
      status = btrim(status) AND octet_length(status) BETWEEN 1 AND 100
    )),
  CONSTRAINT agent_candidate_selections_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT agent_candidate_selections_action_item_report_check
    CHECK (
      (resource_type = 'meeting_report_action_item' AND report_id IS NOT NULL)
      OR (resource_type <> 'meeting_report_action_item' AND report_id IS NULL)
    )
);

CREATE INDEX idx_agent_candidate_selections_claim
  ON public.agent_candidate_selections(
    id,
    workspace_id,
    requested_by_user_id,
    run_id,
    tool_step_id,
    expires_at
  )
  WHERE consumed_at IS NULL;

CREATE INDEX idx_agent_candidate_selections_run_created_at
  ON public.agent_candidate_selections(run_id, created_at DESC);

CREATE INDEX idx_agent_candidate_selections_tool_step_id
  ON public.agent_candidate_selections(tool_step_id);

CREATE INDEX idx_agent_candidate_selections_requested_by_user_id
  ON public.agent_candidate_selections(requested_by_user_id);

ALTER TABLE public.agent_candidate_selections ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.agent_candidate_selections IS
  'Server-owned, one-time Agent clarification candidates. Browser receives only the opaque id; resource references remain server-side.';

COMMIT;
