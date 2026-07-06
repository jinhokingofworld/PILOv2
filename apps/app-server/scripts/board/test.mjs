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
const readQueriesFile = await readSource(
  "../../src/modules/board/queries/board-read.queries.ts"
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
assert.match(moduleFile, /controllers: \[BoardController\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardService[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardHydrationService[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardReadService[\s\S]*\]/);
assert.match(moduleFile, /providers: \[[\s\S]*BoardReadQueries[\s\S]*\]/);
assert.match(moduleFile, /exports: \[BoardService\]/);

assert.match(controllerFile, /@Controller\("workspaces\/:workspaceId\/boards"\)/);
assert.match(controllerFile, /@UseGuards\(AuthGuard\)/);
assert.match(controllerFile, /constructor\(private readonly boardService: BoardService\)/);
assert.match(controllerFile, /@Post\(\)/);
assert.match(controllerFile, /@Get\(\)/);
assert.match(controllerFile, /@Get\(":boardId"\)/);
assert.match(controllerFile, /@Get\(":boardId\/columns"\)/);
assert.match(controllerFile, /@Get\(":boardId\/issues"\)/);
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

assert.match(readServiceFile, /class BoardReadService/);
assert.match(readServiceFile, /assertWorkspaceAccess/);
assert.match(readServiceFile, /BoardReadQueries/);
assert.doesNotMatch(readServiceFile, /FROM boards b/);
assert.doesNotMatch(readServiceFile, /FROM board_columns bc/);
assert.doesNotMatch(readServiceFile, /FROM pilo_issues/);

assert.match(readQueriesFile, /class BoardReadQueries/);
assert.match(readQueriesFile, /FROM boards b/);
assert.match(readQueriesFile, /FROM board_columns bc/);
assert.match(readQueriesFile, /ORDER BY bc\.position ASC/);
assert.match(readQueriesFile, /FROM pilo_issues/);

assert.match(hydrationServiceFile, /class BoardHydrationService/);
assert.match(hydrationServiceFile, /assertWorkspaceAccess/);
assert.match(hydrationServiceFile, /github_project_v2_repositories/);
assert.match(hydrationServiceFile, /hydrate_pilo_board_from_github/);
assert.match(hydrationServiceFile, /FROM boards/);

assert.match(dtoIndexFile, /CreateBoardRequest/);
assert.match(typesIndexFile, /BoardPayload/);

assert.match(readmeFile, /API contract: `docs\/api\/board-api\.md`/);

execFileSync(process.execPath, [tscScript, "-p", "tsconfig.build.json"], {
  cwd: appServerRoot,
  stdio: "inherit"
});

await import("./create-hydrate.test.mjs");
await import("./read.test.mjs");
await import("./issues.test.mjs");
