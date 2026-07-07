-- Scope GitHub source identity to each workspace/local parent so sync upserts
-- cannot reassign rows between workspaces.

ALTER TABLE github_installations
  DROP CONSTRAINT IF EXISTS github_installations_github_installation_id_key,
  ADD CONSTRAINT uq_github_installations_workspace_installation
    UNIQUE (workspace_id, github_installation_id);

ALTER TABLE github_repositories
  DROP CONSTRAINT IF EXISTS github_repositories_github_repository_id_key,
  DROP CONSTRAINT IF EXISTS github_repositories_github_node_id_key,
  ADD CONSTRAINT uq_github_repositories_workspace_repository_id
    UNIQUE (workspace_id, github_repository_id),
  ADD CONSTRAINT uq_github_repositories_workspace_node_id
    UNIQUE (workspace_id, github_node_id);

ALTER TABLE github_issues
  DROP CONSTRAINT IF EXISTS github_issues_github_issue_id_key,
  DROP CONSTRAINT IF EXISTS github_issues_github_node_id_key,
  ADD CONSTRAINT uq_github_issues_workspace_issue_id
    UNIQUE (workspace_id, github_issue_id),
  ADD CONSTRAINT uq_github_issues_workspace_node_id
    UNIQUE (workspace_id, github_node_id);

ALTER TABLE github_pull_requests
  DROP CONSTRAINT IF EXISTS github_pull_requests_github_pull_request_id_key,
  DROP CONSTRAINT IF EXISTS github_pull_requests_github_node_id_key,
  ADD CONSTRAINT uq_github_pull_requests_workspace_pr_id
    UNIQUE (workspace_id, github_pull_request_id),
  ADD CONSTRAINT uq_github_pull_requests_workspace_node_id
    UNIQUE (workspace_id, github_node_id);

ALTER TABLE github_projects_v2
  DROP CONSTRAINT IF EXISTS github_projects_v2_github_project_node_id_key,
  ADD CONSTRAINT uq_github_projects_v2_workspace_node_id
    UNIQUE (workspace_id, github_project_node_id);

ALTER TABLE github_project_v2_fields
  DROP CONSTRAINT IF EXISTS github_project_v2_fields_github_field_node_id_key,
  ADD CONSTRAINT uq_github_project_v2_fields_project_node_id
    UNIQUE (project_v2_id, github_field_node_id);

ALTER TABLE github_project_v2_items
  DROP CONSTRAINT IF EXISTS github_project_v2_items_github_project_item_node_id_key,
  ADD CONSTRAINT uq_github_project_v2_items_project_node_id
    UNIQUE (project_v2_id, github_project_item_node_id);
