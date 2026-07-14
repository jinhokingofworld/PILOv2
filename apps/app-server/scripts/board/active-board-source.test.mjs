import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const boardDirectory = new URL("../../src/modules/board/", import.meta.url);
const [controller, service, sourceService, queries, projectService, pollingService, migration] = await Promise.all([
  readFile(new URL("board.controller.ts", boardDirectory), "utf8"),
  readFile(new URL("board.service.ts", boardDirectory), "utf8"),
  readFile(new URL("active-board-source.service.ts", boardDirectory), "utf8"),
  readFile(new URL("queries/active-board-source.queries.ts", boardDirectory), "utf8"),
  readFile(new URL("../github-integration/github-project-v2.service.ts", boardDirectory), "utf8"),
  readFile(new URL("../github-integration/github-project-v2-polling.service.ts", boardDirectory), "utf8"),
  readFile(new URL("../../../../db/migrations/059_create_workspace_board_settings.sql", import.meta.url), "utf8")
]);

assert.match(controller, /@Get\("active"\)/);
assert.match(controller, /@Put\("active"\)/);
assert.ok(controller.indexOf('@Get("active")') < controller.indexOf('@Get(":boardId")'));
assert.match(service, /getActiveBoardSource/);
assert.match(service, /setActiveBoardSource/);
assert.match(sourceService, /owner_user_id/);
assert.match(sourceService, /throw forbidden\("Only the workspace owner/);
assert.match(sourceService, /createBoard\(/);
assert.match(sourceService, /publishSourceUpdated/);
assert.match(sourceService, /lockWorkspaceTransition\(/);
assert.match(sourceService, /selectWorkspaceBoardProjectV2\(/);
assert.match(sourceService, /enqueueWorkspaceBoardProjectV2Sync\(/);
assert.ok(
  sourceService.indexOf("selectWorkspaceBoardProjectV2") < sourceService.indexOf("createBoard") &&
    sourceService.indexOf("createBoard") < sourceService.indexOf("queries.upsert") &&
    sourceService.indexOf("queries.upsert") < sourceService.indexOf("enqueueWorkspaceBoardProjectV2Sync") &&
    sourceService.indexOf("enqueueWorkspaceBoardProjectV2Sync") < sourceService.indexOf("publishSourceUpdated"),
  "selection, hydration, committed pointer, background detail sync, and source notification must stay ordered"
);
assert.match(queries, /workspace_board_settings/);
assert.match(queries, /ON CONFLICT \(workspace_id\)/);
assert.match(queries, /pg_advisory_xact_lock/);
assert.match(projectService, /DELETE FROM github_project_v2_selections AS selection[\s\S]*?repository\.workspace_id = \$1::uuid/);
assert.match(projectService, /terminateWorkspaceDeselectedQueuedRuns/);
assert.match(projectService, /DELETE FROM github_project_v2_polling_schedules AS schedule[\s\S]*?repository\.workspace_id = \$1::uuid/);
assert.match(projectService, /syncSelectionSchedules/);
assert.match(projectService, /project_v2_fields/);
assert.match(projectService, /project_v2_items/);
assert.match(pollingService, /GitHub ProjectV2 Board source was replaced/);
assert.match(migration, /CREATE TABLE public\.workspace_board_settings/);
assert.match(migration, /active_board_id BIGINT NOT NULL/);
assert.match(migration, /UNIQUE \(workspace_id, id\)/);
assert.match(migration, /FOREIGN KEY \(workspace_id, active_board_id\)[\s\S]*?REFERENCES public\.boards\(workspace_id, id\)/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);

console.log("active board source backend structure tests passed");
