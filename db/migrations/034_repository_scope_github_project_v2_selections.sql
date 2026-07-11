BEGIN;

ALTER TYPE github_sync_target ADD VALUE IF NOT EXISTS 'source';

DELETE FROM github_project_v2_selections;

ALTER TABLE github_project_v2_selections
  ADD COLUMN repository_id UUID NOT NULL
    REFERENCES github_repositories(id) ON DELETE CASCADE;

ALTER TABLE github_project_v2_selections
  DROP CONSTRAINT github_project_v2_selections_pkey;

ALTER TABLE github_project_v2_selections
  ADD PRIMARY KEY (repository_id, project_v2_id);

CREATE INDEX idx_github_project_v2_selections_installation_repository
  ON github_project_v2_selections(installation_id, repository_id);

ALTER TABLE github_project_v2_selections ENABLE ROW LEVEL SECURITY;

COMMIT;
