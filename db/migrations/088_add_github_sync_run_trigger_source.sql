BEGIN;

ALTER TABLE public.github_sync_runs
  ADD COLUMN trigger_source TEXT;

UPDATE public.github_sync_runs
SET trigger_source = 'legacy'
WHERE trigger_source IS NULL;

ALTER TABLE public.github_sync_runs
  ALTER COLUMN trigger_source SET DEFAULT 'legacy',
  ALTER COLUMN trigger_source SET NOT NULL,
  ADD CONSTRAINT github_sync_runs_trigger_source_check
    CHECK (trigger_source IN ('manual', 'automatic', 'legacy'));

CREATE INDEX idx_github_sync_runs_workspace_trigger_started
  ON public.github_sync_runs (workspace_id, trigger_source, started_at DESC, id DESC);

COMMIT;
