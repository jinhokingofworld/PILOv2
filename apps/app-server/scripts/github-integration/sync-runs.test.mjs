import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { GithubIntegrationService } = require("../../dist/modules/github-integration/github-integration.service.js");

class FakeDatabase {
  constructor({ queryOneRows = [], queryRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queryRows = [...queryRows];
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });
    const next = this.queryOneRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
  }

  async query(text, values = []) {
    this.queries.push({ method: "query", text, values });
    const next = this.queryRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? [];
  }

  async execute(text, values = []) {
    this.queries.push({ method: "execute", text, values });
    return {
      rows: [],
      rowCount: 0
    };
  }
}

class FakeWorkspaceService {
  constructor() {
    this.accessChecks = [];
  }

  async assertWorkspaceAccess(currentUserId, workspaceId) {
    this.accessChecks.push({ currentUserId, workspaceId });
    return { id: workspaceId };
  }
}

class FakeConfigService {
  getGithubAppConfig() {
    return {
      appId: "12345",
      privateKey: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
      now: () => new Date("2026-07-05T10:00:00.000Z")
    };
  }
}

class FakeGithubAppClient {
  constructor({ repositories = [], error = null } = {}) {
    this.repositories = repositories;
    this.error = error;
    this.calls = [];
  }

  async listInstallationRepositories(input) {
    this.calls.push({ method: "listInstallationRepositories", input });
    if (this.error) {
      throw this.error;
    }

    return this.repositories;
  }
}

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const installationId = "33333333-3333-4333-8333-333333333333";
const repositoryId = "44444444-4444-4444-8444-444444444444";
const otherRepositoryId = "55555555-5555-4555-8555-555555555555";
const projectV2Id = "66666666-6666-4666-8666-666666666666";
const syncRunId = "77777777-7777-4777-8777-777777777777";
const githubInstallationId = 987654;

function createService(
  database = new FakeDatabase(),
  githubAppClient = new FakeGithubAppClient()
) {
  const workspaceService = new FakeWorkspaceService();
  const service = new GithubIntegrationService(
    database,
    {},
    {},
    {},
    new FakeConfigService(),
    workspaceService,
    {},
    githubAppClient
  );

  return {
    database,
    githubAppClient,
    service,
    workspaceService
  };
}

function installationRow(overrides = {}) {
  return {
    id: installationId,
    workspace_id: workspaceId,
    github_installation_id: githubInstallationId,
    ...overrides
  };
}

function syncRunRow(overrides = {}) {
  return {
    id: syncRunId,
    workspace_id: workspaceId,
    installation_id: installationId,
    repository_id: repositoryId,
    project_v2_id: projectV2Id,
    target: "full",
    status: "success",
    started_at: "2026-07-05T10:00:00.000Z",
    finished_at: "2026-07-05T10:01:00.000Z",
    fetched_count: 5,
    created_count: 2,
    updated_count: 2,
    skipped_count: 1,
    error_message: null,
    cursor: { hasNextPage: false },
    ...overrides
  };
}

function repositoryApiItem(overrides = {}) {
  return {
    id: 1001,
    node_id: "R_kgDOExample",
    name: "pilo",
    full_name: "my-team/pilo",
    owner: {
      login: "my-team"
    },
    private: true,
    archived: false,
    default_branch: "main",
    html_url: "https://github.com/my-team/pilo",
    created_at: "2026-06-20T03:00:00.000Z",
    updated_at: "2026-07-01T14:30:00.000Z",
    pushed_at: "2026-07-01T14:30:00.000Z",
    ...overrides
  };
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /COUNT\(\*\)/i);
        assert.match(text, /FROM github_sync_runs/i);
        assert.match(text, /workspace_id = \$1/i);
        assert.match(text, /target = \$2/i);
        assert.match(text, /status = \$3/i);
        assert.match(text, /repository_id = \$4/i);
        assert.match(text, /project_v2_id = \$5/i);
        assert.deepEqual(values, [
          workspaceId,
          "full",
          "success",
          repositoryId,
          projectV2Id
        ]);
        return { total: "1" };
      }
    ],
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM github_sync_runs/i);
        assert.match(text, /ORDER BY started_at DESC NULLS LAST, created_at DESC/i);
        assert.deepEqual(values, [
          workspaceId,
          "full",
          "success",
          repositoryId,
          projectV2Id,
          20,
          0
        ]);
        return [syncRunRow()];
      }
    ]
  });
  const { service, workspaceService } = createService(database);

  assert.equal(typeof service.listGithubSyncRuns, "function");

  const syncRuns = await service.listGithubSyncRuns(currentUserId, workspaceId, {
    target: "full",
    status: "success",
    repositoryId,
    projectV2Id,
    page: "1",
    limit: "20"
  });

  assert.deepEqual(workspaceService.accessChecks, [{ currentUserId, workspaceId }]);
  assert.deepEqual(syncRuns, {
    data: [
      {
        id: syncRunId,
        target: "full",
        status: "success",
        installationId,
        repositoryId,
        projectV2Id,
        startedAt: "2026-07-05T10:00:00.000Z",
        finishedAt: "2026-07-05T10:01:00.000Z",
        fetchedCount: 5,
        createdCount: 2,
        updatedCount: 2,
        skippedCount: 1,
        errorMessage: null
      }
    ],
    meta: {
      page: 1,
      limit: 20,
      total: 1
    }
  });
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM github_sync_runs/i);
        assert.match(text, /workspace_id = \$1/i);
        assert.match(text, /id = \$2/i);
        assert.deepEqual(values, [workspaceId, syncRunId]);
        return syncRunRow();
      }
    ]
  });
  const { service } = createService(database);

  assert.equal(typeof service.getGithubSyncRun, "function");

  const syncRun = await service.getGithubSyncRun(
    currentUserId,
    workspaceId,
    syncRunId
  );

  assert.deepEqual(syncRun, {
    id: syncRunId,
    target: "full",
    status: "success",
    installationId,
    repositoryId,
    projectV2Id,
    startedAt: "2026-07-05T10:00:00.000Z",
    finishedAt: "2026-07-05T10:01:00.000Z",
    fetchedCount: 5,
    createdCount: 2,
    updatedCount: 2,
    skippedCount: 1,
    errorMessage: null,
    cursor: { hasNextPage: false }
  });
}

{
  const githubAppClient = new FakeGithubAppClient({
    repositories: [
      repositoryApiItem(),
      repositoryApiItem({
        id: 1002,
        node_id: "R_kgDOOther",
        name: "pilo-docs",
        full_name: "my-team/pilo-docs",
        html_url: "https://github.com/my-team/pilo-docs"
      })
    ]
  });
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM github_installations/i);
        assert.deepEqual(values, [workspaceId, installationId]);
        return installationRow();
      },
      (text, values) => {
        assert.match(text, /INSERT INTO github_sync_runs/i);
        assert.deepEqual(values, [
          workspaceId,
          installationId,
          null,
          null,
          "repositories"
        ]);
        return syncRunRow({
          target: "repositories",
          status: "running",
          repository_id: null,
          project_v2_id: null,
          finished_at: null,
          fetched_count: 0,
          created_count: 0,
          updated_count: 0,
          skipped_count: 0,
          cursor: {}
        });
      },
      (text, values) => {
        assert.match(text, /INSERT INTO github_repositories/i);
        assert.equal(values[0], workspaceId);
        assert.equal(values[1], installationId);
        assert.equal(values[2], currentUserId);
        assert.equal(values[3], 1001);
        return { id: repositoryId, created: true };
      },
      (text, values) => {
        assert.match(text, /INSERT INTO github_repositories/i);
        assert.equal(values[3], 1002);
        return { id: otherRepositoryId, created: false };
      },
      (text, values) => {
        assert.match(text, /UPDATE github_sync_runs/i);
        assert.match(text, /status = 'success'/i);
        assert.deepEqual(values, [syncRunId, 2, 1, 1, 0, {}]);
        return syncRunRow({
          target: "repositories",
          repository_id: null,
          project_v2_id: null,
          fetched_count: 2,
          created_count: 1,
          updated_count: 1,
          skipped_count: 0,
          cursor: {}
        });
      }
    ]
  });
  const { service } = createService(database, githubAppClient);

  assert.equal(typeof service.startGithubSyncRun, "function");

  const syncRun = await service.startGithubSyncRun(currentUserId, workspaceId, {
    target: "repositories",
    installationId
  });

  assert.deepEqual(syncRun, {
    id: syncRunId,
    target: "repositories",
    status: "success",
    installationId,
    repositoryId: null,
    projectV2Id: null,
    startedAt: "2026-07-05T10:00:00.000Z",
    finishedAt: "2026-07-05T10:01:00.000Z",
    fetchedCount: 2,
    createdCount: 1,
    updatedCount: 1,
    skippedCount: 0,
    errorMessage: null
  });
  assert.equal(githubAppClient.calls.length, 1);
  assert.equal(githubAppClient.calls[0].input.installationId, githubInstallationId);
}

{
  const githubAppClient = new FakeGithubAppClient({
    error: new Error("GitHub repository sync failed")
  });
  const database = new FakeDatabase({
    queryOneRows: [
      installationRow(),
      syncRunRow({
        target: "repositories",
        status: "running",
        repository_id: null,
        project_v2_id: null,
        finished_at: null,
        fetched_count: 0,
        created_count: 0,
        updated_count: 0,
        skipped_count: 0,
        cursor: {}
      }),
      (text, values) => {
        assert.match(text, /UPDATE github_sync_runs/i);
        assert.match(text, /status = 'failed'/i);
        assert.deepEqual(values, [syncRunId, "GitHub repository sync failed"]);
        return syncRunRow({
          target: "repositories",
          status: "failed",
          repository_id: null,
          project_v2_id: null,
          fetched_count: 0,
          created_count: 0,
          updated_count: 0,
          skipped_count: 0,
          error_message: "GitHub repository sync failed",
          cursor: {}
        });
      }
    ]
  });
  const { service } = createService(database, githubAppClient);

  const syncRun = await service.startGithubSyncRun(currentUserId, workspaceId, {
    target: "repositories",
    installationId
  });

  assert.equal(syncRun.status, "failed");
  assert.equal(syncRun.errorMessage, "GitHub repository sync failed");
}

{
  const { service } = createService();

  await assert.rejects(
    () =>
      service.startGithubSyncRun(currentUserId, workspaceId, {
        target: "unknown",
        installationId
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().error.code, "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /target must be one of/i);
      return true;
    }
  );
}
