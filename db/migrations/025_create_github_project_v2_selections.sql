BEGIN;

CREATE TABLE github_project_v2_selections (
  installation_id UUID NOT NULL
    REFERENCES github_installations(id) ON DELETE CASCADE,
  project_v2_id UUID NOT NULL
    REFERENCES github_projects_v2(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, project_v2_id)
);

CREATE INDEX idx_github_project_v2_selections_project_v2_id
  ON github_project_v2_selections(project_v2_id);

CREATE TRIGGER trg_github_project_v2_selections_updated_at
BEFORE UPDATE ON github_project_v2_selections
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE github_project_v2_selections ENABLE ROW LEVEL SECURITY;

COMMIT;
