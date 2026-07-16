-- Add request-scoped Agent context, choice confirmation state, and the
-- SQLtoERD Agent session-creation idempotency ledger.

BEGIN;

ALTER TABLE public.agent_runs
  ADD COLUMN request_context_json JSONB;

ALTER TABLE public.agent_runs
  ADD CONSTRAINT agent_runs_request_context_object_check
  CHECK (
    request_context_json IS NULL
    OR jsonb_typeof(request_context_json) = 'object'
  ),
  ADD CONSTRAINT agent_runs_request_context_size_check
  CHECK (
    request_context_json IS NULL
    OR octet_length(request_context_json::text) <= 2048
  ),
  ADD CONSTRAINT agent_runs_request_context_shape_check
  CHECK (
    request_context_json IS NULL
    OR ((
      jsonb_object_length(request_context_json) = 2
      AND request_context_json->>'surface' = 'sql_erd'
      AND request_context_json->>'sessionId' ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) IS TRUE)
  );

ALTER TABLE public.agent_confirmations
  ADD COLUMN selected_choice_id TEXT;

ALTER TABLE public.agent_confirmations
  ADD CONSTRAINT agent_confirmations_selected_choice_id_check
  CHECK (
    selected_choice_id IS NULL
    OR (
      selected_choice_id = btrim(selected_choice_id)
      AND octet_length(selected_choice_id) BETWEEN 1 AND 128
    )
  ),
  ADD CONSTRAINT agent_confirmations_choice_state_check
  CHECK (
    (
      plan_json->>'kind' = 'choice'
      AND (
        (status = 'approved' AND selected_choice_id IS NOT NULL)
        OR (status <> 'approved' AND selected_choice_id IS NULL)
      )
    )
    OR (
      COALESCE(plan_json->>'kind', 'approval') <> 'choice'
      AND selected_choice_id IS NULL
    )
  );

ALTER TABLE public.sql_erd_sessions
  ADD CONSTRAINT sql_erd_sessions_id_workspace_unique
  UNIQUE (id, workspace_id);

CREATE TABLE public.sql_erd_agent_session_creations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,

  actor_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,

  agent_run_id UUID NOT NULL,
  request_fingerprint TEXT NOT NULL,
  session_id UUID NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sql_erd_agent_session_creations_fingerprint_check
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),

  CONSTRAINT sql_erd_agent_session_creations_run_workspace_fk
    FOREIGN KEY (agent_run_id, workspace_id)
    REFERENCES public.agent_runs(id, workspace_id)
    ON DELETE CASCADE,

  CONSTRAINT sql_erd_agent_session_creations_session_workspace_fk
    FOREIGN KEY (session_id, workspace_id)
    REFERENCES public.sql_erd_sessions(id, workspace_id)
    ON DELETE CASCADE,

  CONSTRAINT sql_erd_agent_session_creations_idempotency_unique
    UNIQUE (workspace_id, actor_user_id, agent_run_id)
);

CREATE INDEX idx_sql_erd_agent_session_creations_session_id
  ON public.sql_erd_agent_session_creations(session_id);

ALTER TABLE public.sql_erd_agent_session_creations ENABLE ROW LEVEL SECURITY;

COMMENT ON COLUMN public.agent_runs.request_context_json IS
  'Server-validated immutable request context snapshot. Phase 1 supports only {surface: sql_erd, sessionId}.';

COMMENT ON COLUMN public.agent_confirmations.selected_choice_id IS
  'Choice confirmation selection stored atomically with approval. Null for approval plans and non-approved rows.';

COMMENT ON TABLE public.sql_erd_agent_session_creations IS
  'Idempotency ledger for SQLtoERD sessions created by Agent runs.';

COMMIT;
