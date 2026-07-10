-- Create Canvas AI runtime, semantic routing, and per-user draft storage.
-- Canvas AI plans bounded Canvas-only actions asynchronously. Canvas mutations
-- remain owned by the App Server and are only persisted after a user applies a draft.

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.canvas
  ADD CONSTRAINT canvas_id_workspace_unique
  UNIQUE (id, workspace_id);

CREATE TABLE public.canvas_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL,
  canvas_id UUID NOT NULL,
  requested_by_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,

  parent_agent_run_id UUID
    REFERENCES public.agent_runs(id) ON DELETE SET NULL,

  source TEXT NOT NULL DEFAULT 'canvas_chat',
  status TEXT NOT NULL DEFAULT 'queued',

  prompt TEXT NOT NULL,
  context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  canvas_revision BIGINT,
  result_summary TEXT,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_request_id TEXT,

  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),

  CONSTRAINT canvas_agent_runs_canvas_workspace_fk
    FOREIGN KEY (canvas_id, workspace_id)
    REFERENCES public.canvas(id, workspace_id)
    ON DELETE CASCADE,

  CONSTRAINT canvas_agent_runs_id_canvas_unique
    UNIQUE (id, canvas_id),

  CONSTRAINT canvas_agent_runs_source_check
    CHECK (source IN ('canvas_chat', 'general_agent_delegate')),

  CONSTRAINT canvas_agent_runs_status_check
    CHECK (status IN (
      'queued',
      'planning',
      'executing',
      'draft_ready',
      'completed',
      'failed',
      'cancelled',
      'expired'
    )),

  CONSTRAINT canvas_agent_runs_prompt_check
    CHECK (
      prompt = btrim(prompt)
      AND octet_length(prompt) BETWEEN 1 AND 32768
    ),

  CONSTRAINT canvas_agent_runs_canvas_revision_check
    CHECK (canvas_revision IS NULL OR canvas_revision >= 0),

  CONSTRAINT canvas_agent_runs_context_json_object_check
    CHECK (jsonb_typeof(context_json) = 'object'),

  CONSTRAINT canvas_agent_runs_context_json_size_check
    CHECK (octet_length(context_json::text) <= 65536),

  CONSTRAINT canvas_agent_runs_result_summary_check
    CHECK (result_summary IS NULL OR octet_length(result_summary) <= 2000),

  CONSTRAINT canvas_agent_runs_result_json_object_check
    CHECK (jsonb_typeof(result_json) = 'object'),

  CONSTRAINT canvas_agent_runs_result_json_size_check
    CHECK (octet_length(result_json::text) <= 65536),

  CONSTRAINT canvas_agent_runs_client_request_id_check
    CHECK (
      client_request_id IS NULL
      OR (
        client_request_id = btrim(client_request_id)
        AND octet_length(client_request_id) BETWEEN 1 AND 128
      )
    ),

  CONSTRAINT canvas_agent_runs_error_code_check
    CHECK (error_code IS NULL OR octet_length(error_code) BETWEEN 1 AND 80),

  CONSTRAINT canvas_agent_runs_error_message_check
    CHECK (error_message IS NULL OR octet_length(error_message) <= 4096),

  CONSTRAINT canvas_agent_runs_completed_at_order_check
    CHECK (completed_at IS NULL OR completed_at >= created_at),

  CONSTRAINT canvas_agent_runs_expires_at_order_check
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX ux_canvas_agent_runs_client_request
  ON public.canvas_agent_runs(
    workspace_id,
    canvas_id,
    requested_by_user_id,
    client_request_id
  )
  WHERE client_request_id IS NOT NULL;

CREATE INDEX idx_canvas_agent_runs_canvas_requester_created_at
  ON public.canvas_agent_runs(canvas_id, requested_by_user_id, created_at DESC);

CREATE INDEX idx_canvas_agent_runs_workspace_status_created_at
  ON public.canvas_agent_runs(workspace_id, status, created_at DESC);

CREATE INDEX idx_canvas_agent_runs_parent_agent_run_id
  ON public.canvas_agent_runs(parent_agent_run_id)
  WHERE parent_agent_run_id IS NOT NULL;

CREATE INDEX idx_canvas_agent_runs_expires_at
  ON public.canvas_agent_runs(expires_at);

CREATE TABLE public.canvas_agent_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  run_id UUID NOT NULL
    REFERENCES public.canvas_agent_runs(id) ON DELETE CASCADE,

  step_order INTEGER NOT NULL,
  action_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',

  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  resource_refs JSONB NOT NULL DEFAULT '[]'::jsonb,

  model_name TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,

  error_code TEXT,
  error_message TEXT,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT canvas_agent_steps_run_order_unique
    UNIQUE (run_id, step_order),

  CONSTRAINT canvas_agent_steps_step_order_check
    CHECK (step_order > 0),

  CONSTRAINT canvas_agent_steps_action_name_check
    CHECK (
      action_name = btrim(action_name)
      AND octet_length(action_name) BETWEEN 1 AND 120
    ),

  CONSTRAINT canvas_agent_steps_status_check
    CHECK (status IN ('pending', 'planning', 'running', 'completed', 'failed', 'skipped')),

  CONSTRAINT canvas_agent_steps_input_json_object_check
    CHECK (jsonb_typeof(input_json) = 'object'),

  CONSTRAINT canvas_agent_steps_output_json_object_check
    CHECK (jsonb_typeof(output_json) = 'object'),

  CONSTRAINT canvas_agent_steps_resource_refs_array_check
    CHECK (jsonb_typeof(resource_refs) = 'array'),

  CONSTRAINT canvas_agent_steps_input_json_size_check
    CHECK (octet_length(input_json::text) <= 32768),

  CONSTRAINT canvas_agent_steps_output_json_size_check
    CHECK (octet_length(output_json::text) <= 65536),

  CONSTRAINT canvas_agent_steps_resource_refs_size_check
    CHECK (octet_length(resource_refs::text) <= 65536),

  CONSTRAINT canvas_agent_steps_model_name_check
    CHECK (model_name IS NULL OR octet_length(model_name) BETWEEN 1 AND 160),

  CONSTRAINT canvas_agent_steps_input_tokens_check
    CHECK (input_tokens IS NULL OR input_tokens >= 0),

  CONSTRAINT canvas_agent_steps_output_tokens_check
    CHECK (output_tokens IS NULL OR output_tokens >= 0),

  CONSTRAINT canvas_agent_steps_error_code_check
    CHECK (error_code IS NULL OR octet_length(error_code) BETWEEN 1 AND 80),

  CONSTRAINT canvas_agent_steps_error_message_check
    CHECK (error_message IS NULL OR octet_length(error_message) <= 4096),

  CONSTRAINT canvas_agent_steps_time_order_check
    CHECK (
      completed_at IS NULL
      OR started_at IS NULL
      OR completed_at >= started_at
    )
);

CREATE INDEX idx_canvas_agent_steps_run_status
  ON public.canvas_agent_steps(run_id, status);

CREATE INDEX idx_canvas_agent_steps_action_name
  ON public.canvas_agent_steps(action_name);

CREATE TABLE public.canvas_agent_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  run_id UUID NOT NULL,
  canvas_id UUID NOT NULL,
  created_by_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,

  status TEXT NOT NULL DEFAULT 'preview',
  draft_spec_json JSONB NOT NULL,
  applied_shape_ids JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),

  CONSTRAINT canvas_agent_drafts_run_canvas_fk
    FOREIGN KEY (run_id, canvas_id)
    REFERENCES public.canvas_agent_runs(id, canvas_id)
    ON DELETE CASCADE,

  CONSTRAINT canvas_agent_drafts_status_check
    CHECK (status IN ('preview', 'applied', 'discarded', 'expired')),

  CONSTRAINT canvas_agent_drafts_spec_object_check
    CHECK (jsonb_typeof(draft_spec_json) = 'object'),

  CONSTRAINT canvas_agent_drafts_applied_shape_ids_array_check
    CHECK (jsonb_typeof(applied_shape_ids) = 'array'),

  CONSTRAINT canvas_agent_drafts_spec_size_check
    CHECK (octet_length(draft_spec_json::text) <= 65536),

  CONSTRAINT canvas_agent_drafts_applied_shape_ids_size_check
    CHECK (octet_length(applied_shape_ids::text) <= 65536),

  CONSTRAINT canvas_agent_drafts_applied_at_order_check
    CHECK (applied_at IS NULL OR applied_at >= created_at),

  CONSTRAINT canvas_agent_drafts_expires_at_order_check
    CHECK (expires_at > created_at),

  CONSTRAINT canvas_agent_drafts_status_timestamp_check
    CHECK (
      (status = 'applied' AND applied_at IS NOT NULL)
      OR (status <> 'applied' AND applied_at IS NULL)
    )
);

CREATE INDEX idx_canvas_agent_drafts_canvas_creator_created_at
  ON public.canvas_agent_drafts(canvas_id, created_by_user_id, created_at DESC);

CREATE INDEX idx_canvas_agent_drafts_run_id
  ON public.canvas_agent_drafts(run_id);

CREATE INDEX idx_canvas_agent_drafts_expires_at_preview
  ON public.canvas_agent_drafts(expires_at)
  WHERE status = 'preview';

-- Durable, Canvas-scoped indexing jobs. Job payloads contain only shape ids,
-- text hashes, and revisions; worker code must load a bounded safe-text
-- projection and must never embed raw tldraw JSON.
CREATE TABLE public.canvas_agent_embedding_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL,
  canvas_id UUID NOT NULL,
  shape_id TEXT NOT NULL
    REFERENCES public.canvas_freeform_shapes(id) ON DELETE CASCADE,

  operation TEXT NOT NULL,
  expected_shape_revision BIGINT NOT NULL,
  expected_source_text_hash TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,

  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT canvas_agent_embedding_jobs_canvas_workspace_fk
    FOREIGN KEY (canvas_id, workspace_id)
    REFERENCES public.canvas(id, workspace_id)
    ON DELETE CASCADE,

  CONSTRAINT canvas_agent_embedding_jobs_operation_check
    CHECK (operation IN ('upsert', 'delete')),

  CONSTRAINT canvas_agent_embedding_jobs_shape_revision_check
    CHECK (expected_shape_revision > 0),

  CONSTRAINT canvas_agent_embedding_jobs_source_text_hash_check
    CHECK (
      expected_source_text_hash = btrim(expected_source_text_hash)
      AND octet_length(expected_source_text_hash) BETWEEN 1 AND 128
    ),

  CONSTRAINT canvas_agent_embedding_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'superseded')),

  CONSTRAINT canvas_agent_embedding_jobs_attempt_count_check
    CHECK (attempt_count >= 0),

  CONSTRAINT canvas_agent_embedding_jobs_error_code_check
    CHECK (error_code IS NULL OR octet_length(error_code) BETWEEN 1 AND 80),

  CONSTRAINT canvas_agent_embedding_jobs_error_message_check
    CHECK (error_message IS NULL OR octet_length(error_message) <= 4096),

  CONSTRAINT canvas_agent_embedding_jobs_completed_at_order_check
    CHECK (completed_at IS NULL OR completed_at >= created_at),

  CONSTRAINT canvas_agent_embedding_jobs_unique_revision
    UNIQUE (canvas_id, shape_id, operation, expected_shape_revision)
);

CREATE INDEX idx_canvas_agent_embedding_jobs_pending
  ON public.canvas_agent_embedding_jobs(status, created_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX idx_canvas_agent_embedding_jobs_canvas_shape
  ON public.canvas_agent_embedding_jobs(canvas_id, shape_id, created_at DESC);

-- Queue a semantic-index refresh only when search-relevant Canvas text changes.
-- Geometry, color, bindings, and arbitrary raw_shape changes deliberately do
-- not create a job: they are presentation details, not retrieval content.
CREATE OR REPLACE FUNCTION public.enqueue_canvas_agent_shape_embedding_job()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_workspace_id UUID;
  v_operation TEXT;
  v_source_text_hash TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    v_operation := 'upsert';
  ELSIF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    v_operation := CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END;
  ELSIF NEW.shape_type IS DISTINCT FROM OLD.shape_type
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.text_content IS DISTINCT FROM OLD.text_content THEN
    v_operation := 'upsert';
  ELSE
    RETURN NEW;
  END IF;

  SELECT c.workspace_id
  INTO v_workspace_id
  FROM public.canvas c
  WHERE c.id = NEW.canvas_id
    AND c.board_type = 'freeform';

  IF v_workspace_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_source_text_hash := encode(
    digest(
      concat_ws(E'\n', NEW.shape_type, COALESCE(NEW.title, ''), COALESCE(NEW.text_content, '')),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.canvas_agent_embedding_jobs (
    workspace_id,
    canvas_id,
    shape_id,
    operation,
    expected_shape_revision,
    expected_source_text_hash
  )
  VALUES (
    v_workspace_id,
    NEW.canvas_id,
    NEW.id,
    v_operation,
    NEW.revision,
    v_source_text_hash
  )
  ON CONFLICT (canvas_id, shape_id, operation, expected_shape_revision)
  DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_canvas_freeform_shapes_enqueue_agent_embedding
AFTER INSERT OR UPDATE OF shape_type, title, text_content, deleted_at
ON public.canvas_freeform_shapes
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_canvas_agent_shape_embedding_job();

-- Index existing active Canvas shapes after this migration as well as future
-- writes captured by the trigger above.
INSERT INTO public.canvas_agent_embedding_jobs (
  workspace_id,
  canvas_id,
  shape_id,
  operation,
  expected_shape_revision,
  expected_source_text_hash
)
SELECT
  canvas.workspace_id,
  shape.canvas_id,
  shape.id,
  'upsert',
  shape.revision,
  encode(
    digest(
      concat_ws(
        E'\n',
        shape.shape_type,
        COALESCE(shape.title, ''),
        COALESCE(shape.text_content, '')
      ),
      'sha256'
    ),
    'hex'
  )
FROM public.canvas_freeform_shapes shape
INNER JOIN public.canvas canvas ON canvas.id = shape.canvas_id
WHERE canvas.board_type = 'freeform'
  AND shape.deleted_at IS NULL
ON CONFLICT (canvas_id, shape_id, operation, expected_shape_revision)
DO NOTHING;

-- Derived semantic-search index. The source of truth remains
-- canvas_freeform_shapes; a row is usable only when its revision and text hash
-- still match the current source shape.
CREATE TABLE public.canvas_agent_shape_embeddings (
  shape_id TEXT PRIMARY KEY
    REFERENCES public.canvas_freeform_shapes(id) ON DELETE CASCADE,

  workspace_id UUID NOT NULL,
  canvas_id UUID NOT NULL,
  shape_revision BIGINT NOT NULL,
  source_text_hash TEXT NOT NULL,

  embedding extensions.vector(384) NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_version TEXT NOT NULL,

  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT canvas_agent_shape_embeddings_canvas_workspace_fk
    FOREIGN KEY (canvas_id, workspace_id)
    REFERENCES public.canvas(id, workspace_id)
    ON DELETE CASCADE,

  CONSTRAINT canvas_agent_shape_embeddings_revision_check
    CHECK (shape_revision > 0),

  CONSTRAINT canvas_agent_shape_embeddings_source_text_hash_check
    CHECK (
      source_text_hash = btrim(source_text_hash)
      AND octet_length(source_text_hash) BETWEEN 1 AND 128
    ),

  CONSTRAINT canvas_agent_shape_embeddings_model_check
    CHECK (
      embedding_model = btrim(embedding_model)
      AND octet_length(embedding_model) BETWEEN 1 AND 160
    ),

  CONSTRAINT canvas_agent_shape_embeddings_version_check
    CHECK (
      embedding_version = btrim(embedding_version)
      AND octet_length(embedding_version) BETWEEN 1 AND 160
    ),

  CONSTRAINT canvas_agent_shape_embeddings_indexed_at_order_check
    CHECK (indexed_at >= created_at)
);

CREATE INDEX idx_canvas_agent_shape_embeddings_canvas
  ON public.canvas_agent_shape_embeddings(workspace_id, canvas_id, indexed_at DESC);

CREATE INDEX idx_canvas_agent_shape_embeddings_embedding_hnsw
  ON public.canvas_agent_shape_embeddings
  USING hnsw (embedding extensions.vector_cosine_ops);

CREATE TRIGGER trg_canvas_agent_shape_embeddings_updated_at
BEFORE UPDATE ON public.canvas_agent_shape_embeddings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- User-approved semantic routing memories. They are intentionally scoped to
-- the requesting user and Workspace so one user's phrasing never trains another
-- user's Canvas AI behavior.
CREATE TABLE public.canvas_agent_intent_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  workspace_id UUID NOT NULL
    REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,
  source_run_id UUID
    REFERENCES public.canvas_agent_runs(id) ON DELETE SET NULL,

  utterance TEXT NOT NULL,
  intent TEXT NOT NULL,
  action_template_json JSONB NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,

  embedding extensions.vector(384),
  embedding_model TEXT,
  embedding_version TEXT,
  embedding_status TEXT NOT NULL DEFAULT 'pending',
  embedding_attempt_count INTEGER NOT NULL DEFAULT 0,
  embedding_claimed_at TIMESTAMPTZ,
  embedding_error_code TEXT,
  embedding_error_message TEXT,

  source TEXT NOT NULL DEFAULT 'planner',
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by_user_id UUID
    REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  usage_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT canvas_agent_intent_examples_utterance_check
    CHECK (
      utterance = btrim(utterance)
      AND octet_length(utterance) BETWEEN 1 AND 2000
    ),

  CONSTRAINT canvas_agent_intent_examples_intent_check
    CHECK (intent IN (
      'find_canvas_tool',
      'find_shapes',
      'select_shapes',
      'focus_viewport',
      'create_draft',
      'create_code_block'
    )),

  CONSTRAINT canvas_agent_intent_examples_action_template_object_check
    CHECK (jsonb_typeof(action_template_json) = 'object'),

  CONSTRAINT canvas_agent_intent_examples_action_template_size_check
    CHECK (octet_length(action_template_json::text) <= 8192),

  CONSTRAINT canvas_agent_intent_examples_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1),

  CONSTRAINT canvas_agent_intent_examples_model_check
    CHECK (
      embedding_model IS NULL
      OR (
        embedding_model = btrim(embedding_model)
        AND octet_length(embedding_model) BETWEEN 1 AND 160
      )
    ),

  CONSTRAINT canvas_agent_intent_examples_version_check
    CHECK (
      embedding_version IS NULL
      OR (
        embedding_version = btrim(embedding_version)
        AND octet_length(embedding_version) BETWEEN 1 AND 160
      )
    ),

  CONSTRAINT canvas_agent_intent_examples_embedding_status_check
    CHECK (embedding_status IN ('pending', 'processing', 'completed', 'failed')),

  CONSTRAINT canvas_agent_intent_examples_embedding_attempt_count_check
    CHECK (embedding_attempt_count >= 0),

  CONSTRAINT canvas_agent_intent_examples_embedding_error_code_check
    CHECK (embedding_error_code IS NULL OR octet_length(embedding_error_code) BETWEEN 1 AND 80),

  CONSTRAINT canvas_agent_intent_examples_embedding_error_message_check
    CHECK (embedding_error_message IS NULL OR octet_length(embedding_error_message) <= 4096),

  CONSTRAINT canvas_agent_intent_examples_embedding_state_check
    CHECK (
      (embedding_status = 'completed'
        AND embedding IS NOT NULL
        AND embedding_model IS NOT NULL
        AND embedding_version IS NOT NULL)
      OR (embedding_status <> 'completed' AND embedding IS NULL)
    ),

  CONSTRAINT canvas_agent_intent_examples_source_check
    CHECK (source IN ('planner', 'seed')),

  CONSTRAINT canvas_agent_intent_examples_status_check
    CHECK (status IN ('pending', 'active', 'rejected', 'expired')),

  CONSTRAINT canvas_agent_intent_examples_review_check
    CHECK (
      (status = 'pending' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
      OR (status IN ('active', 'rejected') AND reviewed_at IS NOT NULL)
      OR (status = 'expired' AND reviewed_by_user_id IS NULL)
    ),

  CONSTRAINT canvas_agent_intent_examples_active_embedding_check
    CHECK (status <> 'active' OR embedding_status = 'completed'),

  CONSTRAINT canvas_agent_intent_examples_usage_count_check
    CHECK (usage_count >= 0),

  CONSTRAINT canvas_agent_intent_examples_expires_at_order_check
    CHECK (expires_at > created_at)
);

CREATE INDEX idx_canvas_agent_intent_examples_owner_status
  ON public.canvas_agent_intent_examples(workspace_id, owner_user_id, status, created_at DESC);

CREATE INDEX idx_canvas_agent_intent_examples_source_run
  ON public.canvas_agent_intent_examples(source_run_id)
  WHERE source_run_id IS NOT NULL;

CREATE UNIQUE INDEX idx_canvas_agent_intent_examples_source_run_unique
  ON public.canvas_agent_intent_examples(source_run_id)
  WHERE source_run_id IS NOT NULL;

CREATE INDEX idx_canvas_agent_intent_examples_active_embedding_hnsw
  ON public.canvas_agent_intent_examples
  USING hnsw (embedding extensions.vector_cosine_ops)
  WHERE status = 'active' AND embedding_status = 'completed';

CREATE TRIGGER trg_canvas_agent_intent_examples_updated_at
BEFORE UPDATE ON public.canvas_agent_intent_examples
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.canvas_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_agent_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_agent_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_agent_embedding_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_agent_shape_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_agent_intent_examples ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.canvas_agent_runs IS
  'Canvas-scoped asynchronous AI run history. Stores bounded prompt and result summaries, not provider raw payloads or secrets.';

COMMENT ON TABLE public.canvas_agent_steps IS
  'Bounded Canvas AI planner and action summaries. input_json and output_json must not contain full raw shapes, provider payloads, or secrets.';

COMMENT ON TABLE public.canvas_agent_drafts IS
  'Per-user Canvas AI draft specifications. Drafts are previews until explicitly applied through CanvasService.';

COMMENT ON TABLE public.canvas_agent_embedding_jobs IS
  'Durable Canvas shape embedding jobs. Contains bounded identifiers and hashes only; it must not contain raw tldraw shapes or external-domain data.';

COMMENT ON TABLE public.canvas_agent_shape_embeddings IS
  'Canvas-only semantic-search index. Embeddings are derived from safe Canvas text and must match the current source shape revision and text hash.';

COMMENT ON TABLE public.canvas_agent_intent_examples IS
  'Per-user, Workspace-scoped Canvas AI phrasing memories. Only user-approved active examples may drive an automatic Canvas action.';

COMMENT ON COLUMN public.canvas_agent_runs.canvas_revision IS
  'Canvas latest_op_seq observed when the run started. Used to detect stale draft inputs before applying a draft.';

COMMENT ON COLUMN public.canvas_agent_runs.context_json IS
  'Bounded request context such as selected shape ids and viewport. Do not store raw Canvas snapshots.';

COMMENT ON COLUMN public.canvas_agent_runs.source IS
  'Canvas chat or a generic Agent delegation. Both sources are limited to Canvas actions and cannot access Calendar, Issue, PR, Meeting, or other external-domain data.';

COMMENT ON COLUMN public.canvas_agent_runs.parent_agent_run_id IS
  'Optional generic Agent run that delegated work to Canvas AI.';

COMMENT ON COLUMN public.canvas_agent_drafts.draft_spec_json IS
  'Validated CanvasDraftSpec only. Do not store raw tldraw shape payloads here.';

COMMENT ON COLUMN public.canvas_agent_intent_examples.action_template_json IS
  'Validated Canvas action template only. Never store fixed shape ids, raw shapes, provider payloads, or external-domain actions.';

COMMIT;
