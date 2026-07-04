import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const controller = await readSource("../src/app.controller.ts");
const main = await readSource("../src/main.ts");
const service = await readSource("../src/app.service.ts");
const appModule = await readSource("../src/app.module.ts");
const userController = await readSource("../src/modules/user/user.controller.ts");
const workspaceController = await readSource(
  "../src/modules/workspace/workspace.controller.ts"
);
const workspaceService = await readSource("../src/modules/workspace/workspace.service.ts");

assert.match(main, /setGlobalPrefix\("api\/v1"\)/);
assert.match(controller, /@Get\("health"\)/);
assert.match(service, /pilo-app-server/);
assert.match(service, /status: "ok"/);
assert.match(appModule, /UserModule/);
assert.match(appModule, /WorkspaceModule/);
assert.match(userController, /@Controller\("me"\)/);
assert.match(userController, /@UseGuards\(AuthGuard\)/);
assert.match(workspaceController, /@Controller\("workspaces"\)/);
assert.match(workspaceController, /@Get\(\)/);
assert.match(workspaceController, /@Post\(\)/);
assert.match(workspaceController, /@Get\(":workspaceId"\)/);
assert.match(workspaceService, /WHERE owner_user_id = \$1/);
assert.match(workspaceService, /ORDER BY created_at ASC/);
assert.match(workspaceService, /assertWorkspaceAccess/);
