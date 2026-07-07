import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  BoardIssueCreateQueries
} = require("../../dist/modules/board/queries/board-issue-create.queries.js");
const {
  BoardIssueCreateService
} = require("../../dist/modules/board/board-issue-create.service.js");
const { BoardService } = require("../../dist/modules/board/board.service.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const boardId = "42";
const columnId = "7";
const repositoryId = "33333333-3333-4333-8333-333333333333";
const githubIssueUuid = "44444444-4444-4444-8444-444444444444";
const projectItemId = "55555555-5555-4555-8555-555555555555";
const piloIssueId = "1001";
const statusFieldId = "66666666-6666-4666-8666-666666666666";

class FakeDatabase {
  constructor({ queryOneRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queries = [];
    this.transactions = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values, transaction: false });
    const next = this.queryOneRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
  }

  async execute(text, values = []) {
    this.queries.push({ method: "execute", text, values, transaction: false });
    return { rows: [], rowCount: 1 };
  }

  async transaction(callback) {
    const transaction = new FakeTransaction(this);
    this.transactions.push(transaction);
    return callback(transaction);
  }
}

class FakeTransaction {
  constructor(database) {
    this.database = database;
  }

  async queryOne(text, values = []) {
    this.database.queries.push({
      method: "queryOne",
      text,
      values,
      transaction: true
    });
    return this.database.queryOne(text, values);
  }

  async execute(text, values = []) {
    this.database.queries.push({
      method: "execute",
      text,
      values,
      transaction: true
    });
    return { rows: [], rowCount: 1 };
  }
}

class FakeWorkspaceService {
  constructor() {
    this.calls = [];
  }

  async assertWorkspaceAccess(userId, targetWorkspaceId) {
    this.calls.push({ userId, workspaceId: targetWorkspaceId });
    return { id: targetWorkspaceId };
  }
}

class FakeGithubIssueWriteService {
  constructor({ fail = false } = {}) {
    this.fail = fail;
    this.calls = [];
  }

  async createIssue(input) {
    this.calls.push(input);
    if (this.fail) {
      throw new Error("raw provider failure");
    }

    return githubIssuePayload({
      body: input.body ?? null,
      title: input.title
    });
  }
}

class FakeGithubProjectV2WriteService {
  constructor({ addFail = false, statusFail = false } = {}) {
    this.addFail = addFail;
    this.statusFail = statusFail;
    this.addCalls = [];
    this.statusCalls = [];
  }

  async addProjectV2ItemByContentId(input) {
    this.addCalls.push(input);
    if (this.addFail) {
      throw new Error("raw provider failure");
    }

    return {
      itemNodeId: "PVTI_lADOExample"
    };
  }

  async updateProjectV2ItemStatus(input) {
    this.statusCalls.push(input);
    if (this.statusFail) {
      throw new Error("raw provider failure");
    }
  }
}

function createSubject(
  database,
  githubIssueWriteService = new FakeGithubIssueWriteService(),
  githubProjectV2WriteService = new FakeGithubProjectV2WriteService()
) {
  const workspaceService = new FakeWorkspaceService();
  const createQueries = new BoardIssueCreateQueries(database);
  const createService = new BoardIssueCreateService(
    createQueries,
    workspaceService,
    githubIssueWriteService,
    githubProjectV2WriteService
  );
  const service = new BoardService(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createService
  );

  return {
    database,
    githubIssueWriteService,
    githubProjectV2WriteService,
    service,
    workspaceService
  };
}

function createTargetRow(overrides = {}) {
  return {
    board_id: boardId,
    repository_id: repositoryId,
    repository_owner_login: "Developer-EJ",
    repository_name: "PILO",
    project_v2_id: "77777777-7777-4777-8777-777777777777",
    github_project_node_id: "PVT_kwDOExample",
    status_field_id: statusFieldId,
    github_field_node_id: "PVTSSF_lADOExample",
    target_column_id: columnId,
    target_status_option_id: "88888888-8888-4888-8888-888888888888",
    target_status_option_github_id: "option-todo",
    target_status_name: "Todo",
    target_status_normalized_name: "todo",
    ...overrides
  };
}

function githubIssuePayload(overrides = {}) {
  return {
    id: 245,
    node_id: "I_kwDOExample",
    number: 245,
    title: "New board issue",
    body: "Issue body",
    state: "open",
    state_reason: null,
    user: {
      login: "juhyeong",
      avatar_url: "https://avatar.test/u/1"
    },
    html_url: "https://github.com/Developer-EJ/PILO/issues/245",
    labels: [],
    assignees: [],
    milestone: null,
    created_at: "2026-07-07T04:44:37Z",
    updated_at: "2026-07-07T04:44:37Z",
    closed_at: null,
    ...overrides
  };
}

function createdIssueRow(overrides = {}) {
  return {
    id: piloIssueId,
    board_id: boardId,
    column_id: columnId,
    repository_id: repositoryId,
    github_issue_id: githubIssueUuid,
    project_item_id: projectItemId,
    github_issue_node_id: "I_kwDOExample",
    github_project_item_node_id: "PVTI_lADOExample",
    github_issue_number: 245,
    issue_number: "#245",
    title: "New board issue",
    html_url: "https://github.com/Developer-EJ/PILO/issues/245",
    state: "open",
    labels: [],
    assignees: [],
    position: 0,
    github_updated_at: "2026-07-07T04:44:37.000Z",
    last_synced_at: "2026-07-07T04:44:40.000Z",
    created_at: "2026-07-07T04:44:40.000Z",
    updated_at: "2026-07-07T04:44:40.000Z",
    ...overrides
  };
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM boards b/i);
        assert.match(text, /JOIN board_columns target_col/i);
        assert.match(text, /JOIN github_repositories gr/i);
        assert.match(text, /LEFT JOIN github_projects_v2 gp/i);
        assert.deepEqual(values, [workspaceId, boardId, columnId]);
        return createTargetRow();
      },
      () => ({ id: githubIssueUuid }),
      () => ({ id: projectItemId }),
      () => ({ id: piloIssueId }),
      createdIssueRow()
    ]
  });
  const {
    database: db,
    githubIssueWriteService,
    githubProjectV2WriteService,
    service,
    workspaceService
  } = createSubject(database);

  const result = await service.createBoardIssue(
    currentUserId,
    workspaceId,
    boardId,
    {
      body: "Issue body",
      columnId,
      title: "  New board issue  "
    }
  );

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.deepEqual(githubIssueWriteService.calls, [
    {
      body: "Issue body",
      currentUserId,
      owner: "Developer-EJ",
      repo: "PILO",
      title: "New board issue"
    }
  ]);
  assert.deepEqual(githubProjectV2WriteService.addCalls, [
    {
      contentNodeId: "I_kwDOExample",
      currentUserId,
      projectNodeId: "PVT_kwDOExample"
    }
  ]);
  assert.deepEqual(githubProjectV2WriteService.statusCalls, [
    {
      currentUserId,
      fieldNodeId: "PVTSSF_lADOExample",
      itemNodeId: "PVTI_lADOExample",
      projectNodeId: "PVT_kwDOExample",
      singleSelectOptionId: "option-todo"
    }
  ]);
  assert.equal(db.transactions.length, 1);
  assert.ok(db.queries.some((query) => /INSERT INTO github_issues/i.test(query.text)));
  assert.ok(
    db.queries.some((query) =>
      /INSERT INTO github_project_v2_items[\s\S]*github_project_item_node_id/i.test(
        query.text
      )
    )
  );
  assert.ok(
    db.queries.some((query) =>
      /INSERT INTO github_project_v2_item_field_values/i.test(query.text)
    )
  );
  assert.ok(db.queries.some((query) => /INSERT INTO pilo_issues/i.test(query.text)));
  assert.equal(result.issue.id, piloIssueId);
  assert.equal(result.issue.columnId, columnId);
  assert.equal(result.issue.githubIssueNumber, 245);
  assert.equal(result.issue.issueNumber, "#245");
  assert.equal(result.issue.title, "New board issue");
}

{
  const database = new FakeDatabase();
  const { service } = createSubject(database);

  await assert.rejects(
    () =>
      service.createBoardIssue(currentUserId, workspaceId, boardId, {
        body: "Issue body",
        columnId
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().error.code, "BAD_REQUEST");
      assert.equal(error.getResponse().error.message, "title must be a non-empty string");
      return true;
    }
  );

  assert.equal(database.queries.length, 0);
}

{
  const database = new FakeDatabase({
    queryOneRows: [createTargetRow()]
  });
  const failingGithubIssueWriteService = new FakeGithubIssueWriteService({
    fail: true
  });
  const { database: db, service } = createSubject(
    database,
    failingGithubIssueWriteService
  );

  await assert.rejects(
    () =>
      service.createBoardIssue(currentUserId, workspaceId, boardId, {
        columnId,
        title: "New board issue"
      }),
    (error) => {
      assert.equal(error.getStatus(), 502);
      assert.equal(error.getResponse().error.code, "BAD_GATEWAY");
      assert.equal(error.getResponse().error.message, "GitHub issue create failed");
      return true;
    }
  );

  assert.equal(db.transactions.length, 0);
}
