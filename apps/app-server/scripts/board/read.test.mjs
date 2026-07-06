import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { BoardReadQueries } = require("../../dist/modules/board/queries/board-read.queries.js");
const { BoardReadService } = require("../../dist/modules/board/board-read.service.js");
const { BoardService } = require("../../dist/modules/board/board.service.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "33333333-3333-4333-8333-333333333333";
const projectV2Id = "44444444-4444-4444-8444-444444444444";
const statusFieldId = "55555555-5555-4555-8555-555555555555";
const boardId = "42";
const backlogColumnId = "7";
const unmappedColumnId = "8";

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
  const readService = new BoardReadService(readQueries, workspaceService);
  const service = new BoardService(
    { createBoard: () => assert.fail("createBoard should not be called") },
    readService
  );

  return {
    database,
    readQueries,
    readService,
    service,
    workspaceService
  };
}

function boardRow(overrides = {}) {
  return {
    id: boardId,
    workspace_id: workspaceId,
    repository_id: repositoryId,
    project_v2_id: projectV2Id,
    status_field_id: statusFieldId,
    name: "PILO MVP",
    last_sync_status: "success",
    last_synced_at: "2026-07-02T05:20:00.000Z",
    created_at: "2026-07-02T05:21:00.000Z",
    updated_at: "2026-07-02T05:21:00.000Z",
    repository_full_name: "my-team/pilo",
    repository_html_url: "https://github.com/my-team/pilo",
    github_project_node_id: "PVT_kwDOExample",
    project_number: 1,
    project_title: "PILO MVP",
    project_url: "https://github.com/orgs/my-team/projects/1",
    github_field_node_id: "PVTSSF_lADOExample",
    status_field_name: "Status",
    ...overrides
  };
}

function boardDetailRow(overrides = {}) {
  return {
    ...boardRow(),
    columns_count: "4",
    total_cards: "34",
    open_cards: "30",
    closed_cards: "4",
    ...overrides
  };
}

function columnRow(overrides = {}) {
  return {
    id: backlogColumnId,
    board_id: boardId,
    status_option_id: "66666666-6666-4666-8666-666666666666",
    status_option_github_id: "status-backlog",
    normalized_name: "backlog",
    name: "Backlog",
    position: 1,
    color: "GRAY",
    issue_count: "7",
    ...overrides
  };
}

function assertBoardPayload(payload) {
  assert.deepEqual(payload, {
    id: boardId,
    workspaceId,
    name: "PILO MVP",
    repository: {
      id: repositoryId,
      fullName: "my-team/pilo",
      htmlUrl: "https://github.com/my-team/pilo"
    },
    project: {
      id: projectV2Id,
      githubProjectNodeId: "PVT_kwDOExample",
      projectNumber: 1,
      title: "PILO MVP",
      url: "https://github.com/orgs/my-team/projects/1"
    },
    statusField: {
      id: statusFieldId,
      githubFieldNodeId: "PVTSSF_lADOExample",
      name: "Status"
    },
    syncStatus: "success",
    lastSyncedAt: "2026-07-02T05:20:00.000Z",
    createdAt: "2026-07-02T05:21:00.000Z",
    updatedAt: "2026-07-02T05:21:00.000Z"
  });
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
        assert.match(text, /COUNT\(\*\)/i);
        assert.match(text, /FROM boards b/i);
        assert.deepEqual(values, [workspaceId, repositoryId, projectV2Id]);
        return { total: "1" };
      }
    ],
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM boards b/i);
        assert.match(text, /JOIN github_repositories gr/i);
        assert.match(text, /JOIN github_projects_v2 gp/i);
        assert.match(text, /LEFT JOIN github_project_v2_fields sf/i);
        assert.match(text, /ORDER BY b\.updated_at DESC/i);
        assert.deepEqual(values, [workspaceId, repositoryId, projectV2Id, 20, 0]);
        return [boardRow()];
      }
    ]
  });
  const { database: db, service, workspaceService } = createSubject(database);

  const result = await service.listBoards(currentUserId, workspaceId, {
    repositoryId,
    projectV2Id,
    page: "1",
    limit: "20"
  });

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.equal(result.meta.total, 1);
  assert.equal(result.meta.page, 1);
  assert.equal(result.meta.limit, 20);
  assertBoardPayload(result.data[0]);
  assertNoRemoteGithubCall(db);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM boards b/i);
        assert.match(text, /columns_count[\s\S]*FROM boards b/i);
        assert.match(text, /FROM board_columns/i);
        assert.match(text, /FROM pilo_issues/i);
        assert.deepEqual(values, [workspaceId, boardId]);
        return boardDetailRow();
      }
    ]
  });
  const { service } = createSubject(database);

  const detail = await service.getBoard(currentUserId, workspaceId, boardId);

  assert.deepEqual(detail.summary, {
    columnsCount: 4,
    totalCards: 34,
    openCards: 30,
    closedCards: 4
  });
  assert.deepEqual(detail.sync, {
    status: "success",
    lastSyncedAt: "2026-07-02T05:20:00.000Z"
  });
  assert.equal(detail.id, boardId);
  assert.equal(detail.project.projectNumber, 1);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM boards/i);
        assert.deepEqual(values, [workspaceId, boardId]);
        return { id: boardId };
      }
    ],
    queryRows: [
      (text, values) => {
        assert.match(text, /FROM board_columns bc/i);
        assert.match(text, /LEFT JOIN pilo_issues pi/i);
        assert.match(text, /ORDER BY bc\.position ASC/i);
        assert.deepEqual(values, [boardId]);
        return [
          columnRow(),
          columnRow({
            id: unmappedColumnId,
            status_option_id: null,
            status_option_github_id: null,
            normalized_name: "unmapped",
            name: "Unmapped",
            position: 99,
            color: "#8a93a6",
            issue_count: 1
          })
        ];
      }
    ]
  });
  const { service } = createSubject(database);

  const columns = await service.listBoardColumns(
    currentUserId,
    workspaceId,
    boardId
  );

  assert.deepEqual(columns, [
    {
      id: backlogColumnId,
      boardId,
      statusOptionId: "66666666-6666-4666-8666-666666666666",
      githubStatusOptionId: "status-backlog",
      name: "Backlog",
      normalizedName: "backlog",
      position: 1,
      color: "GRAY",
      issueCount: 7
    },
    {
      id: unmappedColumnId,
      boardId,
      statusOptionId: null,
      githubStatusOptionId: null,
      name: "Unmapped",
      normalizedName: "unmapped",
      position: 99,
      color: "#8a93a6",
      issueCount: 1
    }
  ]);
}

{
  const database = new FakeDatabase({
    queryOneRows: [null]
  });
  const { service } = createSubject(database);

  await assert.rejects(
    () => service.getBoard(currentUserId, workspaceId, boardId),
    (error) => {
      assert.equal(error.getStatus(), 404);
      assert.equal(error.getResponse().error.code, "NOT_FOUND");
      assert.equal(error.getResponse().error.message, "Board not found");
      return true;
    }
  );
}

{
  const database = new FakeDatabase({
    queryOneRows: [null]
  });
  const { service } = createSubject(database);

  await assert.rejects(
    () => service.listBoardColumns(currentUserId, workspaceId, boardId),
    (error) => {
      assert.equal(error.getStatus(), 404);
      assert.equal(error.getResponse().error.code, "NOT_FOUND");
      assert.equal(error.getResponse().error.message, "Board not found");
      return true;
    }
  );

  assert.equal(database.queries.length, 1);
}
