import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const appModule = await readSource("../../src/app.module.ts");
const rootTest = await readSource("../test.mjs");
const moduleFile = await readSource("../../src/modules/board/board.module.ts");
const controllerFile = await readSource(
  "../../src/modules/board/board.controller.ts"
);
const serviceFile = await readSource("../../src/modules/board/board.service.ts");
const readmeFile = await readSource("../../src/modules/board/README.md");

assert.match(appModule, /import \{ BoardModule \}/);
assert.match(appModule, /imports: \[[\s\S]*BoardModule[\s\S]*\]/);

assert.match(rootTest, /import\("\.\/board\/test\.mjs"\)/);

assert.match(moduleFile, /imports: \[[\s\S]*CommonModule[\s\S]*\]/);
assert.match(moduleFile, /imports: \[[\s\S]*DatabaseModule[\s\S]*\]/);
assert.match(moduleFile, /imports: \[[\s\S]*WorkspaceModule[\s\S]*\]/);
assert.match(moduleFile, /controllers: \[BoardController\]/);
assert.match(moduleFile, /providers: \[BoardService\]/);
assert.match(moduleFile, /exports: \[BoardService\]/);

assert.match(controllerFile, /@Controller\("workspaces\/:workspaceId\/boards"\)/);
assert.match(controllerFile, /@UseGuards\(AuthGuard\)/);
assert.doesNotMatch(controllerFile, /@Get\(/);
assert.doesNotMatch(controllerFile, /@Post\(/);
assert.doesNotMatch(controllerFile, /apiResponse/);

assert.match(serviceFile, /getModuleInfo\(\): BoardModuleInfo/);
assert.match(serviceFile, /domain: "board"/);
assert.match(serviceFile, /apiContract: "docs\/api\/board-api\.md"/);

assert.match(readmeFile, /API contract: `docs\/api\/board-api\.md`/);
