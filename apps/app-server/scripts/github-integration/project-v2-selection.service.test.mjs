import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GithubProjectV2Service } = require("../../dist/modules/github-integration/github-project-v2.service.js");
const { GithubSyncJobEnqueueError } = require("../../dist/modules/github-integration/github-sync-job.service.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const installationId = "33333333-3333-4333-8333-333333333333";
const repositoryId = "99999999-9999-4999-8999-999999999999";
const firstProjectId = "44444444-4444-4444-8444-444444444444";
const secondProjectId = "55555555-5555-4555-8555-555555555555";
const otherInstallationId = "66666666-6666-4666-8666-666666666666";

class FakeDatabase {
  constructor({ queryOneRows = [], queryRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queryRows = [...queryRows];
    this.queries = [];
    this.transactionCalls = 0;
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });
    if (/FROM github_repositories/i.test(text)) {
      return { id: repositoryId, installation_id: installationId };
    }
    return this.queryOneRows.shift() ?? null;
  }

  async query(text, values = []) {
    this.queries.push({ method: "query", text, values });
    if (/^\s*SELECT project_v2_id\s+FROM github_project_v2_repositories/i.test(text)) {
      return values[1].map((project_v2_id) => ({ project_v2_id }));
    }
    return this.queryRows.shift() ?? [];
  }

  async transaction(callback) {
    this.transactionCalls += 1;
    return callback({
      queryOne: this.queryOne.bind(this),
      query: this.query.bind(this),
      execute: async (text, values = []) => {
        this.queries.push({ method: "execute", text, values });
        return { rows: [] };
      }
    });
  }
}

class FakeWorkspaceService {
  constructor() {
    this.accessChecks = [];
  }

  async assertWorkspaceAccess(userId, targetWorkspaceId) {
    this.accessChecks.push({ userId, workspaceId: targetWorkspaceId });
  }
}

class ConcurrentSelectionDatabase {
  constructor() {
    this.selections = new Set(["old-selection"]);
    this.installationLock = Promise.resolve();
  }

  async transaction(callback) {
    let releaseLock = null;
    const transaction = {
      queryOne: async (text) => {
        if (/FROM github_installations/i.test(text)) {
          if (/FOR UPDATE/i.test(text)) {
            const previousLock = this.installationLock;
            let release;
            this.installationLock = new Promise((resolve) => {
              release = resolve;
            });
            await previousLock;
            releaseLock = release;
          }
          return { id: installationId };
        }
        if (/FROM github_repositories/i.test(text)) {
          return { id: repositoryId, installation_id: installationId };
        }
        return null;
      },
      query: async (_text, values) =>
        /github_project_v2_repositories/i.test(_text)
          ? values[1].map((project_v2_id) => ({ project_v2_id }))
          : values[1].map((id) => ({ id, installation_id: installationId })),
      execute: async (text, values) => {
        if (/DELETE FROM github_project_v2_selections/i.test(text)) {
          this.selections.clear();
          await Promise.resolve();
          return { rows: [] };
        }
        if (/INSERT INTO github_project_v2_selections/i.test(text)) {
          for (const projectV2Id of values[2]) {
            this.selections.add(projectV2Id);
          }
        }
        return { rows: [] };
      }
    };

    try {
      return await callback(transaction);
    } finally {
      releaseLock?.();
    }
  }
}

function createService(database, syncRunService) {
  const workspaceService = new FakeWorkspaceService();
  return {
    database,
    workspaceService,
    service: new GithubProjectV2Service(
      database,
      workspaceService,
      {},
      {},
      undefined,
      syncRunService
    )
  };
}

{
  const database = new FakeDatabase({
    queryOneRows: [{ id: installationId }],
    queryRows: [[{ id: firstProjectId, installation_id: installationId }]]
  });
  const { service } = createService(database, {
    async startGithubSyncRun() {
      throw new GithubSyncJobEnqueueError("77777777-7777-4777-8777-777777777777");
    }
  });

  const result = await service.replaceGithubProjectV2Selections(
    currentUserId,
    workspaceId,
    { installationId, repositoryId, projectV2Ids: [firstProjectId] }
  );

  assert.deepEqual(result, {
    installationId,
    repositoryId,
    projectV2Ids: [firstProjectId],
    syncRunId: "77777777-7777-4777-8777-777777777777",
    syncStatus: "failed",
    syncError: "GitHub sync job could not be enqueued"
  });
}

function projectRow(id, overrides = {}) {
  return {
    id,
    installation_id: installationId,
    github_project_node_id: `PVT_${id}`,
    github_project_full_database_id: 1,
    owner_login: "pilo",
    owner_type: "Organization",
    project_number: 1,
    title: "PILO",
    short_description: null,
    readme: null,
    url: "https://github.com/orgs/pilo/projects/1",
    resource_path: null,
    public: false,
    closed: false,
    template: false,
    github_created_at: null,
    github_updated_at: null,
    github_closed_at: null,
    last_synced_at: null,
    repository_ids: [],
    raw: {},
    ...overrides
  };
}

{
  const database = new FakeDatabase({
    queryOneRows: [{ id: installationId }],
    queryRows: [[{ id: firstProjectId, installation_id: installationId }, { id: secondProjectId, installation_id: installationId }]]
  });
  const { service, workspaceService } = createService(database);

  const result = await service.replaceGithubProjectV2Selections(
    currentUserId,
    workspaceId,
    { installationId, repositoryId, projectV2Ids: [firstProjectId, secondProjectId, firstProjectId] }
  );

  assert.deepEqual(result, {
    installationId,
    repositoryId,
    projectV2Ids: [firstProjectId, secondProjectId],
    syncRunId: null,
    syncStatus: null,
    syncError: null
  });
  assert.deepEqual(workspaceService.accessChecks, [{ userId: currentUserId, workspaceId }]);
  assert.equal(database.transactionCalls, 1);
  assert.match(database.queries[0].text, /FOR UPDATE/i);
  assert.equal(database.queries.filter(({ method }) => method === "execute").length, 2);
  assert.match(database.queries[4].text, /DELETE FROM github_project_v2_selections/i);
  assert.match(database.queries[5].text, /INSERT INTO github_project_v2_selections/i);
  assert.deepEqual(database.queries[5].values, [installationId, repositoryId, [firstProjectId, secondProjectId]]);
}

{
  const database = new ConcurrentSelectionDatabase();
  const { service } = createService(database);

  await Promise.all([
    service.replaceGithubProjectV2Selections(currentUserId, workspaceId, {
      installationId,
      repositoryId,
      projectV2Ids: [firstProjectId]
    }),
    service.replaceGithubProjectV2Selections(currentUserId, workspaceId, {
      installationId,
      repositoryId,
      projectV2Ids: [secondProjectId]
    })
  ]);

  assert.deepEqual(
    [...database.selections],
    [secondProjectId],
    "serial replacement must not leave a union of concurrent requests"
  );
}

for (const input of [
  { installationId: "not-a-uuid", repositoryId, projectV2Ids: [] },
  { installationId, repositoryId, projectV2Ids: ["not-a-uuid"] }
]) {
  const database = new FakeDatabase();
  const { service } = createService(database);

  await assert.rejects(
    () => service.replaceGithubProjectV2Selections(currentUserId, workspaceId, input),
    (error) => error.getStatus() === 400
  );
  assert.equal(database.transactionCalls, 0);
}

{
  const database = new FakeDatabase({ queryOneRows: [{ id: installationId }] });
  const { service } = createService(database);

  const result = await service.replaceGithubProjectV2Selections(
    currentUserId,
    workspaceId,
    { installationId, repositoryId, projectV2Ids: [] }
  );

  assert.deepEqual(result, {
    installationId,
    repositoryId,
    projectV2Ids: [],
    syncRunId: null,
    syncStatus: null,
    syncError: null
  });
  assert.equal(database.queries.filter(({ method }) => method === "execute").length, 1);
  assert.match(database.queries[2].text, /DELETE FROM github_project_v2_selections/i);
}

{
  const database = new FakeDatabase({
    queryOneRows: [{ id: installationId }],
    queryRows: [[{ id: firstProjectId, installation_id: otherInstallationId }]]
  });
  const { service } = createService(database);

  await assert.rejects(
    () => service.replaceGithubProjectV2Selections(
      currentUserId,
      workspaceId,
      { installationId, repositoryId, projectV2Ids: [firstProjectId] }
    ),
    (error) => error.getStatus() === 400
  );
  assert.equal(database.queries.some(({ method }) => method === "execute"), false);
}

{
  const database = new FakeDatabase({
    queryOneRows: [{ total: 1 }],
    queryRows: [[projectRow(firstProjectId, { selected: true })]]
  });
  const { service } = createService(database);

  const result = await service.listGithubProjectsV2(currentUserId, workspaceId, { repositoryId });

  assert.equal(result.data[0].selected, true);
  assert.match(database.queries[1].text, /EXISTS\s*\(\s*SELECT 1\s*FROM github_project_v2_selections/i);
}

console.log("project-v2 selection service tests passed");
