BEGIN;

ALTER TABLE public.review_files
  ADD COLUMN decision_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.review_files
  ADD CONSTRAINT review_files_decision_version_non_negative
  CHECK (decision_version >= 0);

COMMENT ON COLUMN public.review_files.decision_version IS
  'Monotonic optimistic concurrency version for the current file review decision.';

COMMIT;
