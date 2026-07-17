import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

await import("./board-issue-idempotency.test.mjs");
await import("./board-structure.test.mjs");
await import("./board-assignees.test.mjs");

async function readFeatureFile(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const [
  boardTypes,
  boardApiClient,
  boardDataHook,
  boardPanel,
  boardKanban,
  boardIssueSheet,
  boardIssueCreateForm,
  boardIssueCreateDialog
] = await Promise.all([
  readFeatureFile("./types/index.ts"),
  readFeatureFile("./api/client.ts"),
  readFeatureFile("./hooks/use-board-workspace-data.ts"),
  readFeatureFile("./components/board-panel.tsx"),
  readFeatureFile("./components/board-kanban.tsx"),
  readFeatureFile("./components/board-issue-sheet.tsx"),
  readFeatureFile("./components/board-issue-create-form.tsx"),
  readFeatureFile("./components/board-issue-create-dialog.tsx")
]);

assert.match(boardTypes, /export type BoardPayload/);
assert.match(boardTypes, /export type BoardGithubRepositoryPayload/);
assert.match(boardTypes, /export type BoardGithubProjectV2Payload/);
assert.match(boardTypes, /export type BoardColumnPayload/);
assert.match(boardTypes, /export type BoardIssueCardPayload/);
assert.match(boardTypes, /export type BoardIssueDetailPayload/);
assert.match(boardTypes, /export type BoardFilterOptionsPayload/);
assert.match(boardTypes, /export type CreateBoardInput/);
assert.match(boardTypes, /export type CreateBoardIssueInput/);
assert.match(boardTypes, /export type CreateBoardIssuePayload/);
assert.match(boardTypes, /export type UpdateBoardIssueStatusInput/);
assert.match(boardTypes, /export type UpdateBoardIssueInput/);
assert.match(boardTypes, /export type UpdateBoardIssuePayload/);
assert.match(boardTypes, /export type ListBoardIssuesQuery/);

assert.match(boardApiClient, /createBoardApiClient/);
assert.match(boardApiClient, /BoardApiError/);
assert.match(boardApiClient, /success === true/);
assert.match(boardApiClient, /Authorization/);
assert.match(boardApiClient, /credentials: "same-origin"/);
assert.match(boardApiClient, /\/workspaces\/\$\{encodeURIComponent\(workspaceId\)\}\/boards/);
assert.match(boardApiClient, /listBoards/);
assert.match(boardApiClient, /createBoard/);
assert.match(boardApiClient, /getBoard/);
assert.match(boardApiClient, /listBoardColumns/);
assert.match(boardApiClient, /listBoardIssues/);
assert.match(boardApiClient, /createBoardIssue/);
assert.match(boardApiClient, /getBoardIssue/);
assert.match(boardApiClient, /updateBoardIssueStatus/);
assert.match(boardApiClient, /updateBoardIssue/);
assert.match(boardApiClient, /method: "PATCH"/);
assert.match(boardApiClient, /\/status/);
assert.match(boardApiClient, /listBoardIssuePullRequests/);
assert.match(boardApiClient, /getBoardFilterOptions/);
assert.match(boardApiClient, /listGithubRepositories/);
assert.match(boardApiClient, /listGithubProjectsV2/);
assert.match(
  boardApiClient,
  /workspaceGithubPath\(workspaceId, "\/repositories"\)/
);
assert.match(
  boardApiClient,
  /workspaceGithubPath\(workspaceId, "\/projects-v2"\)/
);
assert.match(boardApiClient, /credentials: "include"/);

assert.match(boardDataHook, /useBoardWorkspaceData/);
assert.match(boardDataHook, /createBoardApiClient/);
assert.doesNotMatch(boardDataHook, /createGithubIntegrationApiClient/);
assert.doesNotMatch(boardDataHook, /@\/features\/github-integration/);
assert.match(boardDataHook, /listGithubRepositories/);
assert.match(boardDataHook, /listGithubProjectsV2/);
assert.match(
  boardDataHook,
  /listGithubRepositories\(normalizedWorkspaceId, \{\s*includeArchived: false,\s*limit: 100\s*\}\)/
);
assert.match(
  boardDataHook,
  /listGithubProjectsV2\(normalizedWorkspaceId, \{\s*closed: false,\s*limit: 100,\s*repositoryId: selectedRepositoryId\s*\}\)/
);
assert.match(boardDataHook, /listBoards/);
assert.match(boardDataHook, /listBoardColumns/);
assert.match(boardDataHook, /listBoardIssues/);
assert.match(boardDataHook, /getBoardFilterOptions/);
assert.match(boardDataHook, /Promise\.all/);
assert.match(boardDataHook, /refreshBoard/);
assert.match(boardDataHook, /hydrateBoard/);
assert.match(boardDataHook, /createBoardIssue/);
assert.match(boardDataHook, /moveIssueStatus/);
assert.match(boardDataHook, /previousColumnId/);
assert.match(boardDataHook, /setBoardState/);

assert.match(boardPanel, /useAuthSession/);
assert.match(boardPanel, /activeWorkspaceId/);
assert.match(boardPanel, /useBoardWorkspaceData/);
assert.match(boardPanel, /BoardIssueCreateDialog/);
assert.match(boardPanel, /BoardKanban/);
assert.match(boardPanel, /BoardIssueSheet/);
assert.match(boardPanel, /onIssueUpdated/);
assert.match(boardPanel, /createBoardIssue/);
assert.match(boardPanel, /moveIssueStatus/);
assert.match(boardPanel, /statusMoveError/);
assert.match(boardPanel, /issueCreateError/);
assert.match(boardPanel, /isIssueCreateModalOpen/);
assert.doesNotMatch(boardPanel, /readGithubBoardSelection|boardData\.hydrateBoard/);
assert.match(boardPanel, /boardData\.activeSource\?\.boardId/);
assert.doesNotMatch(boardPanel, /boardData\.boards\[0\]|readGithubBoardSelection/);
assert.doesNotMatch(boardPanel, /BoardHydrationForm/);
assert.doesNotMatch(boardPanel, /board-hydrate-dock/);
assert.match(boardPanel, /query/);
assert.match(boardPanel, /state/);
assert.match(boardPanel, /assignee/);
assert.match(boardPanel, /label/);
assert.match(boardPanel, /data-board-main/);
assert.match(boardPanel, /workspace-board/);
assert.match(boardPanel, /board-toolbar/);
assert.match(boardPanel, /board-summary/);
assert.match(boardPanel, /summary-chip/);
assert.match(boardPanel, /board-controls/);
assert.match(
  boardPanel,
  /board-controls[\s\S]*placeholder="Search issues"[\s\S]*<select[\s\S]*Board 선택[\s\S]*RefreshCw[\s\S]*setIsIssueCreateModalOpen\(true\)/,
  "Board toolbar controls should keep search, board selection, refresh, and new issue together"
);
assert.doesNotMatch(boardPanel, /board-title/);
assert.doesNotMatch(boardPanel, /board-icon/);
assert.doesNotMatch(boardPanel, /board-issue-create-dock/);

assert.match(boardIssueCreateForm, /BoardIssueCreateForm/);
assert.match(boardIssueCreateForm, /columns/);
assert.match(boardIssueCreateForm, /onCreateIssue/);
assert.match(boardIssueCreateForm, /title/);
assert.match(boardIssueCreateForm, /body/);
assert.match(boardIssueCreateForm, /columnId/);
assert.match(boardIssueCreateForm, /새 이슈/);
assert.match(boardIssueCreateForm, /created === false/);
assert.doesNotMatch(boardIssueCreateForm, /Card/);

assert.match(boardIssueCreateDialog, /BoardIssueCreateDialog/);
assert.match(boardIssueCreateDialog, /DialogPrimitive/);
assert.match(boardIssueCreateDialog, /DialogPrimitive\.Popup/);
assert.match(boardIssueCreateDialog, /top-1\/2 left-1\/2/);
assert.match(boardIssueCreateDialog, /max-w-\[720px\]/);
assert.match(boardIssueCreateDialog, /BoardIssueCreateForm/);
assert.match(boardIssueCreateDialog, /새 이슈/);

assert.match(boardKanban, /columns/);
assert.match(boardKanban, /issuesByColumnId/);
assert.match(boardKanban, /onOpenIssue/);
assert.match(boardKanban, /onMoveIssue/);
assert.match(boardKanban, /draggable/);
assert.match(boardKanban, /onDrop/);
assert.match(boardKanban, /kanban-scroll/);
assert.match(boardKanban, /kanban-board/);
assert.match(boardKanban, /lane-header/);
assert.match(boardKanban, /lane-stack/);
assert.match(boardKanban, /issue-card/);
assert.doesNotMatch(boardKanban, /읽기 전용/);

assert.match(boardIssueSheet, /DialogPrimitive/);
assert.match(boardIssueSheet, /DialogPrimitive\.Popup/);
assert.match(boardIssueSheet, /top-1\/2 left-1\/2/);
assert.match(boardIssueSheet, /max-w-\[1080px\]/);
assert.match(boardIssueSheet, /overflow-y-auto/);
assert.doesNotMatch(boardIssueSheet, /@\/components\/ui\/sheet/);
assert.match(boardIssueSheet, /getBoardIssue/);
assert.match(boardIssueSheet, /updateBoardIssue/);
assert.match(boardIssueSheet, /listBoardIssuePullRequests/);
assert.match(boardIssueSheet, /isEditing/);
assert.match(boardIssueSheet, /isSaving/);
assert.match(boardIssueSheet, /saveError/);
assert.match(boardIssueSheet, /onIssueUpdated/);
assert.match(boardIssueSheet, /관련 PR/);
assert.match(boardIssueSheet, /htmlUrl/);
