import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8").catch((error) => {
    if (error && error.code === "ENOENT") {
      return "";
    }

    throw error;
  });
}

const appServerRoot = new URL("../..", import.meta.url);
const tscScript = fileURLToPath(
  new URL("../../node_modules/typescript/bin/tsc", import.meta.url)
);

const appModule = await readSource("../../src/app.module.ts");
const rootTest = await readSource("../test.mjs");
const moduleFile = await readSource("../../src/modules/board/board.module.ts");
const controllerFile = await readSource(
  "../../src/modules/board/board.controller.ts"
);
const serviceFile = await readSource("../../src/modules/board/board.service.ts");
const readServiceFile = await readSource(
  "../../src/modules/board/board-read.service.ts"
);
const issueReadServiceFile = await readSource(
  "../../src/modules/board/board-issue-read.service.ts"
);
const issueStatusServiceFile = await readSource(
  "../../src/modules/board/board-issue-status.service.ts"
);
const issueUpdateServiceFile = await readSource(
  "../../src/modules/board/board-issue-update.service.ts"
);
const issueCreateServiceFile = await readSource(
  "../../src/modules/board/board-issue-create.service.ts"
);
const readQueriesFile = await readSource(
  "../../src/modules/board/queries/board-read.queries.ts"
);
const statusQueriesFile = await readSource(
  "../../src/modules/board/queries/board-issue-status.queries.ts"
);
const updateQueriesFile = await readSource(
  "../../src/modules/board/queries/board-issue-update.queries.ts"
);
const createQueriesFile = await readSource(
  "../../src/modules/board/queries/board-issue-create.queries.ts"
);
const githubIssueWriteServiceFile = await readSource(
  "../../src/modules/github-integration/github-issue-write.service.ts"
);
const githubProjectV2WriteServiceFile = await readSource(
  "../../src/modules/github-integration/github-project-v2-write.service.ts"
);
const githubAppClientFile = await readSource(
  "../../src/modules/github-integration/github-app.client.ts"
);
const hydrationServiceFile = await readSource(
  "../../src/modules/board/board-hydration.service.ts"
);
const dtoIndexFile = await readSource("../../src/modules/board/dto/index.ts");
const typesIndexFile = await readSource("../../src/modules/board/types/index.ts");
const readmeFile = await readSource("../../src/modules/board/README.md");

assert.match(appModule, /import \{ BoardModule \}/);
assert.match(appModule, /imports: \[[\s\S]*BoardModule[\s\S]*\]/);

assert.match(rootTest, /import\("\.\/board\/test\.mjs"\)/);

assert.match(moduleFile, /imports: \[[\s\S]*CommonModule[\s\S]*\]/);
assert.match(moduleFile, /imports: \[[\s\S]*DatabaseModule[\s\S]*\]/);
assert.match(moduleFile, /imports: \[[\s\S]*WorkspaceModule[\s\S]*\]/);
assert.match(moduleFile, /imports: \[[\s\S]*GithubIntegrationModule[\s\S]*\]/);
assert.match(moduleFile, /controllers: \[BoardController\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardService[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardHydrationService[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardIssueReadService[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardIssueStatusService[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardIssueUpdateService[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardIssueCreateService[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardReadService[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardReadQueries[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardIssueStatusQueries[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardIssueUpdateQueries[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardIssueCreateQueries[\s\S]*\]/);
assert.match(moduleFile, /exports: \[BoardService\]/);

assert.match(controllerFile, /@Controller\("workspaces\/:workspaceId\/boards"\)/);
assert.match(controllerFile, /@UseGuards\(AuthGuard\)/);
assert.match(controllerFile, /constructor\(private readonly boardService: BoardService\)/);
assert.match(controllerFile, /@Post\(\)/);
assert.match(controllerFile, /@Get\(\)/);
assert.match(controllerFile, /@Get\(":boardId"\)/);
assert.match(controllerFile, /@Get\(":boardId\/columns"\)/);
assert.match(controllerFile, /@Get\(":boardId\/issues"\)/);
assert.match(controllerFile, /@Post\(":boardId\/issues"\)/);
assert.match(controllerFile, /@Get\(":boardId\/issues\/:issueId"\)/);
assert.match(controllerFile, /@Get\(":boardId\/issues\/:issueId\/pull-requests"\)/);
assert.match(controllerFile, /@Get\(":boardId\/filter-options"\)/);
assert.match(controllerFile, /@Patch\(":boardId\/issues\/:issueId\/status"\)/);
assert.match(controllerFile, /@Patch\(":boardId\/issues\/:issueId"\)/);
assert.match(controllerFile, /@CurrentUserId\(\) currentUserId: string/);
assert.match(controllerFile, /@Param\("workspaceId"\) workspaceId: string/);
assert.match(controllerFile, /@Body\(\) body: unknown/);
assert.match(controllerFile, /apiResponse\(result\.board\)/);

assert.match(serviceFile, /getModuleInfo\(\): BoardModuleInfo/);
assert.match(serviceFile, /domain: "board"/);
assert.match(serviceFile, /apiContract: "docs\/api\/board-api\.md"/);
assert.match(serviceFile, /createBoard/);
assert.match(serviceFile, /listBoards/);
assert.match(serviceFile, /getBoard/);
assert.match(serviceFile, /listBoardColumns/);
assert.match(serviceFile, /listBoardIssues/);
assert.match(serviceFile, /getBoardIssue/);
assert.match(serviceFile, /listBoardIssuePullRequests/);
assert.match(serviceFile, /getBoardFilterOptions/);
assert.match(serviceFile, /updateBoardIssueStatus/);
assert.match(serviceFile, /updateBoardIssue/);
assert.match(serviceFile, /createBoardIssue/);

assert.match(readServiceFile, /class BoardReadService/);
assert.match(readServiceFile, /assertWorkspaceAccess/);
assert.match(readServiceFile, /BoardReadQueries/);
assert.doesNotMatch(readServiceFile, /FROM boards b/);
assert.doesNotMatch(readServiceFile, /FROM board_columns bc/);
assert.doesNotMatch(readServiceFile, /FROM pilo_issues/);

assert.match(issueReadServiceFile, /class BoardIssueReadService/);
assert.match(issueReadServiceFile, /findBoardIssueDetail/);
assert.match(issueReadServiceFile, /listRelatedPullRequests/);
assert.match(issueReadServiceFile, /getBoardFilterOptions/);
assert.doesNotMatch(issueReadServiceFile, /FROM pilo_issues/);

assert.match(issueStatusServiceFile, /class BoardIssueStatusService/);
assert.match(issueStatusServiceFile, /assertWorkspaceAccess/);
assert.match(issueStatusServiceFile, /updateProjectV2ItemStatus/);
assert.match(issueStatusServiceFile, /previousColumnId/);
assert.doesNotMatch(issueStatusServiceFile, /FROM pilo_issues/);

assert.match(issueUpdateServiceFile, /class BoardIssueUpdateService/);
assert.match(issueUpdateServiceFile, /assertWorkspaceAccess/);
assert.match(issueUpdateServiceFile, /updateIssue/);
assert.match(issueUpdateServiceFile, /title\/body\/state/);
assert.doesNotMatch(issueUpdateServiceFile, /FROM pilo_issues/);

assert.match(issueCreateServiceFile, /class BoardIssueCreateService/);
assert.match(issueCreateServiceFile, /assertWorkspaceAccess/);
assert.match(issueCreateServiceFile, /createIssue/);
assert.match(issueCreateServiceFile, /addProjectV2ItemByContentId/);
assert.match(issueCreateServiceFile, /updateProjectV2ItemStatus/);
assert.doesNotMatch(issueCreateServiceFile, /FROM pilo_issues/);

assert.match(readQueriesFile, /class BoardReadQueries/);
assert.match(readQueriesFile, /FROM boards b/);
assert.match(readQueriesFile, /FROM board_columns bc/);
assert.match(readQueriesFile, /ORDER BY bc\.position ASC/);
assert.match(readQueriesFile, /FROM pilo_issues/);

assert.match(statusQueriesFile, /class BoardIssueStatusQueries/);
assert.match(statusQueriesFile, /FROM pilo_issues pi/);
assert.match(statusQueriesFile, /JOIN board_columns target_col/);
assert.match(statusQueriesFile, /UPDATE github_project_v2_items/);
assert.match(statusQueriesFile, /UPDATE pilo_issues/);

assert.match(updateQueriesFile, /class BoardIssueUpdateQueries/);
assert.match(updateQueriesFile, /FROM pilo_issues pi/);
assert.match(updateQueriesFile, /JOIN github_repositories gr/);
assert.match(updateQueriesFile, /UPDATE github_issues/);
assert.match(updateQueriesFile, /UPDATE pilo_issues/);

assert.match(createQueriesFile, /class BoardIssueCreateQueries/);
assert.match(createQueriesFile, /FROM boards b/);
assert.match(createQueriesFile, /JOIN board_columns target_col/);
assert.match(createQueriesFile, /INSERT INTO github_issues/);
assert.match(createQueriesFile, /INSERT INTO github_project_v2_items/);
assert.match(createQueriesFile, /INSERT INTO github_project_v2_item_field_values/);
assert.match(createQueriesFile, /INSERT INTO pilo_issues/);

assert.match(githubIssueWriteServiceFile, /class GithubIssueWriteService/);
assert.match(githubIssueWriteServiceFile, /github_access_token_encrypted/);
assert.match(githubIssueWriteServiceFile, /updateRepositoryIssue/);
assert.match(githubIssueWriteServiceFile, /createRepositoryIssue/);
assert.match(githubProjectV2WriteServiceFile, /class GithubProjectV2WriteService/);
assert.match(githubProjectV2WriteServiceFile, /addProjectV2ItemByContentId/);
assert.match(githubAppClientFile, /createRepositoryIssue/);
assert.match(githubAppClientFile, /addProjectV2ItemByContentId/);
assert.match(githubAppClientFile, /addProjectV2ItemById/);

assert.match(hydrationServiceFile, /class BoardHydrationService/);
assert.match(hydrationServiceFile, /assertWorkspaceAccess/);
assert.match(hydrationServiceFile, /github_project_v2_repositories/);
assert.match(hydrationServiceFile, /hydrate_pilo_board_from_github/);
assert.match(hydrationServiceFile, /FROM boards/);

assert.match(dtoIndexFile, /CreateBoardRequest/);
assert.match(dtoIndexFile, /UpdateBoardIssueRequest/);
assert.match(typesIndexFile, /BoardPayload/);
assert.match(typesIndexFile, /UpdateBoardIssuePayload/);

assert.match(readmeFile, /API contract: `docs\/api\/board-api\.md`/);

execFileSync(process.execPath, [tscScript, "-p", "tsconfig.build.json"], {
  cwd: appServerRoot,
  stdio: "inherit"
});

await import("./create-hydrate.test.mjs");
await import("./read.test.mjs");
await import("./issues.test.mjs");
await import("./issue-detail.test.mjs");
await import("./status-update.test.mjs");
await import("./issue-update.test.mjs");
await import("./issue-create.test.mjs");
await import("./contract.test.mjs");
await import("./github-sync-workspace-isolation.test.mjs");
await import("./full-sync-project-items.test.mjs");
await import("./project-v2-repository-links.test.mjs");
await import("./project-item-position-hydration.test.mjs");
