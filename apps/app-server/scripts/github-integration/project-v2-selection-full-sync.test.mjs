import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const appServerRoot = resolve(import.meta.dirname, "..", "..");
const readSource = (path) => readFile(resolve(appServerRoot, path), "utf8");

const [syncRunService, syncExecutor] = await Promise.all([
  readSource("src/modules/github-integration/github-sync-run.service.ts"),
  readSource("src/modules/github-integration/github-sync-executor.service.ts")
]);

assert.match(
  syncRunService,
  /target === "full"\s*&&\s*projectV2Id[\s\S]{0,160}projectV2Id is not allowed for full sync/,
  "Full sync must reject a projectV2Id instead of treating it as a single-project exception."
);
assert.match(
  syncRunService,
  /target === "project_v2"[\s\S]{0,220}projectV2Id is required for this sync target/,
  "Explicit ProjectV2 sync targets must continue to require projectV2Id."
);
assert.match(
  syncExecutor,
  /listSelectedGithubProjectV2Selections\([\s\S]{0,180}context\.workspaceId,[\s\S]{0,120}context\.installation\.id,[\s\S]{0,120}context\.repository\?\.id \?\? null/,
  "Full sync must pass the repository context into stored ProjectV2 selection lookup."
);
assert.match(
  syncExecutor,
  /const repositoryFilter = repositoryId\s*\?\s*"AND gps\.repository_id = \$3"/,
  "Repository-scoped full sync must filter stored ProjectV2 selections by repository."
);
assert.match(
  syncExecutor,
  /getGithubProjectV2ContextsForFullSync[\s\S]{0,700}selectedProjectV2Selections/,
  "Full sync must pass stored repository-scoped selections into the discovered ProjectV2 filter."
);
assert.match(
  syncExecutor,
  /selection\.repository_id/,
  "The discovered ProjectV2 filter must retain the selected repository ID."
);
assert.match(
  syncExecutor,
  /hydrateExistingBoardsForGithubProjectV2\([\s\S]{0,160}projectV2Context\.repositoryId/,
  "Board hydration must receive the selected repository ID for each ProjectV2 selection."
);
assert.match(
  syncExecutor,
  /const uniqueProjectV2s = \[[\s\S]{0,80}new Map\([\s\S]{0,200}projectV2\.id/,
  "Fields and items must deduplicate ProjectV2 detail sync by ProjectV2 ID."
);
assert.match(
  syncExecutor,
  /uniqueProjectV2s\.length \* 2 \+ projectV2Contexts\.length/,
  "Full-sync progress must count two unique detail steps and one hydration step per selection pair."
);
assert.doesNotMatch(
  syncExecutor,
  /if \(context\.projectV2\)[\s\S]{0,180}syncGithubProjectV2\(projectContext\)/,
  "Full sync no longer performs an explicit single-project refresh before details."
);

const require = createRequire(import.meta.url);
const {
  GithubSyncExecutorService
} = require("../../dist/modules/github-integration/github-sync-executor.service.js");
const {
  GithubSyncRunService
} = require("../../dist/modules/github-integration/github-sync-run.service.js");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const installationId = "22222222-2222-4222-8222-222222222222";
const repositoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const unselectedRepositoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const selectedProjectId = "33333333-3333-4333-8333-333333333333";
const unselectedProjectId = "44444444-4444-4444-8444-444444444444";

function project(id) {
  return {
    id,
    workspace_id: workspaceId,
    installation_id: installationId,
    github_project_node_id: `PVT_${id}`,
    repositoryIds: [repositoryId, unselectedRepositoryId]
  };
}

function summary() {
  return {
    fetchedCount: 0,
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    cursor: {}
  };
}

async function assertFullSyncOnlyDetailsSelectedProjects(
  accountType,
  selectedSelections,
  repository = null
) {
  const database = {
    async query(text, values) {
      assert.match(text, /FROM github_project_v2_selections/i);
      if (repository) {
        assert.match(text, /gps\.repository_id = \$3/);
      } else {
        assert.doesNotMatch(text, /gps\.repository_id = \$3/);
      }
      assert.deepEqual(
        values,
        repository
          ? [workspaceId, installationId, repository.id]
          : [workspaceId, installationId]
      );
      return selectedSelections;
    }
  };
  const executor = new GithubSyncExecutorService(database, {});
  const detailedProjectIds = [];
  const hydratedProjectSelections = [];
  executor.syncGithubRepositories = async () => summary();
  executor.syncGithubProjectV2Discovery = async () => ({
    summary: summary(),
    projectV2s: [project(selectedProjectId), project(unselectedProjectId)]
  });
  executor.syncGithubIssues = async () => summary();
  executor.syncGithubPullRequests = async () => summary();
  executor.syncGithubProjectV2Fields = async (context) => {
    detailedProjectIds.push(`fields:${context.projectV2.id}`);
    return summary();
  };
  executor.syncGithubProjectV2Items = async (context) => {
    detailedProjectIds.push(`items:${context.projectV2.id}`);
    return summary();
  };
  executor.hydrateExistingBoardsForGithubProjectV2 = async (context, selectedRepositoryId) => {
    hydratedProjectSelections.push(`${context.projectV2.id}:${selectedRepositoryId}`);
  };

  await executor.runGithubSyncTarget("full", {
    currentUserId: "55555555-5555-4555-8555-555555555555",
    workspaceId,
    installation: {
      id: installationId,
      workspace_id: workspaceId,
      github_installation_id: 100,
      account_login: "owner",
      account_type: accountType
    },
    repository,
    projectV2: null,
    githubUserAccessToken: null,
    config: {},
    reportProgress: async () => {}
  });

  const selectedIds = [
    ...new Set(selectedSelections.map((selection) => selection.project_v2_id))
  ];
  assert.deepEqual(
    detailedProjectIds,
    selectedIds.flatMap((id) => [`fields:${id}`, `items:${id}`])
  );
  assert.deepEqual(
    hydratedProjectSelections,
    selectedSelections.map(
      (selection) => `${selection.project_v2_id}:${selection.repository_id}`
    )
  );
}

const selectedRepositorySelection = {
  project_v2_id: selectedProjectId,
  repository_id: repositoryId
};

await assertFullSyncOnlyDetailsSelectedProjects("User", [selectedRepositorySelection]);
await assertFullSyncOnlyDetailsSelectedProjects("Organization", [selectedRepositorySelection]);
await assertFullSyncOnlyDetailsSelectedProjects("Organization", []);
await assertFullSyncOnlyDetailsSelectedProjects(
  "Organization",
  [selectedRepositorySelection],
  { id: repositoryId, github_node_id: null }
);

await assertFullSyncOnlyDetailsSelectedProjects(
  "Organization",
  [selectedRepositorySelection],
  null
);

await assertFullSyncOnlyDetailsSelectedProjects("Organization", [
  selectedRepositorySelection,
  {
    project_v2_id: selectedProjectId,
    repository_id: unselectedRepositoryId
  }
]);

{
  const service = new GithubSyncRunService(
    {},
    {},
    { assertWorkspaceAccess: async () => {} },
    {},
    {}
  );
  await assert.rejects(
    () =>
      service.startGithubSyncRun("user", workspaceId, {
        target: "full",
        installationId,
        projectV2Id: selectedProjectId
      }),
    (error) => error.getResponse().error.message === "projectV2Id is not allowed for full sync"
  );
  await assert.rejects(
    () =>
      service.startGithubSyncRun("user", workspaceId, {
        target: "project_v2_fields",
        installationId
      }),
    (error) => error.getResponse().error.message === "projectV2Id is required for this sync target"
  );
}

console.log("project-v2 selection full-sync tests passed");
