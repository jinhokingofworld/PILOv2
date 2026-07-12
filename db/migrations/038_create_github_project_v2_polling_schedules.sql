BEGIN;

CREATE TABLE github_project_v2_polling_schedules (
  repository_id UUID NOT NULL,
  project_v2_id UUID NOT NULL,
  requested_by_user_id UUID NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  next_poll_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active_sync_run_id UUID UNIQUE
    REFERENCES github_sync_runs(id) ON DELETE SET NULL,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (repository_id, project_v2_id),
  FOREIGN KEY (repository_id, project_v2_id)
    REFERENCES github_project_v2_selections(repository_id, project_v2_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_github_project_v2_polling_schedules_due
  ON github_project_v2_polling_schedules(next_poll_at)
  WHERE active_sync_run_id IS NULL;

CREATE TRIGGER trg_github_project_v2_polling_schedules_updated_at
BEFORE UPDATE ON github_project_v2_polling_schedules
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE github_project_v2_polling_schedules ENABLE ROW LEVEL SECURITY;

COMMIT;
