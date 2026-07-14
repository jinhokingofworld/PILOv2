import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ActiveBoardSourceService
} = require("../../dist/modules/board/active-board-source.service.js");
const {
  BoardHydrationService
} = require("../../dist/modules/board/board-hydration.service.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "33333333-3333-4333-8333-333333333333";
const projectV2Id = "44444444-4444-4444-8444-444444444444";
const statusFieldId = "55555555-5555-4555-8555-555555555555";
const installationId = "66666666-6666-4666-8666-666666666666";
const boardId = "42";
const updatedAt = "2026-07-14T01:00:00.000Z";

const hydrationQueries = [];
const outerTransaction = {
  async query() {
    throw new Error("Unexpected outer transaction query call");
  },
  async queryOne(text, values = []) {
    hydrationQueries.push({ text, values });

    if (/FROM github_repositories gr/i.test(text)) {
      return { repository_id: repositoryId, project_v2_id: projectV2Id };
    }
    if (/SELECT id\s+FROM boards/i.test(text)) {
      return null;
    }
    if (/hydrate_pilo_board_from_github/i.test(text)) {
      return { board_id: boardId };
    }
    if (/FROM boards b/i.test(text)) {
      return {
        id: boardId,
        workspace_id: workspaceId,
        repository_id: repositoryId,
        project_v2_id: projectV2Id,
        status_field_id: statusFieldId,
        name: "PILO MVP",
        last_sync_status: "success",
        last_synced_at: updatedAt,
        created_at: updatedAt,
        updated_at: updatedAt,
        repository_full_name: "my-team/pilo",
        repository_html_url: "https://github.com/my-team/pilo",
        github_project_node_id: "PVT_kwDOExample",
        project_number: 1,
        project_title: "PILO MVP",
        project_url: "https://github.com/orgs/my-team/projects/1",
        github_field_node_id: "PVTSSF_lADOExample",
        status_field_name: "Status"
      };
    }

    throw new Error(`Unexpected hydration query: ${text}`);
  },
  async execute() {
    throw new Error("Unexpected outer transaction execute call");
  }
};

const database = {
  poolQueryCount: 0,
  async queryOne(text, values = []) {
    this.poolQueryCount += 1;
    if (/SELECT owner_user_id FROM workspaces/i.test(text)) {
      assert.deepEqual(values, [workspaceId]);
      return { owner_user_id: currentUserId };
    }

    throw new Error("Hydration used DatabaseService instead of the outer transaction");
  },
  async transaction(callback) {
    return callback(outerTransaction);
  }
};

const workspaceService = {
  calls: [],
  async assertWorkspaceAccess(userId, targetWorkspaceId) {
    this.calls.push({ userId, workspaceId: targetWorkspaceId });
    if (this.calls.length > 1) {
      throw new Error("Hydration performed a nested workspace access query");
    }
    return { id: targetWorkspaceId };
  }
};

const githubProjectV2Service = {
  async selectWorkspaceBoardProjectV2(userId, targetWorkspaceId, input, transaction) {
    assert.equal(userId, currentUserId);
    assert.equal(targetWorkspaceId, workspaceId);
    assert.deepEqual(input, { repositoryId, projectV2Id });
    assert.equal(transaction, outerTransaction);
    return { installationId, repositoryId, projectV2Id };
  },
  async enqueueWorkspaceBoardProjectV2Sync() {}
};

const sourceRow = {
  board_id: boardId,
  workspace_id: workspaceId,
  repository_id: repositoryId,
  repository_full_name: "my-team/pilo",
  repository_html_url: "https://github.com/my-team/pilo",
  project_v2_id: projectV2Id,
  github_project_node_id: "PVT_kwDOExample",
  project_number: 1,
  project_title: "PILO MVP",
  project_url: "https://github.com/orgs/my-team/projects/1",
  updated_by_user_id: currentUserId,
  updated_at: updatedAt
};
const queries = {
  async lockWorkspaceTransition(transaction, targetWorkspaceId) {
    assert.equal(transaction, outerTransaction);
    assert.equal(targetWorkspaceId, workspaceId);
  },
  async upsert(transaction, targetWorkspaceId, targetBoardId, userId) {
    assert.equal(transaction, outerTransaction);
    assert.equal(targetWorkspaceId, workspaceId);
    assert.equal(targetBoardId, boardId);
    assert.equal(userId, currentUserId);
    return sourceRow;
  }
};
const publisher = {
  async publishSourceUpdated() {}
};

const hydrationService = new BoardHydrationService(database, workspaceService);
const service = new ActiveBoardSourceService(
  database,
  workspaceService,
  githubProjectV2Service,
  hydrationService,
  queries,
  publisher
);

const result = await service.setActiveBoardSource(currentUserId, workspaceId, {
  repositoryId,
  projectV2Id
});

assert.equal(result.boardId, boardId);
assert.equal(database.poolQueryCount, 1, "only the workspace owner lookup may use the pool");
assert.equal(hydrationQueries.length, 4);
assert.deepEqual(
  hydrationQueries.map(({ values }) => values),
  [
    [workspaceId, repositoryId, projectV2Id],
    [workspaceId, projectV2Id, repositoryId],
    [projectV2Id, repositoryId],
    [workspaceId, boardId]
  ]
);
assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);

console.log("active board source transaction hydration test passed");
