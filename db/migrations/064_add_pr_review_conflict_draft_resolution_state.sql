BEGIN;

ALTER TABLE public.pr_review_conflict_drafts
  ADD COLUMN resolution_state JSONB NOT NULL DEFAULT jsonb_build_object(
    'resolutionChoices', jsonb_build_object(),
    'acceptedAiResolvedTexts', jsonb_build_object(),
    'manualResolvedTexts', jsonb_build_object(),
    'isCustomized', true
  );

ALTER TABLE public.pr_review_conflict_drafts
  ADD CONSTRAINT pr_review_conflict_drafts_resolution_state_object_check
  CHECK (jsonb_typeof(resolution_state) = 'object');

COMMENT ON COLUMN public.pr_review_conflict_drafts.resolution_state IS
  'Durable hunk selection and direct-edit state. Existing drafts default to direct-edit to avoid overwriting unknown user changes.';

COMMIT;
