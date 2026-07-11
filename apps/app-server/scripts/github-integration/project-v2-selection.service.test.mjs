import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GithubProjectV2Service } = require("../../dist/modules/github-integration/github-project-v2.service.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const installationId = "33333333-3333-4333-8333-333333333333";
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
    return this.queryOneRows.shift() ?? null;
  }

  async query(text, values = []) {
    this.queries.push({ method: "query", text, values });
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
        return null;
      },
      query: async (_text, values) =>
        values[1].map((id) => ({ id, installation_id: installationId })),
      execute: async (text, values) => {
        if (/DELETE FROM github_project_v2_selections/i.test(text)) {
          this.selections.clear();
          await Promise.resolve();
          return { rows: [] };
        }
        if (/INSERT INTO github_project_v2_selections/i.test(text)) {
          for (const projectV2Id of values[1]) {
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

function createService(database) {
  const workspaceService = new FakeWorkspaceService();
  return {
    database,
    workspaceService,
    service: new GithubProjectV2Service(database, workspaceService, {}, {})
  };
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
    { installationId, projectV2Ids: [firstProjectId, secondProjectId, firstProjectId] }
  );

  assert.deepEqual(result, {
    installationId,
    projectV2Ids: [firstProjectId, secondProjectId]
  });
  assert.deepEqual(workspaceService.accessChecks, [{ userId: currentUserId, workspaceId }]);
  assert.equal(database.transactionCalls, 1);
  assert.match(database.queries[0].text, /FOR UPDATE/i);
  assert.equal(database.queries.filter(({ method }) => method === "execute").length, 2);
  assert.match(database.queries[2].text, /DELETE FROM github_project_v2_selections/i);
  assert.match(database.queries[3].text, /INSERT INTO github_project_v2_selections/i);
  assert.deepEqual(database.queries[3].values, [installationId, [firstProjectId, secondProjectId]]);
}

{
  const database = new ConcurrentSelectionDatabase();
  const { service } = createService(database);

  await Promise.all([
    service.replaceGithubProjectV2Selections(currentUserId, workspaceId, {
      installationId,
      projectV2Ids: [firstProjectId]
    }),
    service.replaceGithubProjectV2Selections(currentUserId, workspaceId, {
      installationId,
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
  { installationId: "not-a-uuid", projectV2Ids: [] },
  { installationId, projectV2Ids: ["not-a-uuid"] }
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
    { installationId, projectV2Ids: [] }
  );

  assert.deepEqual(result, { installationId, projectV2Ids: [] });
  assert.equal(database.queries.filter(({ method }) => method === "execute").length, 1);
  assert.match(database.queries[1].text, /DELETE FROM github_project_v2_selections/i);
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
      { installationId, projectV2Ids: [firstProjectId] }
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

  const result = await service.listGithubProjectsV2(currentUserId, workspaceId, {});

  assert.equal(result.data[0].selected, true);
  assert.match(database.queries[1].text, /EXISTS\s*\(\s*SELECT 1\s*FROM github_project_v2_selections/i);
}

console.log("project-v2 selection service tests passed");
