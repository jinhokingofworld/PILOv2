import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GithubProjectV2Service } = require("../../dist/modules/github-integration/github-project-v2.service.js");
const { GithubSyncJobEnqueueError } = require("../../dist/modules/github-integration/github-sync-job.service.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const installationId = "33333333-3333-4333-8333-333333333333";
const repositoryId = "44444444-4444-4444-8444-444444444444";

function createService(database, syncRunService) {
  return new GithubProjectV2Service(
    database,
    { assertWorkspaceAccess: async () => {} },
    {},
    {},
    undefined,
    syncRunService
  );
}

function selectionDatabase({ repository = { id: repositoryId }, links = ["55555555-5555-4555-8555-555555555555"] } = {}) {
  return {
    writes: [],
    async transaction(callback) {
      return callback({
        queryOne: async (text) => {
          if (/FROM github_installations/i.test(text)) return { id: installationId };
          if (/FROM github_repositories/i.test(text)) return repository;
          return null;
        },
        query: async (text, values) => {
          if (/FROM github_projects_v2/i.test(text)) {
            return values[1].map((id) => ({ id, installation_id: installationId }));
          }
          if (/FROM github_project_v2_repositories/i.test(text)) {
            return links.map((project_v2_id) => ({ project_v2_id }));
          }
          throw new Error(`Unexpected query: ${text}`);
        },
        execute: async (text, values) => {
          this.writes.push({ text, values });
          return {};
        }
      });
    }
  };
}

{
  const service = createService({
    transaction: async (callback) => callback({
      queryOne: async () => ({ id: installationId }),
      query: async () => [],
      execute: async () => ({})
    })
  });

  await assert.rejects(
    () => service.replaceGithubProjectV2Selections(currentUserId, workspaceId, {
      installationId,
      projectV2Ids: []
    }),
    (error) => error.getResponse().error.message === "repositoryId is required",
    "Repository-scoped selection must reject a missing repositoryId"
  );
}

{
  const service = createService({
    queryOne: async () => ({ total: 0 }),
    query: async () => []
  });
  await assert.rejects(
    () => service.listGithubProjectsV2(currentUserId, workspaceId, {}),
    (error) => error.getResponse().error.message === "repositoryId is required",
    "ProjectV2 listing must reject an unscoped request"
  );
}

{
  const database = selectionDatabase({ links: [] });
  const service = createService(database);
  await assert.rejects(
    () => service.replaceGithubProjectV2Selections(currentUserId, workspaceId, {
      installationId,
      repositoryId,
      projectV2Ids: ["55555555-5555-4555-8555-555555555555"]
    }),
    (error) => error.getResponse().error.message === "GitHub ProjectV2 is not linked to the repository"
  );
  assert.equal(database.writes.length, 0, "an unlinked ProjectV2 must not replace a selection");
}

{
  const database = selectionDatabase({ repository: null });
  const service = createService(database);
  await assert.rejects(
    () => service.replaceGithubProjectV2Selections(currentUserId, workspaceId, {
      installationId,
      repositoryId,
      projectV2Ids: []
    }),
    (error) => error.getResponse().error.message === "GitHub repository does not belong to the installation"
  );
}

{
  const projectV2Id = "55555555-5555-4555-8555-555555555555";
  const database = selectionDatabase({ links: [projectV2Id] });
  const service = createService(database, {
    async startGithubSyncRun(_userId, _workspaceId, input) {
      assert.deepEqual(input, { installationId, repositoryId, target: "full" });
      throw new GithubSyncJobEnqueueError("66666666-6666-4666-8666-666666666666");
    }
  });
  const result = await service.replaceGithubProjectV2Selections(currentUserId, workspaceId, {
    installationId,
    repositoryId,
    projectV2Ids: [projectV2Id]
  });
  assert.deepEqual(result, {
    installationId,
    repositoryId,
    projectV2Ids: [projectV2Id],
    syncRunId: "66666666-6666-4666-8666-666666666666",
    syncStatus: "failed",
    syncError: "GitHub sync job could not be enqueued"
  });
}

{
  const root = new URL("../../../..", import.meta.url);
  const source = readFileSync(new URL("apps/app-server/src/modules/github-integration/github-project-v2.service.ts", root), "utf8");
  const dto = readFileSync(new URL("apps/app-server/src/modules/github-integration/dto/index.ts", root), "utf8");
  const controller = readFileSync(new URL("apps/app-server/src/modules/github-integration/github-integration.controller.ts", root), "utf8");
  const executor = readFileSync(new URL("apps/app-server/src/modules/github-integration/github-sync-executor.service.ts", root), "utf8");
  const client = readFileSync(new URL("apps/app-server/src/modules/github-integration/github-app.client.ts", root), "utf8");
  const queries = readFileSync(new URL("apps/app-server/src/modules/github-integration/queries/index.ts", root), "utf8");

  assert.match(dto, /interface DiscoverGithubProjectV2Request[\s\S]*repositoryId\?: unknown/);
  assert.match(dto, /interface ReplaceGithubProjectV2SelectionsRequest[\s\S]*repositoryId\?: unknown/);
  assert.match(controller, /discoverGithubProjectV2[\s\S]{0,500}@Body\(\) body: DiscoverGithubProjectV2Request/);
  assert.match(source, /DELETE FROM github_project_v2_selections[\s\S]{0,160}repository_id = \$2/);
  assert.match(queries, /FROM github_project_v2_repositories[\s\S]{0,160}repository_id = \$1/);
  assert.match(source, /repositoryId,\s*target: "full"/);
  assert.match(executor, /listRepositoryProjectV2s/);
  assert.match(executor, /replaceGithubRepositoryProjectV2Links/);
  assert.match(executor, /links\.repository_id = \$2/);
  assert.doesNotMatch(executor, /replaceGithubProjectV2RepositoryLinks/);
  assert.match(client, /repository\(owner: \$owner, name: \$name\)/);
  assert.doesNotMatch(source, /DELETE FROM github_projects_v2|DELETE FROM github_project_v2_fields|DELETE FROM github_project_v2_items|DELETE FROM github_issues|DELETE FROM github_pull_requests|DELETE FROM boards/i);
  assert.match(executor, /gps\.repository_id = \$3/);
  assert.match(
    source,
    /if \(!management\) \{[\s\S]{0,360}gps\.repository_id = \$\$\{values\.length\}/,
    "A normal repository-scoped list must only expose selections from that repository"
  );
  assert.match(
    source,
    /const repositoryId = this\.readUuid\(query\.repositoryId, "repositoryId"\)/,
    "ProjectV2 listing must require repositoryId"
  );
}

console.log("repository-scoped ProjectV2 tests passed");
