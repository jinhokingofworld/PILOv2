import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { BoardReadQueries } = require(
  "../../dist/modules/board/queries/board-read.queries.js"
);
const { BoardReadService } = require(
  "../../dist/modules/board/board-read.service.js"
);
const { BoardIssueCreateQueries } = require(
  "../../dist/modules/board/queries/board-issue-create.queries.js"
);
const { getBoardIssueCreateTargetError } = require(
  "../../dist/modules/board/board-issue-create-target.js"
);

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const installationId = "77777777-7777-4777-8777-777777777777";

class FakeDatabase {
  constructor(rows) {
    this.rows = rows;
    this.queries = [];
  }

  async query(text, values = []) {
    this.queries.push({ text, values });
    return this.rows;
  }
}

class FakeWorkspaceService {
  async assertWorkspaceAccess(userId, targetWorkspaceId) {
    assert.equal(userId, currentUserId);
    assert.equal(targetWorkspaceId, workspaceId);
  }
}

function targetRow(overrides = {}) {
  return {
    board_id: "10",
    board_name: "PILO Project",
    repository_id: "33333333-3333-4333-8333-333333333333",
    repository_installation_id: installationId,
    repository_owner_login: "Developer-EJ",
    repository_name: "PILO",
    project_v2_id: "44444444-4444-4444-8444-444444444444",
    project_installation_id: installationId,
    github_project_node_id: "PVT_kwDOExample",
    status_field_id: "55555555-5555-4555-8555-555555555555",
    github_field_node_id: "PVTSSF_lADOExample",
    status_field_name: "Status",
    target_column_id: "100",
    target_column_name: "Todo",
    target_status_option_id: "66666666-6666-4666-8666-666666666666",
    target_status_option_github_id: "todo-option",
    target_status_name: "Todo",
    target_status_normalized_name: "todo",
    ...overrides
  };
}

assert.equal(getBoardIssueCreateTargetError(targetRow()), null);
assert.equal(
  getBoardIssueCreateTargetError(
    targetRow({
      target_status_option_id: null,
      target_status_option_github_id: null
    })
  ),
  null,
  "Unmapped columns must remain eligible just like final create validation"
);
assert.equal(
  getBoardIssueCreateTargetError(
    targetRow({ repository_id: null, repository_owner_login: null })
  ),
  "Board is missing GitHub repository metadata"
);
assert.equal(
  getBoardIssueCreateTargetError(targetRow({ project_v2_id: null })),
  "Board is missing GitHub ProjectV2 status metadata"
);
assert.equal(
  getBoardIssueCreateTargetError(targetRow({ repository_installation_id: null })),
  "Board is disconnected from its GitHub installation"
);
assert.equal(
  getBoardIssueCreateTargetError(targetRow({ project_installation_id: null })),
  "Board is disconnected from its GitHub installation"
);
assert.equal(
  getBoardIssueCreateTargetError(
    targetRow({
      project_installation_id: "88888888-8888-4888-8888-888888888888"
    })
  ),
  "Board repository and ProjectV2 installations do not match"
);
assert.equal(
  getBoardIssueCreateTargetError(
    targetRow({ target_status_option_github_id: null })
  ),
  "Board column is missing GitHub Status option metadata"
);

{
  const database = new FakeDatabase([
    targetRow({
      board_id: "20",
      board_name: "Legacy duplicate",
      project_v2_id: null,
      github_project_node_id: null,
      status_field_id: null,
      github_field_node_id: null,
      target_column_id: "200"
    }),
    targetRow(),
    targetRow({
      target_column_id: "101",
      target_column_name: "Broken status",
      target_status_option_github_id: null
    }),
    targetRow({
      target_column_id: "102",
      target_column_name: "Unmapped",
      target_status_option_id: null,
      target_status_option_github_id: null,
      target_status_name: "Unmapped",
      target_status_normalized_name: "unmapped"
    }),
    targetRow({
      board_id: "30",
      board_name: "No valid columns",
      target_column_id: "300",
      target_status_option_github_id: null
    }),
    targetRow({
      board_id: "40",
      board_name: "Missing repository metadata",
      repository_id: null,
      repository_owner_login: null,
      repository_name: null,
      target_column_id: "400"
    }),
    targetRow({
      board_id: "50",
      board_name: "Disconnected repository",
      repository_installation_id: null,
      target_column_id: "500"
    }),
    targetRow({
      board_id: "60",
      board_name: "Disconnected ProjectV2",
      project_installation_id: null,
      target_column_id: "600"
    }),
    targetRow({
      board_id: "70",
      board_name: "Mismatched installations",
      project_installation_id: "88888888-8888-4888-8888-888888888888",
      target_column_id: "700"
    })
  ]);
  const service = new BoardReadService(
    new BoardReadQueries(database),
    new FakeWorkspaceService(),
    new BoardIssueCreateQueries(database)
  );

  const options = await service.listBoardDeliveryOptions(
    currentUserId,
    workspaceId
  );

  assert.deepEqual(options, [
    {
      id: "10",
      name: "PILO Project",
      columns: [
        { id: "100", name: "Todo" },
        { id: "102", name: "Unmapped" }
      ]
    }
  ]);
  assert.equal(database.queries.length, 1);
  assert.deepEqual(database.queries[0].values, [workspaceId]);
  assert.match(database.queries[0].text, /JOIN github_repositories gr/);
  assert.match(database.queries[0].text, /LEFT JOIN github_projects_v2 gp/);
  assert.match(database.queries[0].text, /LEFT JOIN github_project_v2_fields sf/);
  assert.match(
    database.queries[0].text,
    /gr\.installation_id AS repository_installation_id/
  );
  assert.match(
    database.queries[0].text,
    /gp\.installation_id AS project_installation_id/
  );
}

{
  const database = new FakeDatabase([]);
  const service = new BoardReadService(
    new BoardReadQueries(database),
    new FakeWorkspaceService(),
    new BoardIssueCreateQueries(database)
  );

  assert.deepEqual(
    await service.listBoardDeliveryOptions(currentUserId, workspaceId),
    []
  );
}

console.log("Board delivery options eligibility tests passed");
