import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { BoardReadQueries } = require("../../dist/modules/board/queries/board-read.queries.js");
const { BoardIssueCreateQueries } = require("../../dist/modules/board/queries/board-issue-create.queries.js");
const { BoardReadService } = require("../../dist/modules/board/board-read.service.js");
const { BoardService } = require("../../dist/modules/board/board.service.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "33333333-3333-4333-8333-333333333333";
const githubIssueId = "44444444-4444-4444-8444-444444444444";
const projectItemId = "55555555-5555-4555-8555-555555555555";
const boardId = "42";
const columnId = "7";

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
    this.calls = [];
  }

  async assertWorkspaceAccess(userId, targetWorkspaceId) {
    this.calls.push({ userId, workspaceId: targetWorkspaceId });
    return { id: targetWorkspaceId };
  }
}

function createSubject(database = new FakeDatabase()) {
  const workspaceService = new FakeWorkspaceService();
  const readQueries = new BoardReadQueries(database);
  const readService = new BoardReadService(
    readQueries,
    workspaceService,
    new BoardIssueCreateQueries(database)
  );
  const service = new BoardService(
    { createBoard: () => assert.fail("createBoard should not be called") },
    readService
  );

  return {
    database,
    service,
    workspaceService
  };
}

function issueRow(overrides = {}) {
  return {
    id: "100",
    board_id: boardId,
    column_id: columnId,
    repository_id: repositoryId,
    github_issue_id: githubIssueId,
    project_item_id: projectItemId,
    github_issue_node_id: "I_kwDOExample",
    github_project_item_node_id: "PVTI_lADOExample",
    github_issue_number: 134,
    issue_number: "#134",
    title: "Board issue card 목록과 필터 구현",
    html_url: "https://github.com/Developer-EJ/PILO/issues/134",
    state: "open",
    labels: [{ name: "board" }],
    assignees: [{ login: "juhyeong" }],
    position: "3",
    github_updated_at: "2026-07-06T01:04:27.000Z",
    last_synced_at: "2026-07-06T01:05:00.000Z",
    created_at: "2026-07-06T01:06:00.000Z",
    updated_at: "2026-07-06T01:07:00.000Z",
    ...overrides
  };
}

function assertNoRemoteGithubCall(database) {
  for (const query of database.queries) {
    assert.doesNotMatch(query.text, /api\.github\.com/i);
    assert.doesNotMatch(query.text, /sync-runs/i);
    assert.doesNotMatch(query.text, /github_sync_runs/i);
    assert.doesNotMatch(query.text, /token|private_key|secret/i);
  }
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM boards/i);
        assert.deepEqual(values, [workspaceId, boardId]);
        return { id: boardId };
      },
      (text, values) => {
        assert.match(text, /COUNT\(\*\)/i);
        assert.match(text, /FROM pilo_issues pi/i);
        assert.match(text, /pi\.column_id = \$2::bigint/i);
        assert.match(text, /pi\.state = \$3/i);
        assert.match(text, /pi\.title ILIKE \$4/i);
        assert.match(text, /jsonb_array_elements\(pi\.labels\)/i);
        assert.match(text, /label->>'name' = \$5/i);
        assert.match(text, /jsonb_array_elements\(pi\.assignees\)/i);
        assert.match(text, /assignee->>'login' = \$6/i);
        assert.deepEqual(values, [
          boardId,
          columnId,
          "open",
          "%filter%",
          "board",
          "juhyeong"
        ]);
        return { total: "1" };
      }
    ],
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM pilo_issues pi/i);
        assert.match(text, /JOIN board_columns bc/i);
        assert.match(text, /ORDER BY bc\.position ASC, pi\.position ASC, pi\.id ASC/i);
        assert.deepEqual(values, [
          boardId,
          columnId,
          "open",
          "%filter%",
          "board",
          "juhyeong",
          10,
          10
        ]);
        return [issueRow()];
      }
    ]
  });
  const { database: db, service, workspaceService } = createSubject(database);

  const result = await service.listBoardIssues(currentUserId, workspaceId, boardId, {
    columnId,
    state: "open",
    search: " filter ",
    label: " board ",
    assignee: " juhyeong ",
    page: "2",
    limit: "10"
  });

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.deepEqual(result, {
    data: [
      {
        id: "100",
        boardId,
        columnId,
        repositoryId,
        githubIssueId,
        projectItemId,
        githubIssueNodeId: "I_kwDOExample",
        githubProjectItemNodeId: "PVTI_lADOExample",
        githubIssueNumber: 134,
        issueNumber: "#134",
        title: "Board issue card 목록과 필터 구현",
        htmlUrl: "https://github.com/Developer-EJ/PILO/issues/134",
        state: "open",
        labels: [{ name: "board" }],
        assignees: [{ login: "juhyeong" }],
        position: 3,
        githubUpdatedAt: "2026-07-06T01:04:27.000Z",
        lastSyncedAt: "2026-07-06T01:05:00.000Z",
        createdAt: "2026-07-06T01:06:00.000Z",
        updatedAt: "2026-07-06T01:07:00.000Z"
      }
    ],
    meta: {
      page: 2,
      limit: 10,
      total: 1
    }
  });
  assertNoRemoteGithubCall(db);
}

{
  const database = new FakeDatabase({
    queryOneRows: [null]
  });
  const { service } = createSubject(database);

  await assert.rejects(
    () => service.listBoardIssues(currentUserId, workspaceId, boardId, {}),
    (error) => {
      assert.equal(error.getStatus(), 404);
      assert.equal(error.getResponse().error.code, "NOT_FOUND");
      assert.equal(error.getResponse().error.message, "Board not found");
      return true;
    }
  );

  assert.equal(database.queries.length, 1);
}

{
  const { service } = createSubject();

  await assert.rejects(
    () =>
      service.listBoardIssues(currentUserId, workspaceId, boardId, {
        state: "merged"
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().error.code, "BAD_REQUEST");
      assert.equal(error.getResponse().error.message, "state must be open or closed");
      return true;
    }
  );
}

{
  const { service } = createSubject();

  await assert.rejects(
    () =>
      service.listBoardIssues(currentUserId, workspaceId, boardId, {
        limit: "101"
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().error.code, "BAD_REQUEST");
      assert.equal(error.getResponse().error.message, "limit must be 100 or less");
      return true;
    }
  );
}
