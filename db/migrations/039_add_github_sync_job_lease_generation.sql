BEGIN;

ALTER TABLE github_sync_jobs
  ADD COLUMN lease_generation BIGINT NOT NULL DEFAULT 0
  CHECK (lease_generation >= 0);

COMMIT;
