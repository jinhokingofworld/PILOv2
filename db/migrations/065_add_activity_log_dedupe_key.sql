-- Adds the common Activity Log idempotency key used by domain writers.

BEGIN;

ALTER TABLE public.activity_logs
  ADD COLUMN dedupe_key TEXT;

UPDATE public.activity_logs
SET dedupe_key = 'legacy:' || id::text
WHERE dedupe_key IS NULL;

ALTER TABLE public.activity_logs
  ALTER COLUMN dedupe_key SET NOT NULL,
  ADD CONSTRAINT activity_logs_dedupe_key_non_empty_check
    CHECK (length(trim(dedupe_key)) > 0);

CREATE UNIQUE INDEX unique_activity_logs_workspace_dedupe_key
  ON public.activity_logs(workspace_id, dedupe_key);

COMMENT ON COLUMN public.activity_logs.dedupe_key IS
  'Domain-provided idempotency key. Repeated delivery of one logical activity within a Workspace reuses the same key.';

COMMIT;
