import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  BoardIssueUpdateQueries
} = require("../../dist/modules/board/queries/board-issue-update.queries.js");
const {
  BoardIssueUpdateService
} = require("../../dist/modules/board/board-issue-update.service.js");
const { BoardService } = require("../../dist/modules/board/board.service.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const boardId = "42";
const columnId = "7";
const issueId = "1001";
const repositoryId = "33333333-3333-4333-8333-333333333333";
const githubIssueId = "44444444-4444-4444-8444-444444444444";
const projectItemId = "55555555-5555-4555-8555-555555555555";

class FakeDatabase {
  constructor({ queryOneRows = [], queryRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queryRows = [...queryRows];
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

  async query(text, values = []) {
    this.queries.push({ method: "query", text, values, transaction: false });
    const next = this.queryRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? [];
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

  async updateIssue(input) {
    this.calls.push(input);
    if (this.fail) {
      throw new Error("raw provider failure");
    }

    return githubIssuePayload({
      body: input.body ?? "Updated body",
      state: input.state ?? "open",
      title: input.title ?? "Updated title"
    });
  }
}

function createSubject(database, githubIssueWriteService = new FakeGithubIssueWriteService()) {
  const workspaceService = new FakeWorkspaceService();
  const updateQueries = new BoardIssueUpdateQueries(database);
  const updateService = new BoardIssueUpdateService(
    updateQueries,
    workspaceService,
    githubIssueWriteService
  );
  const service = new BoardService(
    undefined,
    undefined,
    undefined,
    undefined,
    updateService
  );

  return {
    database,
    githubIssueWriteService,
    service,
    workspaceService
  };
}

function updateTargetRow(overrides = {}) {
  return {
    id: issueId,
    board_id: boardId,
    column_id: columnId,
    repository_id: repositoryId,
    repository_owner_login: "Developer-EJ",
    repository_name: "PILO",
    github_issue_id: githubIssueId,
    project_item_id: projectItemId,
    github_issue_node_id: "I_kwDOExample",
    github_project_item_node_id: "PVTI_lADOExample",
    github_issue_number: 203,
    issue_number: "#203",
    title: "Old issue title",
    body: "Old issue body",
    html_url: "https://github.com/Developer-EJ/PILO/issues/203",
    state: "open",
    labels: [],
    assignees: [],
    milestone: null,
    position: 3,
    github_updated_at: "2026-07-06T13:18:39.000Z",
    last_synced_at: "2026-07-06T13:18:40.000Z",
    created_at: "2026-07-06T13:18:39.000Z",
    updated_at: "2026-07-06T13:18:40.000Z",
    ...overrides
  };
}

function updatedIssueRow(overrides = {}) {
  return {
    ...updateTargetRow(),
    title: "Updated issue title",
    body: "Updated issue body",
    state: "closed",
    github_updated_at: "2026-07-06T13:56:37.000Z",
    last_synced_at: "2026-07-06T13:56:40.000Z",
    updated_at: "2026-07-06T13:56:40.000Z",
    ...overrides
  };
}

function projectFieldRow(overrides = {}) {
  return {
    field_name: "Priority",
    field_data_type: "SINGLE_SELECT",
    text_value: null,
    number_value: null,
    date_value: null,
    single_select_option_id: "priority-high",
    single_select_name: "High",
    iteration_id: null,
    iteration_title: null,
    ...overrides
  };
}

function githubIssuePayload(overrides = {}) {
  return {
    id: 9999,
    node_id: "I_kwDOExample",
    number: 203,
    title: "Updated issue title",
    body: "Updated issue body",
    state: "closed",
    state_reason: "completed",
    user: {
      login: "juhyeong",
      avatar_url: "https://avatar.test/u/1"
    },
    html_url: "https://github.com/Developer-EJ/PILO/issues/203",
    labels: [{ name: "board", color: "ededed" }],
    assignees: [{ login: "juhyeong", avatar_url: "https://avatar.test/u/1" }],
    milestone: { title: "MVP" },
    created_at: "2026-07-06T13:18:39Z",
    updated_at: "2026-07-06T13:56:37Z",
    closed_at: "2026-07-06T13:56:37Z",
    ...overrides
  };
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM pilo_issues pi/i);
        assert.match(text, /JOIN github_repositories gr/i);
        assert.match(text, /pi\.workspace_id = \$1/i);
        assert.match(text, /pi\.board_id = \$2::bigint/i);
        assert.match(text, /pi\.id = \$3::bigint/i);
        assert.deepEqual(values, [workspaceId, boardId, issueId]);
        return updateTargetRow();
      },
      updatedIssueRow()
    ],
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM github_project_v2_item_field_values/i);
        assert.deepEqual(values, [projectItemId]);
        return [projectFieldRow()];
      }
    ]
  });
  const { database: db, githubIssueWriteService, service, workspaceService } =
    createSubject(database);

  const result = await service.updateBoardIssue(
    currentUserId,
    workspaceId,
    boardId,
    issueId,
    {
      body: "Updated issue body",
      state: "closed",
      title: "Updated issue title"
    }
  );

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.deepEqual(githubIssueWriteService.calls, [
    {
      body: "Updated issue body",
      currentUserId,
      issueNumber: 203,
      owner: "Developer-EJ",
      repo: "PILO",
      state: "closed",
      title: "Updated issue title"
    }
  ]);
  assert.equal(db.transactions.length, 1);
  assert.ok(
    db.queries.some((query) =>
      /UPDATE github_issues[\s\S]*title[\s\S]*body[\s\S]*state/i.test(query.text)
    )
  );
  assert.ok(
    db.queries.some((query) =>
      /UPDATE pilo_issues[\s\S]*title[\s\S]*body[\s\S]*state/i.test(query.text)
    )
  );
  assert.equal(result.issue.id, issueId);
  assert.equal(result.issue.title, "Updated issue title");
  assert.equal(result.issue.body, "Updated issue body");
  assert.equal(result.issue.state, "closed");
  assert.deepEqual(result.issue.projectFields, [
    {
      fieldName: "Priority",
      fieldDataType: "SINGLE_SELECT",
      singleSelectOptionId: "priority-high",
      singleSelectName: "High"
    }
  ]);
}

{
  const database = new FakeDatabase();
  const { service } = createSubject(database);

  await assert.rejects(
    () =>
      service.updateBoardIssue(
        currentUserId,
        workspaceId,
        boardId,
        issueId,
        {}
      ),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().error.code, "BAD_REQUEST");
      assert.equal(
        error.getResponse().error.message,
        "At least one of title/body/state is required"
      );
      return true;
    }
  );

  assert.equal(database.queries.length, 0);
}

{
  const database = new FakeDatabase();
  const { service } = createSubject(database);

  await assert.rejects(
    () =>
      service.updateBoardIssue(
        currentUserId,
        workspaceId,
        boardId,
        issueId,
        {
          state: "merged"
        }
      ),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().error.code, "BAD_REQUEST");
      assert.equal(error.getResponse().error.message, "state must be open or closed");
      return true;
    }
  );

  assert.equal(database.queries.length, 0);
}

{
  const database = new FakeDatabase({
    queryOneRows: [updateTargetRow()]
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
      service.updateBoardIssue(
        currentUserId,
        workspaceId,
        boardId,
        issueId,
        {
          title: "Updated issue title"
        }
      ),
    (error) => {
      assert.equal(error.getStatus(), 502);
      assert.equal(error.getResponse().error.code, "BAD_GATEWAY");
      assert.equal(error.getResponse().error.message, "GitHub issue update failed");
      return true;
    }
  );

  assert.equal(db.transactions.length, 0);
}
