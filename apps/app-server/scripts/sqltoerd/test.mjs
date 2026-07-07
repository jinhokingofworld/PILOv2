import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const appModule = await readSource("../../src/app.module.ts");
const sqlErdModule = await readSource(
  "../../src/modules/sql-erd/sql-erd.module.ts"
);
const sqlErdController = await readSource(
  "../../src/modules/sql-erd/sql-erd.controller.ts"
);
const sqlErdService = await readSource(
  "../../src/modules/sql-erd/sql-erd.service.ts"
);
const sqlErdTypes = await readSource(
  "../../src/modules/sql-erd/sql-erd.types.ts"
);
const sqlErdValidation = await readSource(
  "../../src/modules/sql-erd/sql-erd.validation.ts"
);
const sqlErdMapper = await readSource(
  "../../src/modules/sql-erd/sql-erd.mapper.ts"
);

assert.match(appModule, /SqlErdModule/);
assert.match(sqlErdModule, /controllers: \[SqlErdSessionController\]/);
assert.match(sqlErdModule, /providers: \[SqlErdService\]/);
assert.match(sqlErdModule, /WorkspaceModule/);
assert.match(sqlErdController, /@Controller\("workspaces\/:workspaceId"\)/);
assert.match(sqlErdController, /@UseGuards\(AuthGuard\)/);
assert.match(sqlErdController, /@Get\("sql-erd-session"\)/);
assert.match(sqlErdController, /@Post\("sql-erd-session"\)/);
assert.match(sqlErdController, /@Patch\("sql-erd-session\/:sessionId"\)/);
assert.match(sqlErdController, /@Delete\("sql-erd-session\/:sessionId"\)/);
assert.equal(sqlErdController.match(/@RouteConfig/g)?.length, 2);
assert.equal(sqlErdController.match(/bodyLimit/g)?.length, 2);
assert.match(sqlErdTypes, /SQL_ERD_REQUEST_BODY_LIMIT_BYTES = 2 \* 1024 \* 1024/);
assert.match(sqlErdService, /domain: "sqltoerd"/);
assert.match(sqlErdService, /apiContract: "docs\/api\/sqltoerd-api.md"/);
assert.match(sqlErdService, /assertWorkspaceAccess/);
assert.match(sqlErdValidation, /validateSqlErdSessionId/);
assert.match(sqlErdMapper, /mapSqlErdSession/);
