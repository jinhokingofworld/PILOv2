import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  BoardHydrationService
} = require("../../dist/modules/board/board-hydration.service.js");
const { BoardService } = require("../../dist/modules/board/board.service.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "33333333-3333-4333-8333-333333333333";
const projectV2Id = "44444444-4444-4444-8444-444444444444";
const statusFieldId = "55555555-5555-4555-8555-555555555555";
const boardId = "42";

class FakeDatabase {
  constructor({ queryOneRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ text, values });
    const next = this.queryOneRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
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
  const hydrationService = new BoardHydrationService(database, workspaceService);
  const service = new BoardService(hydrationService);

  return {
    database,
    hydrationService,
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

function assertNoRemoteGithubCall(database) {
  for (const query of database.queries) {
    assert.doesNotMatch(query.text, /api\.github\.com/i);
    assert.doesNotMatch(query.text, /sync-runs/i);
    assert.doesNotMatch(query.text, /github_sync_runs/i);
    assert.doesNotMatch(query.text, /token|private_key|secret/i);
  }
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

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /FROM github_repositories gr/i);
        assert.match(text, /JOIN github_project_v2_repositories gpr/i);
        assert.match(text, /JOIN github_projects_v2 gp/i);
        assert.deepEqual(values, [workspaceId, repositoryId, projectV2Id]);
        return { repository_id: repositoryId, project_v2_id: projectV2Id };
      },
      (text, values) => {
        assert.match(text, /FROM boards/i);
        assert.deepEqual(values, [workspaceId, projectV2Id, repositoryId]);
        return null;
      },
      (text, values) => {
        assert.match(text, /hydrate_pilo_board_from_github/i);
        assert.deepEqual(values, [projectV2Id, repositoryId]);
        return { board_id: boardId };
      },
      (text, values) => {
        assert.match(text, /JOIN github_repositories gr/i);
        assert.match(text, /LEFT JOIN github_project_v2_fields sf/i);
        assert.deepEqual(values, [workspaceId, boardId]);
        return boardRow();
      }
    ]
  });
  const { database: db, service, workspaceService } = createSubject(database);

  const result = await service.createBoard(currentUserId, workspaceId, {
    repositoryId,
    projectV2Id
  });

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.equal(result.statusCode, 201);
  assertBoardPayload(result.board);
  assertNoRemoteGithubCall(db);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      { repository_id: repositoryId, project_v2_id: projectV2Id },
      { id: boardId },
      { board_id: boardId },
      boardRow({
        updated_at: "2026-07-02T05:25:00.000Z"
      })
    ]
  });
  const { service } = createSubject(database);

  const result = await service.createBoard(currentUserId, workspaceId, {
    repositoryId,
    projectV2Id
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.board.id, boardId);
  assert.equal(result.board.updatedAt, "2026-07-02T05:25:00.000Z");
}

{
  const database = new FakeDatabase();
  const { service, workspaceService } = createSubject(database);

  await assert.rejects(
    () => service.createBoard(currentUserId, workspaceId, { repositoryId }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().error.code, "BAD_REQUEST");
      assert.equal(error.getResponse().error.message, "projectV2Id is required");
      return true;
    }
  );

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.equal(database.queries.length, 0);
}

{
  const database = new FakeDatabase({
    queryOneRows: [null]
  });
  const { service } = createSubject(database);

  await assert.rejects(
    () =>
      service.createBoard(currentUserId, workspaceId, {
        repositoryId,
        projectV2Id
      }),
    (error) => {
      assert.equal(error.getStatus(), 404);
      assert.equal(error.getResponse().error.code, "NOT_FOUND");
      assert.equal(
        error.getResponse().error.message,
        "GitHub repository or ProjectV2 link not found"
      );
      return true;
    }
  );

  assert.equal(database.queries.length, 1);
}
