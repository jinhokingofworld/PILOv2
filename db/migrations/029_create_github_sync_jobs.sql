-- Durable queue state for asynchronous GitHub synchronization.
ALTER TABLE github_sync_runs
  ALTER COLUMN status SET DEFAULT 'queued';

CREATE TABLE github_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id UUID NOT NULL UNIQUE REFERENCES github_sync_runs(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'success', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_github_sync_jobs_runnable
  ON github_sync_jobs(status, lease_expires_at)
  WHERE status IN ('queued', 'running');

CREATE INDEX idx_github_sync_runs_queued
  ON github_sync_runs(created_at)
  WHERE status = 'queued';
