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

  getGithubOAuthConfig() {
    return {
      tokenEncryptionKey: "test-token-encryption-key",
      now: () => new Date("2026-07-05T10:00:00.000Z")
    };
  }
}

class FakeTokenEncryptionService {
  decryptToken(encryptedToken) {
    assert.equal(encryptedToken, "encrypted-user-oauth-token");
    return "decrypted-user-oauth-token";
  }
}

class FakeGithubAppClient {
  constructor({
    repositories = [],
    projects = [],
    issues = [],
    pullRequests = [],
    pullRequestDetails = [],
    project = null,
    fields = [],
    items = [],
    error = null
  } = {}) {
    this.repositories = repositories;
    this.projects = projects;
    this.issues = issues;
    this.pullRequests = pullRequests;
    this.pullRequestDetails = [...pullRequestDetails];
    this.project = project;
    this.fields = fields;
    this.items = items;
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

  async listProjectV2s(input) {
    this.calls.push({ method: "listProjectV2s", input });
    if (this.error) {
      throw this.error;
    }

    return this.projects;
  }

  async listRepositoryIssues(input) {
    this.calls.push({ method: "listRepositoryIssues", input });
    if (this.error) {
      throw this.error;
    }

    return this.issues;
  }

  async listRepositoryPullRequests(input) {
    this.calls.push({ method: "listRepositoryPullRequests", input });
    if (this.error) {
      throw this.error;
    }

    return this.pullRequests;
  }

  async getPullRequest(input) {
    this.calls.push({ method: "getPullRequest", input });
    if (this.error) {
      throw this.error;
    }

    return (
      this.pullRequestDetails.shift() ?? {
        changed_files: 0,
        additions: 0,
        deletions: 0,
        commits: 0,
        mergeable: null
      }
    );
  }

  async getProjectV2(input) {
    this.calls.push({ method: "getProjectV2", input });
    if (this.error) {
      throw this.error;
    }

    return this.project;
  }

  async listProjectV2Fields(input) {
    this.calls.push({ method: "listProjectV2Fields", input });
    if (this.error) {
      throw this.error;
    }

    return this.fields;
  }

  async listProjectV2Items(input) {
    this.calls.push({ method: "listProjectV2Items", input });
    if (this.error) {
      throw this.error;
    }

    return this.items;
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
const projectNodeId = "PVT_kwDOExample";
const statusFieldId = "88888888-8888-4888-8888-888888888888";
const backlogOptionId = "99999999-9999-4999-8999-999999999999";
const projectItemId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const issueId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function createService(
  database = new FakeDatabase(),
  githubAppClient = new FakeGithubAppClient()
) {
  const workspaceService = new FakeWorkspaceService();
  const service = new GithubIntegrationService(
    database,
    {},
    {},
    new FakeTokenEncryptionService(),
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
    account_login: "my-team",
    account_type: "Organization",
    ...overrides
  };
}

function githubOAuthConnectionRow(overrides = {}) {
  return {
    github_login: "Developer-EJ",
    github_access_token_encrypted: "encrypted-user-oauth-token",
    github_token_scope: "",
    github_connected_at: "2026-07-05T09:00:00.000Z",
    github_revoked_at: null,
    ...overrides
  };
}

function repositoryContextRow(overrides = {}) {
  return {
    id: repositoryId,
    workspace_id: workspaceId,
    installation_id: installationId,
    owner_login: "my-team",
    name: "pilo",
    full_name: "my-team/pilo",
    ...overrides
  };
}

function projectV2ContextRow(overrides = {}) {
  return {
    id: projectV2Id,
    workspace_id: workspaceId,
    installation_id: installationId,
    github_project_node_id: projectNodeId,
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

function pullRequestApiItem(overrides = {}) {
  return {
    id: 2001,
    node_id: "PR_kwDOExample",
    number: 24,
    title: "Implement PR review selector",
    body: "PR body",
    user: {
      login: "developer-ej",
      avatar_url: "https://avatars.githubusercontent.com/u/1"
    },
    head: {
      ref: "feature/pr-review",
      sha: "head-sha"
    },
    base: {
      ref: "main",
      sha: "base-sha"
    },
    changed_files: 0,
    additions: 0,
    deletions: 0,
    commits: 0,
    comments: 2,
    review_comments: 1,
    html_url: "https://github.com/my-team/pilo/pull/24",
    created_at: "2026-07-01T10:00:00.000Z",
    updated_at: "2026-07-02T05:20:00.000Z",
    closed_at: null,
    merged_at: null,
    draft: false,
    mergeable: null,
    state: "open",
    ...overrides
  };
}

function issueApiItem(overrides = {}) {
  return {
    id: 3001,
    node_id: "I_kgDOExample",
    number: 12,
    title: "Sync ProjectV2 labels",
    body: "Issue body",
    state: "open",
    state_reason: null,
    user: {
      login: "developer-ej",
      avatar_url: "https://avatars.githubusercontent.com/u/1"
    },
    html_url: "https://github.com/my-team/pilo/issues/12",
    labels: [
      {
        id: 4001,
        node_id: "LA_kwDOExample",
        name: "bug",
        color: "d73a4a",
        description: "Something is not working"
      }
    ],
    assignees: [
      {
        login: "developer-ej",
        id: 5001,
        node_id: "U_kwDOExample",
        avatar_url: "https://avatars.githubusercontent.com/u/1"
      }
    ],
    milestone: {
      id: 6001,
      node_id: "M_kwDOExample",
      number: 1,
      title: "MVP",
      state: "open"
    },
    created_at: "2026-07-01T10:00:00.000Z",
    updated_at: "2026-07-02T05:20:00.000Z",
    closed_at: null,
    ...overrides
  };
}

function projectV2ApiItem(overrides = {}) {
  return {
    id: projectNodeId,
    databaseId: 42,
    ownerLogin: "my-team",
    ownerType: "Organization",
    number: 1,
    title: "PILO MVP",
    shortDescription: "MVP board",
    readme: "Project readme",
    url: "https://github.com/orgs/my-team/projects/1",
    resourcePath: "/orgs/my-team/projects/1",
    public: false,
    closed: false,
    template: false,
    createdAt: "2026-06-20T03:00:00.000Z",
    updatedAt: "2026-07-01T14:30:00.000Z",
    closedAt: null,
    raw: { title: "PILO MVP" },
    ...overrides
  };
}

function discoveredProjectV2ApiItem(overrides = {}) {
  return {
    ...projectV2ApiItem(),
    repositoryNodeIds: ["R_kgDOExample"],
    ...overrides
  };
}

function projectV2FieldApiItem(overrides = {}) {
  return {
    id: "PVTSSF_lADOExample",
    name: "Status",
    dataType: "SINGLE_SELECT",
    createdAt: "2026-06-20T03:00:00.000Z",
    updatedAt: "2026-07-01T14:30:00.000Z",
    options: [
      {
        id: "status-backlog",
        name: "Backlog",
        color: "GRAY",
        description: "Ready for planning",
        position: 1
      }
    ],
    raw: { name: "Status" },
    ...overrides
  };
}

function projectV2ItemFieldValueApiItem(overrides = {}) {
  return {
    id: "PVTFV_lADOExample",
    fieldNodeId: "PVTSSF_lADOExample",
    fieldName: "Status",
    fieldDataType: "SINGLE_SELECT",
    textValue: null,
    numberValue: null,
    dateValue: null,
    singleSelectOptionId: "status-backlog",
    singleSelectName: "Backlog",
    iterationId: null,
    iterationTitle: null,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-02T05:20:00.000Z",
    raw: { name: "Backlog" },
    ...overrides
  };
}

function projectV2ItemApiItem(overrides = {}) {
  return {
    id: "PVTI_lADOExample",
    databaseId: 9001,
    contentType: "ISSUE",
    contentNodeId: "I_kgDOExample",
    isArchived: false,
    statusFieldNodeId: "PVTSSF_lADOExample",
    statusOptionId: "status-backlog",
    statusName: "Backlog",
    position: 10,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-02T05:20:00.000Z",
    fieldValues: [projectV2ItemFieldValueApiItem()],
    raw: { content: { type: "Issue" } },
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
        assert.equal(values[15], JSON.stringify(repositoryApiItem()));
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
        assert.deepEqual(values, [syncRunId, 2, 1, 1, 0, "{}"]);
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
  const issue = issueApiItem();
  const githubAppClient = new FakeGithubAppClient({
    issues: [issue]
  });
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM github_installations/i);
        assert.deepEqual(values, [workspaceId, installationId]);
        return installationRow();
      },
      (text, values) => {
        assert.match(text, /FROM github_repositories/i);
        assert.deepEqual(values, [workspaceId, repositoryId]);
        return repositoryContextRow();
      },
      (text, values) => {
        assert.match(text, /INSERT INTO github_sync_runs/i);
        assert.deepEqual(values, [
          workspaceId,
          installationId,
          repositoryId,
          null,
          "issues"
        ]);
        return syncRunRow({
          target: "issues",
          status: "running",
          repository_id: repositoryId,
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
        assert.match(text, /INSERT INTO github_issues/i);
        assert.equal(values[0], workspaceId);
        assert.equal(values[1], repositoryId);
        assert.equal(values[2], 3001);
        assert.equal(values[12], JSON.stringify(issue.labels));
        assert.equal(values[13], JSON.stringify(issue.assignees));
        assert.equal(values[14], JSON.stringify(issue.milestone));
        assert.deepEqual(JSON.parse(values[18]), issue);
        return { id: issueId, created: true };
      },
      (text, values) => {
        assert.match(text, /UPDATE github_sync_runs/i);
        assert.match(text, /status = 'success'/i);
        assert.deepEqual(values, [syncRunId, 1, 1, 0, 0, "{}"]);
        return syncRunRow({
          target: "issues",
          repository_id: repositoryId,
          project_v2_id: null,
          fetched_count: 1,
          created_count: 1,
          updated_count: 0,
          skipped_count: 0,
          cursor: {}
        });
      }
    ]
  });
  const { service } = createService(database, githubAppClient);

  const syncRun = await service.startGithubSyncRun(currentUserId, workspaceId, {
    target: "issues",
    installationId,
    repositoryId
  });

  assert.equal(syncRun.status, "success");
  assert.equal(syncRun.fetchedCount, 1);
  assert.equal(syncRun.createdCount, 1);
  assert.equal(githubAppClient.calls[0].method, "listRepositoryIssues");
  assert.equal(githubAppClient.calls[0].input.owner, "my-team");
  assert.equal(githubAppClient.calls[0].input.repo, "pilo");
}

{
  const githubAppClient = new FakeGithubAppClient({
    pullRequests: [pullRequestApiItem()],
    pullRequestDetails: [
      {
        changed_files: 5,
        additions: 128,
        deletions: 32,
        commits: 3,
        mergeable: true
      }
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
        assert.match(text, /FROM github_repositories/i);
        assert.deepEqual(values, [workspaceId, repositoryId]);
        return repositoryContextRow();
      },
      (text, values) => {
        assert.match(text, /INSERT INTO github_sync_runs/i);
        assert.deepEqual(values, [
          workspaceId,
          installationId,
          repositoryId,
          null,
          "pull_requests"
        ]);
        return syncRunRow({
          target: "pull_requests",
          status: "running",
          repository_id: repositoryId,
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
        assert.match(text, /INSERT INTO github_pull_requests/i);
        assert.equal(values[0], workspaceId);
        assert.equal(values[1], repositoryId);
        assert.equal(values[2], 2001);
        assert.equal(values[11], 5);
        assert.equal(values[12], 128);
        assert.equal(values[13], 32);
        assert.equal(values[14], 3);
        assert.equal(values[15], 2);
        assert.equal(values[16], 1);
        const rawPullRequest = JSON.parse(values[22]);
        assert.equal(rawPullRequest.changed_files, 5);
        assert.equal(rawPullRequest.additions, 128);
        assert.equal(rawPullRequest.deletions, 32);
        assert.equal(rawPullRequest.commits, 3);
        assert.equal(rawPullRequest.mergeable, true);
        return { id: "pull-request-id", created: true };
      },
      (text, values) => {
        assert.match(text, /UPDATE github_sync_runs/i);
        assert.match(text, /status = 'success'/i);
        assert.deepEqual(values, [syncRunId, 1, 1, 0, 0, "{}"]);
        return syncRunRow({
          target: "pull_requests",
          repository_id: repositoryId,
          project_v2_id: null,
          fetched_count: 1,
          created_count: 1,
          updated_count: 0,
          skipped_count: 0,
          cursor: {}
        });
      }
    ]
  });
  const { service } = createService(database, githubAppClient);

  const syncRun = await service.startGithubSyncRun(currentUserId, workspaceId, {
    target: "pull_requests",
    installationId,
    repositoryId
  });

  assert.equal(syncRun.status, "success");
  assert.equal(syncRun.fetchedCount, 1);
  assert.equal(syncRun.createdCount, 1);
  assert.equal(githubAppClient.calls[0].method, "listRepositoryPullRequests");
  assert.equal(githubAppClient.calls[0].input.owner, "my-team");
  assert.equal(githubAppClient.calls[0].input.repo, "pilo");
  assert.equal(githubAppClient.calls[1].method, "getPullRequest");
  assert.equal(githubAppClient.calls[1].input.pullNumber, 24);
}

{
  const githubAppClient = new FakeGithubAppClient({
    repositories: [repositoryApiItem()],
    projects: [discoveredProjectV2ApiItem()]
  });
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM github_installations/i);
        assert.match(text, /account_login/i);
        assert.match(text, /account_type/i);
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
          "full"
        ]);
        return syncRunRow({
          target: "full",
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
        assert.equal(values[3], 1001);
        return { id: repositoryId, created: true };
      },
      (text, values) => {
        assert.match(text, /INSERT INTO github_projects_v2/i);
        assert.match(
          text,
          /ON CONFLICT \(workspace_id, github_project_node_id\)/i
        );
        assert.deepEqual(values.slice(0, 7), [
          workspaceId,
          installationId,
          projectNodeId,
          42,
          "my-team",
          "Organization",
          1
        ]);
        assert.equal(values[18], JSON.stringify(discoveredProjectV2ApiItem().raw));
        return { id: projectV2Id, created: true };
      },
      (text, values) => {
        assert.match(text, /UPDATE github_sync_runs/i);
        assert.match(text, /status = 'success'/i);
        assert.deepEqual(values, [syncRunId, 2, 2, 0, 0, "{}"]);
        return syncRunRow({
          target: "full",
          repository_id: null,
          project_v2_id: null,
          fetched_count: 2,
          created_count: 2,
          updated_count: 0,
          skipped_count: 0,
          cursor: {}
        });
      }
    ],
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM github_repositories/i);
        assert.deepEqual(values, [workspaceId, installationId]);
        return [repositoryContextRow()];
      },
      (text, values) => {
        assert.match(text, /FROM github_repositories/i);
        assert.deepEqual(values, [workspaceId, installationId]);
        return [repositoryContextRow()];
      }
    ]
  });
  const { service } = createService(database, githubAppClient);

  const syncRun = await service.startGithubSyncRun(currentUserId, workspaceId, {
    target: "full",
    installationId
  });

  assert.equal(syncRun.status, "success");
  assert.equal(syncRun.fetchedCount, 2);
  assert.deepEqual(
    githubAppClient.calls.map((call) => call.method),
    [
      "listInstallationRepositories",
      "listProjectV2s",
      "listRepositoryIssues",
      "listRepositoryPullRequests"
    ]
  );
  assert.equal(githubAppClient.calls[1].input.accountLogin, "my-team");
  assert.equal(githubAppClient.calls[1].input.accountType, "Organization");
  const projectRepositoryDelete = database.queries.find(
    (query) =>
      query.method === "execute" &&
      /DELETE FROM github_project_v2_repositories/i.test(query.text)
  );
  assert.ok(projectRepositoryDelete);
  assert.deepEqual(projectRepositoryDelete.values, [
    projectV2Id,
    workspaceId,
    ["R_kgDOExample"]
  ]);
  const projectRepositoryInsert = database.queries.find(
    (query) =>
      query.method === "execute" &&
      /INSERT INTO github_project_v2_repositories/i.test(query.text)
  );
  assert.ok(projectRepositoryInsert);
  assert.deepEqual(projectRepositoryInsert.values, [
    projectV2Id,
    workspaceId,
    ["R_kgDOExample"]
  ]);
}

{
  const githubAppClient = new FakeGithubAppClient({
    projects: [
      discoveredProjectV2ApiItem({
        ownerLogin: "Developer-EJ",
        ownerType: "User",
        title: "PILO_Project",
        url: "https://github.com/users/Developer-EJ/projects/34",
        resourcePath: "/users/Developer-EJ/projects/34",
        raw: { title: "PILO_Project" }
      })
    ]
  });
  const database = new FakeDatabase({
    queryOneRows: [
      installationRow({
        account_login: "Developer-EJ",
        account_type: "User"
      }),
      syncRunRow({
        target: "full",
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
        assert.match(text, /github_access_token_encrypted/i);
        assert.match(text, /FROM users/i);
        assert.deepEqual(values, [currentUserId]);
        return githubOAuthConnectionRow();
      },
      (text, values) => {
        assert.match(text, /INSERT INTO github_projects_v2/i);
        assert.deepEqual(values.slice(0, 7), [
          workspaceId,
          installationId,
          projectNodeId,
          42,
          "Developer-EJ",
          "User",
          1
        ]);
        return { id: projectV2Id, created: true };
      },
      (text, values) => {
        assert.match(text, /UPDATE github_sync_runs/i);
        assert.match(text, /status = 'success'/i);
        assert.deepEqual(values, [syncRunId, 1, 1, 0, 0, "{}"]);
        return syncRunRow({
          target: "full",
          repository_id: null,
          project_v2_id: null,
          fetched_count: 1,
          created_count: 1,
          updated_count: 0,
          skipped_count: 0,
          cursor: {}
        });
      }
    ],
    queryRows: [() => [], () => []]
  });
  const { service } = createService(database, githubAppClient);

  const syncRun = await service.startGithubSyncRun(currentUserId, workspaceId, {
    target: "full",
    installationId
  });

  assert.equal(syncRun.status, "success");
  assert.equal(syncRun.createdCount, 1);
  assert.deepEqual(
    githubAppClient.calls.map((call) => call.method),
    ["listInstallationRepositories", "listProjectV2s"]
  );
  assert.equal(githubAppClient.calls[0].input.userAccessToken, undefined);
  assert.equal(
    githubAppClient.calls[1].input.userAccessToken,
    "decrypted-user-oauth-token"
  );
  assert.doesNotMatch(
    JSON.stringify(database.queries),
    /decrypted-user-oauth-token/
  );
}

{
  const githubAppClient = new FakeGithubAppClient();
  const database = new FakeDatabase({
    queryOneRows: [
      installationRow({
        account_login: "Developer-EJ",
        account_type: "User"
      }),
      syncRunRow({
        target: "full",
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
      githubOAuthConnectionRow({
        github_login: null,
        github_access_token_encrypted: null,
        github_connected_at: null
      }),
      (text, values) => {
        assert.match(text, /UPDATE github_sync_runs/i);
        assert.match(text, /status = 'failed'/i);
        assert.deepEqual(values, [
          syncRunId,
          "GitHub user OAuth token is required for personal ProjectV2 sync"
        ]);
        return syncRunRow({
          target: "full",
          status: "failed",
          repository_id: null,
          project_v2_id: null,
          fetched_count: 0,
          created_count: 0,
          updated_count: 0,
          skipped_count: 0,
          error_message:
            "GitHub user OAuth token is required for personal ProjectV2 sync",
          cursor: {}
        });
      }
    ]
  });
  const { service } = createService(database, githubAppClient);

  const syncRun = await service.startGithubSyncRun(currentUserId, workspaceId, {
    target: "full",
    installationId
  });

  assert.equal(syncRun.status, "failed");
  assert.equal(
    syncRun.errorMessage,
    "GitHub user OAuth token is required for personal ProjectV2 sync"
  );
  assert.deepEqual(githubAppClient.calls, []);
}

{
  const githubAppClient = new FakeGithubAppClient();
  const database = new FakeDatabase({
    queryOneRows: [
      installationRow({
        account_login: "Developer-EJ",
        account_type: "User"
      }),
      syncRunRow({
        target: "full",
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
        assert.match(text, /github_access_token_encrypted/i);
        assert.match(text, /FROM users/i);
        assert.deepEqual(values, [currentUserId]);
        return githubOAuthConnectionRow({
          github_token_scope: null
        });
      },
      (text, values) => {
        assert.match(text, /UPDATE github_sync_runs/i);
        assert.match(text, /status = 'success'/i);
        assert.deepEqual(values, [syncRunId, 0, 0, 0, 0, "{}"]);
        return syncRunRow({
          target: "full",
          status: "success",
          repository_id: null,
          project_v2_id: null,
          fetched_count: 0,
          created_count: 0,
          updated_count: 0,
          skipped_count: 0,
          cursor: {}
        });
      }
    ],
    queryRows: [() => [], () => []]
  });
  const { service } = createService(database, githubAppClient);

  const syncRun = await service.startGithubSyncRun(currentUserId, workspaceId, {
    target: "full",
    installationId
  });

  assert.equal(syncRun.status, "success");
  assert.equal(syncRun.fetchedCount, 0);
  assert.deepEqual(
    githubAppClient.calls.map((call) => call.method),
    ["listInstallationRepositories", "listProjectV2s"]
  );
  assert.equal(
    githubAppClient.calls[1].input.userAccessToken,
    "decrypted-user-oauth-token"
  );
}

{
  const githubAppClient = new FakeGithubAppClient();
  const database = new FakeDatabase({
    queryOneRows: [
      installationRow({
        account_login: "Developer-EJ",
        account_type: "User"
      }),
      projectV2ContextRow(),
      syncRunRow({
        target: "project_v2_fields",
        status: "running",
        repository_id: null,
        finished_at: null,
        fetched_count: 0,
        created_count: 0,
        updated_count: 0,
        skipped_count: 0,
        cursor: {}
      }),
      githubOAuthConnectionRow({
        github_login: "other-user"
      }),
      (text, values) => {
        assert.match(text, /UPDATE github_sync_runs/i);
        assert.match(text, /status = 'failed'/i);
        assert.deepEqual(values, [
          syncRunId,
          "GitHub user OAuth token cannot access this personal ProjectV2 owner"
        ]);
        return syncRunRow({
          target: "project_v2_fields",
          status: "failed",
          repository_id: null,
          fetched_count: 0,
          created_count: 0,
          updated_count: 0,
          skipped_count: 0,
          error_message:
            "GitHub user OAuth token cannot access this personal ProjectV2 owner",
          cursor: {}
        });
      }
    ]
  });
  const { service } = createService(database, githubAppClient);

  const syncRun = await service.startGithubSyncRun(currentUserId, workspaceId, {
    target: "project_v2_fields",
    installationId,
    projectV2Id
  });

  assert.equal(syncRun.status, "failed");
  assert.equal(
    syncRun.errorMessage,
    "GitHub user OAuth token cannot access this personal ProjectV2 owner"
  );
  assert.deepEqual(githubAppClient.calls, []);
}

{
  const githubAppClient = new FakeGithubAppClient({
    project: projectV2ApiItem()
  });
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM github_installations/i);
        assert.deepEqual(values, [workspaceId, installationId]);
        return installationRow();
      },
      (text, values) => {
        assert.match(text, /FROM github_projects_v2/i);
        assert.match(text, /github_project_node_id/i);
        assert.deepEqual(values, [workspaceId, projectV2Id]);
        return projectV2ContextRow();
      },
      (text, values) => {
        assert.match(text, /INSERT INTO github_sync_runs/i);
        assert.deepEqual(values, [
          workspaceId,
          installationId,
          null,
          projectV2Id,
          "project_v2"
        ]);
        return syncRunRow({
          target: "project_v2",
          status: "running",
          repository_id: null,
          finished_at: null,
          fetched_count: 0,
          created_count: 0,
          updated_count: 0,
          skipped_count: 0,
          cursor: {}
        });
      },
      (text, values) => {
        assert.match(text, /UPDATE github_sync_runs/i);
        assert.match(text, /status = 'success'/i);
        assert.deepEqual(values, [syncRunId, 1, 0, 1, 0, "{}"]);
        return syncRunRow({
          target: "project_v2",
          repository_id: null,
          fetched_count: 1,
          created_count: 0,
          updated_count: 1,
          skipped_count: 0,
          cursor: {}
        });
      }
    ]
  });
  const { service } = createService(database, githubAppClient);

  const syncRun = await service.startGithubSyncRun(currentUserId, workspaceId, {
    target: "project_v2",
    installationId,
    projectV2Id
  });

  assert.equal(syncRun.status, "success");
  assert.equal(syncRun.fetchedCount, 1);
  assert.equal(syncRun.updatedCount, 1);
  assert.equal(githubAppClient.calls[0].method, "getProjectV2");
  assert.equal(githubAppClient.calls[0].input.projectNodeId, projectNodeId);
  const projectUpdate = database.queries.find(
    (query) =>
      query.method === "execute" &&
      /UPDATE github_projects_v2/i.test(query.text)
  );
  assert.ok(projectUpdate);
  assert.deepEqual(projectUpdate.values.slice(0, 6), [
    projectV2Id,
    installationId,
    42,
    "my-team",
    "Organization",
    1
  ]);
  assert.equal(projectUpdate.values[17], JSON.stringify(projectV2ApiItem().raw));
}

{
  const githubAppClient = new FakeGithubAppClient({
    fields: [projectV2FieldApiItem()]
  });
  const database = new FakeDatabase({
    queryOneRows: [
      installationRow(),
      projectV2ContextRow(),
      syncRunRow({
        target: "project_v2_fields",
        status: "running",
        repository_id: null,
        finished_at: null,
        fetched_count: 0,
        created_count: 0,
        updated_count: 0,
        skipped_count: 0,
        cursor: {}
      }),
      (text, values) => {
        assert.match(text, /INSERT INTO github_project_v2_fields/i);
        assert.deepEqual(values.slice(0, 5), [
          projectV2Id,
          "PVTSSF_lADOExample",
          "Status",
          "SINGLE_SELECT",
          true
        ]);
        assert.equal(values[7], JSON.stringify(projectV2FieldApiItem().raw));
        return { id: statusFieldId, created: true };
      },
      (text, values) => {
        assert.match(text, /INSERT INTO github_project_v2_field_options/i);
        assert.deepEqual(values, [
          statusFieldId,
          "status-backlog",
          "Backlog",
          "backlog",
          "GRAY",
          "Ready for planning",
          1
        ]);
        return { id: backlogOptionId, created: false };
      },
      (text, values) => {
        assert.match(text, /UPDATE github_sync_runs/i);
        assert.deepEqual(values, [syncRunId, 1, 1, 0, 0, "{}"]);
        return syncRunRow({
          target: "project_v2_fields",
          repository_id: null,
          fetched_count: 1,
          created_count: 1,
          updated_count: 0,
          skipped_count: 0,
          cursor: {}
        });
      }
    ]
  });
  const { service } = createService(database, githubAppClient);

  const syncRun = await service.startGithubSyncRun(currentUserId, workspaceId, {
    target: "project_v2_fields",
    installationId,
    projectV2Id
  });

  assert.equal(syncRun.status, "success");
  assert.equal(syncRun.createdCount, 1);
  assert.equal(githubAppClient.calls[0].method, "listProjectV2Fields");
  assert.equal(githubAppClient.calls[0].input.projectNodeId, projectNodeId);
}

{
  const githubAppClient = new FakeGithubAppClient({
    items: [
      projectV2ItemApiItem(),
      projectV2ItemApiItem({
        id: "PVTI_lADOSkipped",
        contentNodeId: null,
        fieldValues: []
      })
    ]
  });
  const database = new FakeDatabase({
    queryOneRows: [
      installationRow(),
      projectV2ContextRow(),
      syncRunRow({
        target: "project_v2_items",
        status: "running",
        repository_id: null,
        finished_at: null,
        fetched_count: 0,
        created_count: 0,
        updated_count: 0,
        skipped_count: 0,
        cursor: {}
      }),
      (text, values) => {
        assert.match(text, /FROM github_issues/i);
        assert.deepEqual(values, [workspaceId, "I_kgDOExample"]);
        return { id: issueId };
      },
      (text, values) => {
        assert.match(text, /FROM github_project_v2_field_options/i);
        assert.match(text, /JOIN github_project_v2_fields/i);
        assert.deepEqual(values, [projectV2Id, "status-backlog"]);
        return { id: backlogOptionId, field_id: statusFieldId, created: false };
      },
      (text, values) => {
        assert.match(text, /INSERT INTO github_project_v2_items/i);
        assert.deepEqual(values.slice(0, 14), [
          workspaceId,
          projectV2Id,
          "PVTI_lADOExample",
          9001,
          "ISSUE",
          issueId,
          null,
          false,
          statusFieldId,
          backlogOptionId,
          "status-backlog",
          "Backlog",
          "backlog",
          10
        ]);
        assert.equal(values[16], JSON.stringify(projectV2ItemApiItem().raw));
        return { id: projectItemId, created: true };
      },
      (text, values) => {
        assert.match(text, /FROM github_project_v2_fields/i);
        assert.deepEqual(values, [projectV2Id, "PVTSSF_lADOExample"]);
        return { id: statusFieldId, created: false };
      },
      (text, values) => {
        assert.match(text, /UPDATE github_sync_runs/i);
        assert.deepEqual(values, [syncRunId, 2, 1, 0, 1, "{}"]);
        return syncRunRow({
          target: "project_v2_items",
          repository_id: null,
          fetched_count: 2,
          created_count: 1,
          updated_count: 0,
          skipped_count: 1,
          cursor: {}
        });
      }
    ]
  });
  const { service } = createService(database, githubAppClient);

  const syncRun = await service.startGithubSyncRun(currentUserId, workspaceId, {
    target: "project_v2_items",
    installationId,
    projectV2Id
  });

  assert.equal(syncRun.status, "success");
  assert.equal(syncRun.fetchedCount, 2);
  assert.equal(syncRun.createdCount, 1);
  assert.equal(syncRun.skippedCount, 1);
  assert.equal(githubAppClient.calls[0].method, "listProjectV2Items");
  assert.equal(githubAppClient.calls[0].input.projectNodeId, projectNodeId);
  const fieldValueUpsert = database.queries.find(
    (query) =>
      query.method === "execute" &&
      /INSERT INTO github_project_v2_item_field_values/i.test(query.text)
  );
  assert.ok(fieldValueUpsert);
  assert.deepEqual(fieldValueUpsert.values.slice(0, 11), [
    projectItemId,
    statusFieldId,
    "PVTFV_lADOExample",
    "Status",
    "SINGLE_SELECT",
    null,
    null,
    null,
    "status-backlog",
    "Backlog",
    null
  ]);
  assert.equal(
    fieldValueUpsert.values[12],
    JSON.stringify(projectV2ItemFieldValueApiItem().raw)
  );
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
