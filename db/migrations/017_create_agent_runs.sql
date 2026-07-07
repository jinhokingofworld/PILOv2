-- Create Agent run, step, confirmation, and diagnostic log storage.
-- Agent data is scoped by Workspace and keeps only bounded execution metadata.

BEGIN;

CREATE TABLE public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  requested_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,

  client_request_id TEXT,

  status TEXT NOT NULL DEFAULT 'planning',
  risk_level TEXT,

  prompt TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',

  message TEXT,
  final_answer TEXT,
  error_code TEXT,
  error_message TEXT,

  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_runs_status_check
    CHECK (status IN (
      'planning',
      'waiting_confirmation',
      'running',
      'completed',
      'failed',
      'cancelled'
    )),

  CONSTRAINT agent_runs_risk_level_check
    CHECK (
      risk_level IS NULL
      OR risk_level IN ('low', 'medium', 'high')
    ),

  CONSTRAINT agent_runs_client_request_id_check
    CHECK (
      client_request_id IS NULL
      OR (
        client_request_id = btrim(client_request_id)
        AND octet_length(client_request_id) BETWEEN 1 AND 128
      )
    ),

  CONSTRAINT agent_runs_prompt_check
    CHECK (
      prompt = btrim(prompt)
      AND octet_length(prompt) BETWEEN 1 AND 32768
    ),

  CONSTRAINT agent_runs_timezone_check
    CHECK (
      timezone = btrim(timezone)
      AND char_length(timezone) BETWEEN 1 AND 64
    ),

  CONSTRAINT agent_runs_message_size_check
    CHECK (message IS NULL OR octet_length(message) <= 1000),

  CONSTRAINT agent_runs_final_answer_size_check
    CHECK (final_answer IS NULL OR octet_length(final_answer) <= 65536),

  CONSTRAINT agent_runs_error_code_check
    CHECK (error_code IS NULL OR octet_length(error_code) BETWEEN 1 AND 80),

  CONSTRAINT agent_runs_error_message_size_check
    CHECK (error_message IS NULL OR octet_length(error_message) <= 4096),

  CONSTRAINT agent_runs_completed_at_order_check
    CHECK (completed_at IS NULL OR completed_at >= created_at),

  CONSTRAINT agent_runs_expires_at_order_check
    CHECK (expires_at > created_at)
);

ALTER TABLE public.agent_runs
  ADD CONSTRAINT agent_runs_id_workspace_unique
  UNIQUE (id, workspace_id);

CREATE UNIQUE INDEX ux_agent_runs_client_request
  ON public.agent_runs(workspace_id, requested_by_user_id, client_request_id)
  WHERE client_request_id IS NOT NULL
    AND requested_by_user_id IS NOT NULL;

CREATE INDEX idx_agent_runs_workspace_requester_created_at
  ON public.agent_runs(workspace_id, requested_by_user_id, created_at DESC);

CREATE INDEX idx_agent_runs_workspace_status_created_at
  ON public.agent_runs(workspace_id, status, created_at DESC);

CREATE INDEX idx_agent_runs_requested_by_user_id
  ON public.agent_runs(requested_by_user_id);

CREATE INDEX idx_agent_runs_expires_at
  ON public.agent_runs(expires_at);

CREATE TRIGGER trg_agent_runs_updated_at
BEFORE UPDATE ON public.agent_runs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.agent_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  run_id UUID NOT NULL
    REFERENCES public.agent_runs(id) ON DELETE CASCADE,

  step_order INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',

  tool_name TEXT,
  risk_level TEXT,

  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  resource_refs JSONB NOT NULL DEFAULT '[]'::jsonb,

  error_code TEXT,
  error_message TEXT,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_steps_run_order_unique
    UNIQUE (run_id, step_order),

  CONSTRAINT agent_steps_step_order_check
    CHECK (step_order > 0),

  CONSTRAINT agent_steps_step_type_check
    CHECK (step_type IN ('planner', 'tool', 'answer')),

  CONSTRAINT agent_steps_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),

  CONSTRAINT agent_steps_tool_name_check
    CHECK (
      tool_name IS NULL
      OR (
        tool_name = btrim(tool_name)
        AND octet_length(tool_name) BETWEEN 1 AND 120
      )
    ),

  CONSTRAINT agent_steps_risk_level_check
    CHECK (
      risk_level IS NULL
      OR risk_level IN ('low', 'medium', 'high')
    ),

  CONSTRAINT agent_steps_input_json_object_check
    CHECK (jsonb_typeof(input_json) = 'object'),

  CONSTRAINT agent_steps_output_json_object_check
    CHECK (jsonb_typeof(output_json) = 'object'),

  CONSTRAINT agent_steps_resource_refs_array_check
    CHECK (jsonb_typeof(resource_refs) = 'array'),

  CONSTRAINT agent_steps_input_json_size_check
    CHECK (octet_length(input_json::text) <= 32768),

  CONSTRAINT agent_steps_output_json_size_check
    CHECK (octet_length(output_json::text) <= 65536),

  CONSTRAINT agent_steps_resource_refs_size_check
    CHECK (octet_length(resource_refs::text) <= 65536),

  CONSTRAINT agent_steps_error_code_check
    CHECK (error_code IS NULL OR octet_length(error_code) BETWEEN 1 AND 80),

  CONSTRAINT agent_steps_error_message_size_check
    CHECK (error_message IS NULL OR octet_length(error_message) <= 4096),

  CONSTRAINT agent_steps_time_order_check
    CHECK (
      completed_at IS NULL
      OR started_at IS NULL
      OR completed_at >= started_at
    )
);

CREATE INDEX idx_agent_steps_run_status
  ON public.agent_steps(run_id, status);

CREATE INDEX idx_agent_steps_tool_name
  ON public.agent_steps(tool_name)
  WHERE tool_name IS NOT NULL;

CREATE TRIGGER trg_agent_steps_updated_at
BEFORE UPDATE ON public.agent_steps
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.agent_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  run_id UUID NOT NULL
    REFERENCES public.agent_runs(id) ON DELETE CASCADE,

  tool_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  risk_level TEXT NOT NULL,

  summary TEXT NOT NULL,
  plan_json JSONB NOT NULL,

  approved_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,

  rejected_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,

  expires_at TIMESTAMPTZ NOT NULL,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_confirmations_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),

  CONSTRAINT agent_confirmations_risk_level_check
    CHECK (risk_level IN ('low', 'medium', 'high')),

  CONSTRAINT agent_confirmations_tool_name_check
    CHECK (
      tool_name = btrim(tool_name)
      AND octet_length(tool_name) BETWEEN 1 AND 120
    ),

  CONSTRAINT agent_confirmations_summary_check
    CHECK (
      summary = btrim(summary)
      AND octet_length(summary) BETWEEN 1 AND 1000
    ),

  CONSTRAINT agent_confirmations_plan_json_object_check
    CHECK (jsonb_typeof(plan_json) = 'object'),

  CONSTRAINT agent_confirmations_plan_json_size_check
    CHECK (octet_length(plan_json::text) <= 65536),

  CONSTRAINT agent_confirmations_expires_at_order_check
    CHECK (expires_at > created_at),

  CONSTRAINT agent_confirmations_approved_at_order_check
    CHECK (approved_at IS NULL OR approved_at >= created_at),

  CONSTRAINT agent_confirmations_rejected_at_order_check
    CHECK (rejected_at IS NULL OR rejected_at >= created_at),

  CONSTRAINT agent_confirmations_status_timestamp_check
    CHECK (
      (
        status = 'pending'
        AND approved_at IS NULL
        AND rejected_at IS NULL
        AND approved_by_user_id IS NULL
        AND rejected_by_user_id IS NULL
      )
      OR
      (
        status = 'approved'
        AND approved_at IS NOT NULL
        AND rejected_at IS NULL
        AND rejected_by_user_id IS NULL
      )
      OR
      (
        status = 'rejected'
        AND rejected_at IS NOT NULL
        AND approved_at IS NULL
        AND approved_by_user_id IS NULL
      )
      OR
      (
        status = 'expired'
        AND approved_at IS NULL
        AND rejected_at IS NULL
        AND approved_by_user_id IS NULL
        AND rejected_by_user_id IS NULL
      )
    )
);

CREATE UNIQUE INDEX ux_agent_confirmations_run_pending
  ON public.agent_confirmations(run_id)
  WHERE status = 'pending';

CREATE INDEX idx_agent_confirmations_run_id
  ON public.agent_confirmations(run_id);

CREATE INDEX idx_agent_confirmations_run_status
  ON public.agent_confirmations(run_id, status);

CREATE INDEX idx_agent_confirmations_expires_at_pending
  ON public.agent_confirmations(expires_at)
  WHERE status = 'pending';

CREATE INDEX idx_agent_confirmations_approved_by_user_id
  ON public.agent_confirmations(approved_by_user_id);

CREATE INDEX idx_agent_confirmations_rejected_by_user_id
  ON public.agent_confirmations(rejected_by_user_id);

CREATE TRIGGER trg_agent_confirmations_updated_at
BEFORE UPDATE ON public.agent_confirmations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  run_id UUID NOT NULL,

  step_id UUID
    REFERENCES public.agent_steps(id) ON DELETE SET NULL,

  confirmation_id UUID
    REFERENCES public.agent_confirmations(id) ON DELETE SET NULL,

  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,

  level TEXT NOT NULL DEFAULT 'info',
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,

  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  resource_refs JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agent_logs_actor_type_check
    CHECK (actor_type IN ('user', 'app_server', 'ai_worker', 'system')),

  CONSTRAINT agent_logs_level_check
    CHECK (level IN ('debug', 'info', 'warn', 'error')),

  CONSTRAINT agent_logs_event_type_check
    CHECK (
      event_type = btrim(event_type)
      AND octet_length(event_type) BETWEEN 1 AND 120
    ),

  CONSTRAINT agent_logs_message_check
    CHECK (
      message = btrim(message)
      AND octet_length(message) BETWEEN 1 AND 2000
    ),

  CONSTRAINT agent_logs_metadata_json_object_check
    CHECK (jsonb_typeof(metadata_json) = 'object'),

  CONSTRAINT agent_logs_resource_refs_array_check
    CHECK (jsonb_typeof(resource_refs) = 'array'),

  CONSTRAINT agent_logs_metadata_json_size_check
    CHECK (octet_length(metadata_json::text) <= 32768),

  CONSTRAINT agent_logs_resource_refs_size_check
    CHECK (octet_length(resource_refs::text) <= 32768)
);

ALTER TABLE public.agent_logs
  ADD CONSTRAINT agent_logs_run_same_workspace_fk
  FOREIGN KEY (run_id, workspace_id)
  REFERENCES public.agent_runs(id, workspace_id)
  ON DELETE CASCADE;

CREATE INDEX idx_agent_logs_workspace_created_at
  ON public.agent_logs(workspace_id, created_at DESC);

CREATE INDEX idx_agent_logs_run_created_at
  ON public.agent_logs(run_id, created_at);

CREATE INDEX idx_agent_logs_step_id
  ON public.agent_logs(step_id)
  WHERE step_id IS NOT NULL;

CREATE INDEX idx_agent_logs_confirmation_id
  ON public.agent_logs(confirmation_id)
  WHERE confirmation_id IS NOT NULL;

CREATE INDEX idx_agent_logs_level_event_type
  ON public.agent_logs(level, event_type);

CREATE INDEX idx_agent_logs_actor_user_id
  ON public.agent_logs(actor_user_id)
  WHERE actor_user_id IS NOT NULL;

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_logs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.agent_runs IS
  'Workspace-scoped Agent prompt run history. Prompt and final answer are stored; provider raw payloads and secrets are not.';

COMMENT ON COLUMN public.agent_runs.client_request_id IS
  'Optional client idempotency key, unique per Workspace and requester while requester is retained.';

COMMENT ON TABLE public.agent_steps IS
  'Bounded Agent step execution summaries. input_json and output_json store only minimal JSON summaries.';

COMMENT ON TABLE public.agent_confirmations IS
  'Write-tool approval plan storage. plan_json is the server-side execution source after approval.';

COMMENT ON TABLE public.agent_logs IS
  'Agent-specific diagnostic event log with bounded metadata. Do not store provider raw payloads, transcripts, tokens, or secrets.';

COMMIT;
