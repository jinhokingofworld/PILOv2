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

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectV2Id = "66666666-6666-4666-8666-666666666666";
const installationId = "33333333-3333-4333-8333-333333333333";
const statusFieldId = "77777777-7777-4777-8777-777777777777";
const backlogOptionId = "88888888-8888-4888-8888-888888888888";
const doneOptionId = "99999999-9999-4999-8999-999999999999";
const issueId = "44444444-4444-4444-8444-444444444444";
const pullRequestId = "55555555-5555-4555-8555-555555555555";
const itemId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createService(database = new FakeDatabase()) {
  const workspaceService = new FakeWorkspaceService();
  const service = new GithubIntegrationService(
    database,
    {},
    {},
    {},
    {},
    workspaceService,
    {},
    {}
  );

  return {
    database,
    service,
    workspaceService
  };
}

function projectRow(overrides = {}) {
  return {
    id: projectV2Id,
    installation_id: installationId,
    github_project_node_id: "PVT_kwDOExample",
    github_project_full_database_id: "42",
    owner_login: "my-team",
    owner_type: "Organization",
    project_number: 1,
    title: "PILO MVP",
    short_description: "MVP project board",
    readme: "Project readme",
    url: "https://github.com/orgs/my-team/projects/1",
    resource_path: "/orgs/my-team/projects/1",
    public: false,
    closed: false,
    template: false,
    github_created_at: "2026-06-20T03:00:00.000Z",
    github_updated_at: "2026-07-01T14:30:00.000Z",
    github_closed_at: null,
    last_synced_at: "2026-07-02T05:20:00.000Z",
    raw: { viewerCanUpdate: false },
    ...overrides
  };
}

function fieldRow(overrides = {}) {
  return {
    id: statusFieldId,
    project_v2_id: projectV2Id,
    github_field_node_id: "PVTSSF_lADOExample",
    field_name: "Status",
    data_type: "SINGLE_SELECT",
    is_status_field: true,
    github_created_at: "2026-06-20T03:00:00.000Z",
    github_updated_at: "2026-07-01T14:30:00.000Z",
    raw: { name: "Status" },
    ...overrides
  };
}

function optionRow(overrides = {}) {
  return {
    id: backlogOptionId,
    field_id: statusFieldId,
    github_option_id: "status-backlog",
    option_name: "Backlog",
    normalized_name: "backlog",
    color: "GRAY",
    description: "Ready for planning",
    position: 1,
    ...overrides
  };
}

function itemRow(overrides = {}) {
  return {
    id: itemId,
    project_v2_id: projectV2Id,
    github_project_item_node_id: "PVTI_lADOExample",
    github_project_item_full_database_id: "9001",
    content_type: "ISSUE",
    issue_id: issueId,
    pull_request_id: null,
    is_archived: false,
    status_field_id: statusFieldId,
    status_option_id: backlogOptionId,
    status_option_github_id: "status-backlog",
    status_name: "Backlog",
    status_normalized_name: "backlog",
    position: 10,
    github_created_at: "2026-07-01T10:00:00.000Z",
    github_updated_at: "2026-07-02T05:20:00.000Z",
    last_synced_at: "2026-07-02T05:21:00.000Z",
    raw: { type: "ISSUE" },
    issue_number: 10,
    issue_title: "Improve meeting summary",
    issue_state: "open",
    issue_html_url: "https://github.com/my-team/pilo/issues/10",
    issue_labels: [{ name: "enhancement" }],
    issue_assignees: [{ login: "juhyeong" }],
    pr_number: null,
    pr_title: null,
    pr_state: null,
    pr_html_url: null,
    ...overrides
  };
}

function assertNoSecretLookup(database) {
  for (const query of database.queries) {
    assert.doesNotMatch(query.text, /access_token|private_key|client_secret/i);
  }
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /COUNT\(\*\)/i);
        assert.match(text, /FROM github_projects_v2/i);
        assert.match(text, /workspace_id = \$1/i);
        assert.match(text, /owner_login = \$2/i);
        assert.match(text, /closed = false/i);
        assert.match(text, /title ILIKE/i);
        assert.deepEqual(values, [workspaceId, "my-team", "%MVP%"]);
        return { total: "1" };
      }
    ],
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM github_projects_v2/i);
        assert.match(text, /ORDER BY owner_login ASC, project_number ASC/i);
        assert.deepEqual(values, [workspaceId, "my-team", "%MVP%", 20, 0]);
        return [projectRow()];
      }
    ]
  });
  const { service, workspaceService } = createService(database);

  assert.equal(typeof service.listGithubProjectsV2, "function");

  const projects = await service.listGithubProjectsV2(currentUserId, workspaceId, {
    ownerLogin: "my-team",
    closed: "false",
    q: " MVP ",
    page: "1",
    limit: "20"
  });

  assert.deepEqual(workspaceService.accessChecks, [{ currentUserId, workspaceId }]);
  assert.deepEqual(projects, {
    data: [
      {
        id: projectV2Id,
        installationId,
        githubProjectNodeId: "PVT_kwDOExample",
        githubProjectFullDatabaseId: 42,
        ownerLogin: "my-team",
        ownerType: "Organization",
        projectNumber: 1,
        title: "PILO MVP",
        shortDescription: "MVP project board",
        url: "https://github.com/orgs/my-team/projects/1",
        public: false,
        closed: false,
        template: false,
        repositoryIds: [],
        lastSyncedAt: "2026-07-02T05:20:00.000Z"
      }
    ],
    meta: {
      page: 1,
      limit: 20,
      total: 1
    }
  });
  assertNoSecretLookup(database);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM github_projects_v2/i);
        assert.deepEqual(values, [workspaceId, projectV2Id]);
        return projectRow();
      }
    ]
  });
  const { service } = createService(database);

  const project = await service.getGithubProjectV2(
    currentUserId,
    workspaceId,
    projectV2Id
  );

  assert.deepEqual(project, {
    id: projectV2Id,
    installationId,
    githubProjectNodeId: "PVT_kwDOExample",
    githubProjectFullDatabaseId: 42,
    ownerLogin: "my-team",
    ownerType: "Organization",
    projectNumber: 1,
    title: "PILO MVP",
    shortDescription: "MVP project board",
    readme: "Project readme",
    url: "https://github.com/orgs/my-team/projects/1",
    resourcePath: "/orgs/my-team/projects/1",
    public: false,
    closed: false,
    template: false,
    repositoryIds: [],
    githubCreatedAt: "2026-06-20T03:00:00.000Z",
    githubUpdatedAt: "2026-07-01T14:30:00.000Z",
    githubClosedAt: null,
    lastSyncedAt: "2026-07-02T05:20:00.000Z"
  });
  assertNoSecretLookup(database);
}

{
  const database = new FakeDatabase({
    queryOneRows: [projectRow()],
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM github_project_v2_fields/i);
        assert.deepEqual(values, [projectV2Id]);
        return [fieldRow()];
      }
    ]
  });
  const { service } = createService(database);

  const fields = await service.listGithubProjectV2Fields(
    currentUserId,
    workspaceId,
    projectV2Id
  );

  assert.deepEqual(fields, [
    {
      id: statusFieldId,
      projectV2Id,
      githubFieldNodeId: "PVTSSF_lADOExample",
      fieldName: "Status",
      dataType: "SINGLE_SELECT",
      isStatusField: true,
      githubCreatedAt: "2026-06-20T03:00:00.000Z",
      githubUpdatedAt: "2026-07-01T14:30:00.000Z"
    }
  ]);
  assertNoSecretLookup(database);
}

{
  const database = new FakeDatabase({
    queryOneRows: [projectRow()],
    queryRows: [
      (text, values) => {
        assert.match(text, /JOIN github_project_v2_fields/i);
        assert.match(text, /is_status_field = true/i);
        assert.deepEqual(values, [projectV2Id]);
        return [
          optionRow(),
          optionRow({
            id: doneOptionId,
            github_option_id: "status-done",
            option_name: "Done",
            normalized_name: "done",
            color: "GREEN",
            description: "Finished",
            position: 2
          })
        ];
      }
    ]
  });
  const { service } = createService(database);

  const options = await service.listGithubProjectV2StatusOptions(
    currentUserId,
    workspaceId,
    projectV2Id
  );

  assert.deepEqual(options.map((option) => option.normalizedName), [
    "backlog",
    "done"
  ]);
  assertNoSecretLookup(database);
}

{
  const database = new FakeDatabase({
    queryOneRows: [projectRow()],
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM github_project_v2_items/i);
        assert.match(text, /LEFT JOIN github_issues/i);
        assert.match(text, /LEFT JOIN github_pull_requests/i);
        assert.deepEqual(values, [workspaceId, projectV2Id]);
        return [
          itemRow(),
          itemRow({
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            content_type: "PULL_REQUEST",
            issue_id: null,
            pull_request_id: pullRequestId,
            status_option_id: doneOptionId,
            status_option_github_id: "status-done",
            status_name: "Done",
            status_normalized_name: "done",
            position: 20,
            issue_number: null,
            issue_title: null,
            issue_state: null,
            issue_html_url: null,
            issue_labels: null,
            issue_assignees: null,
            pr_number: 24,
            pr_title: "Add PR review flow",
            pr_state: "open",
            pr_html_url: "https://github.com/my-team/pilo/pull/24"
          })
        ];
      }
    ]
  });
  const { service } = createService(database);

  const items = await service.listGithubProjectV2Items(
    currentUserId,
    workspaceId,
    projectV2Id
  );

  assert.deepEqual(items.map((item) => item.contentTitle), [
    "Improve meeting summary",
    "Add PR review flow"
  ]);
  assert.equal(items[0].issueId, issueId);
  assert.equal(items[1].pullRequestId, pullRequestId);
  assertNoSecretLookup(database);
}

{
  const database = new FakeDatabase({
    queryOneRows: [projectRow(), fieldRow()],
    queryRows: [
      [optionRow()],
      [itemRow()]
    ]
  });
  const { service } = createService(database);

  const kanban = await service.getGithubProjectV2Kanban(
    currentUserId,
    workspaceId,
    projectV2Id
  );

  assert.deepEqual(kanban, {
    project: {
      id: projectV2Id,
      title: "PILO MVP"
    },
    statusField: {
      id: statusFieldId,
      projectV2Id,
      githubFieldNodeId: "PVTSSF_lADOExample",
      fieldName: "Status",
      dataType: "SINGLE_SELECT",
      isStatusField: true,
      githubCreatedAt: "2026-06-20T03:00:00.000Z",
      githubUpdatedAt: "2026-07-01T14:30:00.000Z"
    },
    columns: [
      {
        id: backlogOptionId,
        fieldId: statusFieldId,
        githubOptionId: "status-backlog",
        name: "Backlog",
        key: "backlog",
        color: "GRAY",
        description: "Ready for planning",
        position: 1,
        items: [
          {
            id: itemId,
            contentType: "ISSUE",
            issueId,
            pullRequestId: null,
            title: "Improve meeting summary",
            url: "https://github.com/my-team/pilo/issues/10",
            assignees: [{ login: "juhyeong" }],
            labels: [{ name: "enhancement" }]
          }
        ]
      }
    ],
    unmappedItems: []
  });
  assertNoSecretLookup(database);
}

{
  const database = new FakeDatabase({
    queryOneRows: [null]
  });
  const { service } = createService(database);

  await assert.rejects(
    () => service.getGithubProjectV2(currentUserId, workspaceId, projectV2Id),
    (error) => {
      assert.equal(error.getStatus(), 404);
      assert.equal(error.getResponse().error.code, "NOT_FOUND");
      assert.equal(error.getResponse().error.message, "GitHub ProjectV2 not found");
      return true;
    }
  );
}
