-- Extend immutable Agent request context to carry a validated Canvas snapshot
-- while keeping SQLtoERD and PR Review contexts compact.

BEGIN;

ALTER TABLE public.agent_runs
  DROP CONSTRAINT agent_runs_request_context_size_check,
  DROP CONSTRAINT agent_runs_request_context_shape_check;

ALTER TABLE public.agent_runs
  ADD CONSTRAINT agent_runs_request_context_size_check
  CHECK (
    request_context_json IS NULL
    OR octet_length(request_context_json::text) <= 262144
  ),
  ADD CONSTRAINT agent_runs_request_context_shape_check
  CHECK (
    request_context_json IS NULL
    OR ((CASE
      WHEN jsonb_typeof(request_context_json) = 'object'
        AND request_context_json->>'surface' IN ('sql_erd', 'pr_review') THEN
          request_context_json ?& ARRAY['surface', 'sessionId']
          AND (request_context_json - 'surface' - 'sessionId') = '{}'::jsonb
          AND request_context_json->>'sessionId' ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      WHEN jsonb_typeof(request_context_json) = 'object'
        AND request_context_json->>'surface' = 'canvas' THEN
          request_context_json ?& ARRAY['surface', 'canvasId', 'canvasContext']
          AND (request_context_json - 'surface' - 'canvasId' - 'canvasContext') = '{}'::jsonb
          AND request_context_json->>'canvasId' ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND jsonb_typeof(request_context_json->'canvasContext') = 'object'
      ELSE FALSE
    END) IS TRUE)
  );

COMMENT ON COLUMN public.agent_runs.request_context_json IS
  'Server-validated immutable request context. Supports compact SQLtoERD/PR Review context and Canvas selection snapshots.';

COMMIT;
