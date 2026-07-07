import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);

const {
  GithubSyncExecutorService
} = require("../../dist/modules/github-integration/github-sync-executor.service.js");

function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8").catch((error) => {
    if (error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertContains(source, text) {
  assert.match(source, new RegExp(escapeRegExp(text)));
}

function sqlBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `${startText} should exist`);
  const end = source.indexOf(endText, start);
  assert.notEqual(end, -1, `${endText} should exist after ${startText}`);
  return source.slice(start, end + endText.length);
}

class FakeDatabase {
  constructor() {
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });
    if (/INSERT INTO github_repositories/i.test(text)) {
      return { id: `repo-${values[0]}`, created: true };
    }

    return null;
  }

  async execute(text, values = []) {
    this.queries.push({ method: "execute", text, values });
    return { rowCount: 1, rows: [] };
  }
}

class FakeGithubAppClient {
  async listInstallationRepositories() {
    return [
      {
        id: 1001,
        node_id: "R_kgDOExample",
        owner: { login: "my-team" },
        name: "pilo",
        full_name: "my-team/pilo",
        private: false,
        archived: false,
        default_branch: "main",
        html_url: "https://github.com/my-team/pilo",
        created_at: "2026-07-01T00:00:00.000Z",
        updated_at: "2026-07-02T00:00:00.000Z",
        pushed_at: "2026-07-03T00:00:00.000Z"
      }
    ];
  }
}

function syncContext(workspaceId, installationId) {
  return {
    currentUserId: "22222222-2222-4222-8222-222222222222",
    workspaceId,
    installation: {
      id: installationId,
      workspace_id: workspaceId,
      github_installation_id: 987654,
      account_login: "my-team",
      account_type: "Organization"
    },
    repository: null,
    projectV2: null,
    githubUserAccessToken: null,
    config: {
      appId: "12345",
      privateKey: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
      now: () => new Date("2026-07-07T00:00:00.000Z")
    }
  };
}

const syncExecutor = await readSource(
  "../../src/modules/github-integration/github-sync-executor.service.ts"
);
const installationService = await readSource(
  "../../src/modules/github-integration/github-app-installation.service.ts"
);
const githubIntegrationApi = await readSource(
  "../../../../docs/api/github-integration-api.md"
);
const boardApi = await readSource("../../../../docs/api/board-api.md");
const migration = await readSource(
  "../../../../db/migrations/011_scope_github_source_uniques_by_workspace.sql"
);

const installationUpsert = sqlBlock(
  installationService,
  "INSERT INTO github_installations",
  "RETURNING"
);
assertContains(
  installationUpsert,
  "ON CONFLICT (workspace_id, github_installation_id)"
);
assert.doesNotMatch(installationUpsert, /workspace_id\s*=\s*EXCLUDED\.workspace_id/i);

const repositoryUpsert = sqlBlock(
  syncExecutor,
  "INSERT INTO github_repositories",
  "RETURNING id, (xmax = 0) AS created"
);
assertContains(repositoryUpsert, "ON CONFLICT (workspace_id, github_repository_id)");
assert.doesNotMatch(repositoryUpsert, /workspace_id\s*=\s*EXCLUDED\.workspace_id/i);

const issueUpsert = sqlBlock(
  syncExecutor,
  "INSERT INTO github_issues",
  "RETURNING id, (xmax = 0) AS created"
);
assertContains(issueUpsert, "ON CONFLICT (workspace_id, github_issue_id)");
assert.doesNotMatch(issueUpsert, /workspace_id\s*=\s*EXCLUDED\.workspace_id/i);

const pullRequestUpsert = sqlBlock(
  syncExecutor,
  "INSERT INTO github_pull_requests",
  "RETURNING id, (xmax = 0) AS created"
);
assertContains(
  pullRequestUpsert,
  "ON CONFLICT (workspace_id, github_pull_request_id)"
);
assert.doesNotMatch(
  pullRequestUpsert,
  /workspace_id\s*=\s*EXCLUDED\.workspace_id/i
);

const projectUpsert = sqlBlock(
  syncExecutor,
  "INSERT INTO github_projects_v2",
  "RETURNING id, (xmax = 0) AS created"
);
assertContains(projectUpsert, "ON CONFLICT (workspace_id, github_project_node_id)");
assert.doesNotMatch(projectUpsert, /workspace_id\s*=\s*EXCLUDED\.workspace_id/i);

const fieldUpsert = sqlBlock(
  syncExecutor,
  "INSERT INTO github_project_v2_fields",
  "RETURNING id, (xmax = 0) AS created"
);
assertContains(fieldUpsert, "ON CONFLICT (project_v2_id, github_field_node_id)");
assert.doesNotMatch(fieldUpsert, /project_v2_id\s*=\s*EXCLUDED\.project_v2_id/i);

const itemUpsert = sqlBlock(
  syncExecutor,
  "INSERT INTO github_project_v2_items",
  "RETURNING id, (xmax = 0) AS created"
);
assertContains(
  itemUpsert,
  "ON CONFLICT (project_v2_id, github_project_item_node_id)"
);
assert.doesNotMatch(itemUpsert, /workspace_id\s*=\s*EXCLUDED\.workspace_id/i);
assert.doesNotMatch(itemUpsert, /project_v2_id\s*=\s*EXCLUDED\.project_v2_id/i);

assert.match(
  syncExecutor,
  /findGithubProjectV2FieldByNodeId\(\s*projectV2Id: string,\s*githubFieldNodeId: string\s*\)/
);
assert.match(syncExecutor, /WHERE project_v2_id = \$1\s+AND github_field_node_id = \$2/);

for (const constraint of [
  "uq_github_installations_workspace_installation",
  "uq_github_repositories_workspace_repository_id",
  "uq_github_repositories_workspace_node_id",
  "uq_github_issues_workspace_issue_id",
  "uq_github_issues_workspace_node_id",
  "uq_github_pull_requests_workspace_pr_id",
  "uq_github_pull_requests_workspace_node_id",
  "uq_github_projects_v2_workspace_node_id",
  "uq_github_project_v2_fields_project_node_id",
  "uq_github_project_v2_items_project_node_id"
]) {
  assert.match(migration, new RegExp(escapeRegExp(constraint)));
}

assert.match(githubIntegrationApi, /GitHub 원본 cache identity는 Workspace 범위다/);
assert.match(githubIntegrationApi, /다른 Workspace의 row를 재할당하지 않는다/);
assert.match(boardApi, /GitHub 원본 cache는 Workspace 범위로 격리된다/);

{
  const database = new FakeDatabase();
  const executor = new GithubSyncExecutorService(
    database,
    new FakeGithubAppClient()
  );
  const workspaceAId = "11111111-1111-4111-8111-111111111111";
  const workspaceBId = "99999999-9999-4999-8999-999999999999";

  await executor.runGithubSyncTarget(
    "repositories",
    syncContext(workspaceAId, "33333333-3333-4333-8333-333333333333")
  );
  await executor.runGithubSyncTarget(
    "repositories",
    syncContext(workspaceBId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
  );

  const repositoryUpserts = database.queries.filter(
    (query) =>
      query.method === "queryOne" &&
      /INSERT INTO github_repositories/i.test(query.text)
  );
  assert.equal(repositoryUpserts.length, 2);

  for (const upsert of repositoryUpserts) {
    assert.match(
      upsert.text,
      /ON CONFLICT \(workspace_id, github_repository_id\)/i
    );
    assert.doesNotMatch(upsert.text, /workspace_id\s*=\s*EXCLUDED\.workspace_id/i);
    assert.equal(upsert.values[3], 1001);
    assert.equal(upsert.values[4], "R_kgDOExample");
  }

  assert.equal(repositoryUpserts[0].values[0], workspaceAId);
  assert.equal(repositoryUpserts[1].values[0], workspaceBId);
}
