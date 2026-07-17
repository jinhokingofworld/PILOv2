-- Extend the immutable Agent request context contract to PR Review revisions.

BEGIN;

ALTER TABLE public.agent_runs
  DROP CONSTRAINT agent_runs_request_context_shape_check;

ALTER TABLE public.agent_runs
  ADD CONSTRAINT agent_runs_request_context_shape_check
  CHECK (
    request_context_json IS NULL
    OR ((CASE
      WHEN jsonb_typeof(request_context_json) = 'object' THEN
        request_context_json ?& ARRAY['surface', 'sessionId']
        AND (request_context_json - 'surface' - 'sessionId') = '{}'::jsonb
        AND request_context_json->>'surface' IN ('sql_erd', 'pr_review')
        AND request_context_json->>'sessionId' ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      ELSE FALSE
    END) IS TRUE)
  );

COMMENT ON COLUMN public.agent_runs.request_context_json IS
  'Server-validated immutable request context snapshot. Supported shapes are {surface: sql_erd|pr_review, sessionId}.';

COMMIT;
