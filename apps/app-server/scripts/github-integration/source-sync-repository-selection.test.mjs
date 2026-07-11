import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GithubSyncExecutorService } = require("../../dist/modules/github-integration/github-sync-executor.service.js");

const migrationPath = new URL(
  "../../../../db/migrations/034_repository_scope_github_project_v2_selections.sql",
  import.meta.url
);

assert.equal(
  existsSync(migrationPath),
  true,
  "migration 034 must make ProjectV2 selection repository-scoped"
);

const migration = readFileSync(migrationPath, "utf8");
assert.match(migration, /DELETE FROM github_project_v2_selections/i);
assert.match(migration, /ADD COLUMN repository_id UUID NOT NULL[\s\S]*REFERENCES github_repositories\(id\) ON DELETE CASCADE/i);
assert.match(migration, /DROP CONSTRAINT github_project_v2_selections_pkey/i);
assert.match(migration, /PRIMARY KEY \(repository_id, project_v2_id\)/i);
assert.match(migration, /idx_github_project_v2_selections_installation_repository/i);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
assert.doesNotMatch(migration, /DELETE FROM github_projects_v2|DELETE FROM github_project_v2_fields|DELETE FROM github_project_v2_items|DELETE FROM github_issues|DELETE FROM github_pull_requests|DELETE FROM boards/i);

const executor = new GithubSyncExecutorService({}, {});
const calls = [];
executor.syncGithubRepositories = async () => {
  calls.push("repositories");
  return { fetchedCount: 2, createdCount: 1, updatedCount: 1, skippedCount: 0, cursor: {} };
};
executor.syncGithubIssues = async () => {
  calls.push("issues");
  return { fetchedCount: 3, createdCount: 2, updatedCount: 1, skippedCount: 0, cursor: {} };
};
executor.syncGithubPullRequests = async () => {
  calls.push("pull_requests");
  return { fetchedCount: 4, createdCount: 3, updatedCount: 1, skippedCount: 0, cursor: {} };
};
executor.syncGithubProjectV2Discovery = async () => {
  throw new Error("source sync must not discover ProjectV2 metadata");
};
executor.syncGithubProjectV2Fields = async () => {
  throw new Error("source sync must not sync ProjectV2 fields");
};
executor.syncGithubProjectV2Items = async () => {
  throw new Error("source sync must not sync ProjectV2 items");
};
executor.hydrateExistingBoardsForGithubProjectV2 = async () => {
  throw new Error("source sync must not hydrate Boards");
};
executor.reportGithubSyncProgress = async () => {};

const summary = await executor.runGithubSyncTarget("source", {
  currentUserId: "user-id",
  workspaceId: "workspace-id",
  installation: { id: "installation-id", github_installation_id: 1 },
  repository: null,
  projectV2: null,
  githubUserAccessToken: null,
  config: {}
});

assert.deepEqual(calls, ["repositories", "issues", "pull_requests"]);
assert.deepEqual(summary, {
  fetchedCount: 9,
  createdCount: 6,
  updatedCount: 3,
  skippedCount: 0,
  cursor: {}
});

const callbackSource = readFileSync(
  new URL("../../src/modules/github-integration/github-app-installation.service.ts", import.meta.url),
  "utf8"
);
assert.match(callbackSource, /target:\s*"source"/);
assert.match(callbackSource, /syncRunId\s*=\s*syncRun\.id/);
assert.match(callbackSource, /instanceof GithubSyncJobEnqueueError/);
assert.match(callbackSource, /syncRunId\s*=\s*error\.syncRunId/);

console.log("Repository-scoped source sync Task 1 tests passed");
