import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  BoardIssueStatusQueries
} = require("../../dist/modules/board/queries/board-issue-status.queries.js");
const {
  BoardIssueStatusService
} = require("../../dist/modules/board/board-issue-status.service.js");
const { BoardService } = require("../../dist/modules/board/board.service.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const boardId = "42";
const issueId = "1001";
const sourceColumnId = "10";
const targetColumnId = "20";
const repositoryId = "33333333-3333-4333-8333-333333333333";
const githubIssueId = "44444444-4444-4444-8444-444444444444";
const projectItemId = "55555555-5555-4555-8555-555555555555";
const statusFieldId = "66666666-6666-4666-8666-666666666666";

class FakeDatabase {
  constructor({ queryOneRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queries = [];
    this.transactions = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ text, values, transaction: false });
    const next = this.queryOneRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
  }

  async execute(text, values = []) {
    this.queries.push({ text, values, transaction: false });
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
    this.database.queries.push({ text, values, transaction: true });
    return this.database.queryOne(text, values);
  }

  async execute(text, values = []) {
    this.database.queries.push({ text, values, transaction: true });
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

class FakeGithubProjectV2WriteService {
  constructor({ fail = false } = {}) {
    this.fail = fail;
    this.calls = [];
  }

  async updateProjectV2ItemStatus(input) {
    this.calls.push(input);
    if (this.fail) {
      throw new Error("raw provider failure");
    }
  }
}

function createSubject(database, githubWriteService = new FakeGithubProjectV2WriteService()) {
  const workspaceService = new FakeWorkspaceService();
  const statusQueries = new BoardIssueStatusQueries(database);
  const statusService = new BoardIssueStatusService(
    statusQueries,
    workspaceService,
    githubWriteService
  );
  const service = new BoardService(
    undefined,
    undefined,
    undefined,
    statusService
  );

  return {
    database,
    githubWriteService,
    service,
    workspaceService
  };
}

function statusTargetRow(overrides = {}) {
  return {
    id: issueId,
    board_id: boardId,
    column_id: sourceColumnId,
    repository_id: repositoryId,
    github_issue_id: githubIssueId,
    project_item_id: projectItemId,
    github_issue_node_id: "I_kwDOExample",
    github_project_item_node_id: "PVTI_lADOExample",
    github_issue_number: 134,
    issue_number: "#134",
    title: "Board issue status update",
    html_url: "https://github.com/Developer-EJ/PILO/issues/134",
    state: "open",
    labels: [],
    assignees: [],
    position: 3,
    github_updated_at: "2026-07-06T01:04:27.000Z",
    last_synced_at: "2026-07-06T01:05:00.000Z",
    created_at: "2026-07-06T01:06:00.000Z",
    updated_at: "2026-07-06T01:07:00.000Z",
    project_v2_id: "77777777-7777-4777-8777-777777777777",
    github_project_node_id: "PVT_kwDOExample",
    status_field_id: statusFieldId,
    github_field_node_id: "PVTSSF_lADOExample",
    status_field_name: "Status",
    target_column_id: targetColumnId,
    target_status_option_id: "88888888-8888-4888-8888-888888888888",
    target_status_option_github_id: "option-doing",
    target_status_name: "Doing",
    target_status_normalized_name: "doing",
    ...overrides
  };
}

function issueRow(overrides = {}) {
  return {
    ...statusTargetRow(),
    column_id: targetColumnId,
    ...overrides
  };
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM pilo_issues pi/i);
        assert.match(text, /JOIN board_columns target_col/i);
        assert.deepEqual(values, [workspaceId, boardId, issueId, targetColumnId]);
        return statusTargetRow();
      },
      issueRow()
    ]
  });
  const { database: db, githubWriteService, service, workspaceService } =
    createSubject(database);

  const result = await service.updateBoardIssueStatus(
    currentUserId,
    workspaceId,
    boardId,
    issueId,
    {
      columnId: targetColumnId,
      previousColumnId: sourceColumnId
    }
  );

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.deepEqual(githubWriteService.calls, [
    {
      currentUserId,
      projectNodeId: "PVT_kwDOExample",
      itemNodeId: "PVTI_lADOExample",
      fieldNodeId: "PVTSSF_lADOExample",
      singleSelectOptionId: "option-doing"
    }
  ]);
  assert.equal(db.transactions.length, 1);
  assert.ok(
    db.queries.some((query) =>
      /UPDATE github_project_v2_items[\s\S]*status_option_id/i.test(query.text)
    )
  );
  assert.ok(
    db.queries.some((query) =>
      /INSERT INTO github_project_v2_item_field_values/i.test(query.text)
    )
  );
  assert.ok(
    db.queries.some((query) =>
      /UPDATE pilo_issues[\s\S]*column_id/i.test(query.text)
    )
  );
  assert.equal(result.previousColumnId, sourceColumnId);
  assert.equal(result.issue.id, issueId);
  assert.equal(result.issue.columnId, targetColumnId);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      statusTargetRow({
        target_status_option_id: null,
        target_status_option_github_id: null,
        target_status_name: null,
        target_status_normalized_name: null
      }),
      issueRow({ column_id: targetColumnId })
    ]
  });
  const { database: db, githubWriteService, service } = createSubject(database);

  await service.updateBoardIssueStatus(
    currentUserId,
    workspaceId,
    boardId,
    issueId,
    {
      columnId: targetColumnId
    }
  );

  assert.equal(githubWriteService.calls[0].singleSelectOptionId, null);
  assert.ok(
    db.queries.some((query) =>
      /DELETE FROM github_project_v2_item_field_values/i.test(query.text)
    )
  );
}

{
  const database = new FakeDatabase({
    queryOneRows: [statusTargetRow()]
  });
  const { database: db, githubWriteService, service } = createSubject(database);

  await assert.rejects(
    () =>
      service.updateBoardIssueStatus(
        currentUserId,
        workspaceId,
        boardId,
        issueId,
        {
          columnId: targetColumnId,
          previousColumnId: "99"
        }
      ),
    (error) => {
      assert.equal(error.getStatus(), 409);
      assert.equal(error.getResponse().error.code, "CONFLICT");
      assert.equal(
        error.getResponse().error.message,
        "Board issue column changed before status update"
      );
      return true;
    }
  );

  assert.equal(githubWriteService.calls.length, 0);
  assert.equal(db.transactions.length, 0);
}

{
  const database = new FakeDatabase({
    queryOneRows: [statusTargetRow()]
  });
  const failingGithubWriteService = new FakeGithubProjectV2WriteService({
    fail: true
  });
  const { database: db, service } = createSubject(
    database,
    failingGithubWriteService
  );

  await assert.rejects(
    () =>
      service.updateBoardIssueStatus(
        currentUserId,
        workspaceId,
        boardId,
        issueId,
        {
          columnId: targetColumnId
        }
      ),
    (error) => {
      assert.equal(error.getStatus(), 502);
      assert.equal(error.getResponse().error.code, "BAD_GATEWAY");
      assert.equal(error.getResponse().error.message, "GitHub ProjectV2 status update failed");
      return true;
    }
  );

  assert.equal(db.transactions.length, 0);
}
