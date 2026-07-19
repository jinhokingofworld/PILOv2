BEGIN;

ALTER TABLE public.agent_candidate_selections
  DROP CONSTRAINT agent_candidate_selections_resource_type_check,
  DROP CONSTRAINT agent_candidate_selections_action_item_report_check;

ALTER TABLE public.agent_candidate_selections
  ADD COLUMN domain TEXT NOT NULL DEFAULT 'meeting',
  ADD COLUMN candidate_ordinal SMALLINT;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tool_step_id
      ORDER BY created_at ASC, id ASC
    )::SMALLINT AS candidate_ordinal
  FROM public.agent_candidate_selections
)
UPDATE public.agent_candidate_selections AS candidate
SET candidate_ordinal = ranked.candidate_ordinal
FROM ranked
WHERE ranked.id = candidate.id;

ALTER TABLE public.agent_candidate_selections
  ALTER COLUMN resource_id TYPE TEXT USING resource_id::TEXT,
  ADD CONSTRAINT agent_candidate_selections_domain_check
    CHECK (domain = btrim(domain) AND octet_length(domain) BETWEEN 1 AND 100),
  ADD CONSTRAINT agent_candidate_selections_resource_type_check
    CHECK (
      resource_type = btrim(resource_type)
      AND octet_length(resource_type) BETWEEN 1 AND 100
    ),
  ADD CONSTRAINT agent_candidate_selections_resource_id_check
    CHECK (
      resource_id = btrim(resource_id)
      AND octet_length(resource_id) BETWEEN 1 AND 500
    ),
  ADD CONSTRAINT agent_candidate_selections_ordinal_check
    CHECK (candidate_ordinal BETWEEN 1 AND 10),
  ADD CONSTRAINT agent_candidate_selections_action_item_report_check
    CHECK (
      (
        domain = 'meeting'
        AND resource_type = 'meeting_report_action_item'
        AND report_id IS NOT NULL
      )
      OR (
        NOT (domain = 'meeting' AND resource_type = 'meeting_report_action_item')
        AND report_id IS NULL
      )
    ),
  ADD CONSTRAINT agent_candidate_selections_generation_ordinal_key
    UNIQUE (tool_step_id, candidate_ordinal);

CREATE INDEX idx_agent_candidate_selections_latest_generation
  ON public.agent_candidate_selections(
    run_id,
    tool_step_id,
    candidate_ordinal
  )
  WHERE consumed_at IS NULL;

COMMENT ON COLUMN public.agent_candidate_selections.tool_step_id IS
  'The completed clarification tool step is the server-owned candidate generation.';
COMMENT ON COLUMN public.agent_candidate_selections.domain IS
  'Domain adapter key used to revalidate a candidate immediately before consumption.';
COMMENT ON COLUMN public.agent_candidate_selections.candidate_ordinal IS
  'Stable 1-based position within one clarification tool-step generation.';

COMMIT;
