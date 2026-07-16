BEGIN;

ALTER TABLE public.meeting_report_action_items
  DROP CONSTRAINT meeting_report_action_items_status_check,
  DROP CONSTRAINT meeting_report_action_items_terminal_audit_check,
  ADD CONSTRAINT meeting_report_action_items_status_check
    CHECK (status IN ('PENDING', 'DELIVERING', 'DELIVERY_FAILED', 'APPROVED', 'DISMISSED')),
  ADD CONSTRAINT meeting_report_action_items_terminal_audit_check
    CHECK (
      (status IN ('PENDING', 'DELIVERING', 'DELIVERY_FAILED')
        AND approved_by_user_id IS NULL AND approved_at IS NULL
        AND dismissed_by_user_id IS NULL AND dismissed_at IS NULL)
      OR (status = 'APPROVED'
        AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL
        AND dismissed_by_user_id IS NULL AND dismissed_at IS NULL)
      OR (status = 'DISMISSED'
        AND approved_by_user_id IS NULL AND approved_at IS NULL
        AND dismissed_by_user_id IS NOT NULL AND dismissed_at IS NOT NULL)
    );

CREATE TABLE public.meeting_report_action_item_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_item_id UUID NOT NULL UNIQUE
    REFERENCES public.meeting_report_action_items(id) ON DELETE CASCADE,
  delivery_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  calendar_event_id BIGINT
    REFERENCES public.calendar_events(id) ON DELETE RESTRICT,
  pilo_issue_id BIGINT
    REFERENCES public.pilo_issues(id) ON DELETE RESTRICT,
  requested_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,
  draft_json JSONB NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  claim_token UUID,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_report_action_item_deliveries_type_check
    CHECK (delivery_type IN ('calendar_event', 'pilo_issue')),
  CONSTRAINT meeting_report_action_item_deliveries_status_check
    CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  CONSTRAINT meeting_report_action_item_deliveries_draft_json_object_check
    CHECK (jsonb_typeof(draft_json) = 'object'),
  CONSTRAINT meeting_report_action_item_deliveries_attempt_count_check
    CHECK (attempt_count >= 0),
  CONSTRAINT meeting_report_action_item_deliveries_idempotency_key_check
    CHECK (idempotency_key = btrim(idempotency_key) AND octet_length(idempotency_key) BETWEEN 1 AND 512),
  CONSTRAINT meeting_report_action_item_deliveries_error_code_check
    CHECK (last_error_code IS NULL OR octet_length(last_error_code) BETWEEN 1 AND 80),
  CONSTRAINT meeting_report_action_item_deliveries_claim_check
    CHECK (
      (status = 'RUNNING' AND claim_token IS NOT NULL AND locked_until IS NOT NULL)
      OR (status <> 'RUNNING' AND claim_token IS NULL AND locked_until IS NULL)
    ),
  CONSTRAINT meeting_report_action_item_deliveries_target_check
    CHECK (
      (delivery_type = 'calendar_event' AND pilo_issue_id IS NULL)
      OR (delivery_type = 'pilo_issue' AND calendar_event_id IS NULL)
    ),
  CONSTRAINT meeting_report_action_item_deliveries_completed_target_check
    CHECK (
      status <> 'COMPLETED'
      OR (delivery_type = 'calendar_event' AND calendar_event_id IS NOT NULL)
      OR (delivery_type = 'pilo_issue' AND pilo_issue_id IS NOT NULL)
    )
);

CREATE INDEX idx_meeting_report_action_item_deliveries_calendar_event
  ON public.meeting_report_action_item_deliveries(calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;

CREATE INDEX idx_meeting_report_action_item_deliveries_pilo_issue
  ON public.meeting_report_action_item_deliveries(pilo_issue_id)
  WHERE pilo_issue_id IS NOT NULL;

CREATE INDEX idx_meeting_report_action_item_deliveries_requested_by
  ON public.meeting_report_action_item_deliveries(requested_by_user_id);

CREATE INDEX idx_meeting_report_action_item_deliveries_running_lease
  ON public.meeting_report_action_item_deliveries(locked_until)
  WHERE status = 'RUNNING';

CREATE TRIGGER trg_meeting_report_action_item_deliveries_updated_at
BEFORE UPDATE ON public.meeting_report_action_item_deliveries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.meeting_report_action_item_deliveries ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.meeting_report_decision_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_report_id UUID NOT NULL
    REFERENCES public.meeting_reports(id) ON DELETE CASCADE,
  source_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT meeting_report_decision_items_report_source_unique
    UNIQUE (meeting_report_id, source_index),
  CONSTRAINT meeting_report_decision_items_source_index_check
    CHECK (source_index >= 0),
  CONSTRAINT meeting_report_decision_items_text_check
    CHECK (text = btrim(text) AND octet_length(text) BETWEEN 1 AND 5000)
);

ALTER TABLE public.meeting_report_decision_items ENABLE ROW LEVEL SECURITY;

INSERT INTO public.meeting_report_decision_items (
  meeting_report_id,
  source_index,
  text
)
SELECT id, 0, btrim(decisions)
FROM public.meeting_reports
WHERE NULLIF(btrim(decisions), '') IS NOT NULL
ON CONFLICT (meeting_report_id, source_index) DO NOTHING;

ALTER TABLE public.agent_runs
  DROP CONSTRAINT agent_runs_status_check,
  ADD COLUMN planner_turn_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN tool_call_count INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT agent_runs_status_check
    CHECK (status IN (
      'planning',
      'waiting_user_input',
      'waiting_confirmation',
      'running',
      'completed',
      'failed',
      'cancelled'
    )),
  ADD CONSTRAINT agent_runs_planner_turn_count_check
    CHECK (planner_turn_count >= 0 AND planner_turn_count <= 5),
  ADD CONSTRAINT agent_runs_tool_call_count_check
    CHECK (tool_call_count >= 0 AND tool_call_count <= 5);

ALTER TABLE public.agent_run_outbox
  ADD COLUMN turn_sequence INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN reason TEXT NOT NULL DEFAULT 'run_created',
  ADD CONSTRAINT agent_run_outbox_turn_sequence_check
    CHECK (turn_sequence >= 1),
  ADD CONSTRAINT agent_run_outbox_reason_check
    CHECK (reason IN ('run_created', 'user_input', 'tool_result'));

CREATE TABLE public.agent_run_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_run_messages_run_sequence_unique UNIQUE (run_id, sequence),
  CONSTRAINT agent_run_messages_role_check
    CHECK (role IN ('user', 'assistant')),
  CONSTRAINT agent_run_messages_content_check
    CHECK (content = btrim(content) AND octet_length(content) BETWEEN 1 AND 4000)
);

ALTER TABLE public.agent_run_messages ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.meeting_report_action_item_deliveries IS
  'One selected Calendar event or Pilo issue delivery for one stored MeetingReport action item.';

COMMENT ON TABLE public.meeting_report_decision_items IS
  'Structured MeetingReport decisions. Evidence must reference the same report and source index.';

COMMENT ON TABLE public.agent_run_messages IS
  'Append-only bounded multi-turn memory for one Agent run. It is never shared with another run.';

COMMENT ON COLUMN public.agent_run_outbox.turn_sequence IS
  'Monotonic planner turn generation. Delayed jobs from an older generation are ignored by the AI Worker.';

COMMENT ON COLUMN public.agent_run_outbox.reason IS
  'Safe reason that caused the current planner turn to be queued.';

COMMIT;
