import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const navigationFiles = await Promise.all(
  [
    "../src/features/calendar/navigation.ts",
    "../src/features/github-integration/navigation.ts",
    "../src/features/board/navigation.ts",
    "../src/features/pr-review/navigation.ts",
    "../src/features/meeting/navigation.ts",
    "../src/features/canvas/navigation.ts"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8"))
);
const githubApiClient = await readFile(
  new URL("../src/features/github-integration/api/client.ts", import.meta.url),
  "utf8"
);
const canvasApiClient = await readFile(
  new URL("../src/features/canvas/api/canvas-client.ts", import.meta.url),
  "utf8"
);
const authApiClient = await readFile(
  new URL("../src/features/auth/api/client.ts", import.meta.url),
  "utf8"
);
const authSession = await readFile(
  new URL("../src/features/auth/auth-session.tsx", import.meta.url),
  "utf8"
);
const authSessionStorage = await readFile(
  new URL("../src/features/auth/session-storage.ts", import.meta.url),
  "utf8"
);
const loginPage = await readFile(
  new URL("../src/features/auth/components/login-page.tsx", import.meta.url),
  "utf8"
);
const loginCallbackPage = await readFile(
  new URL("../src/features/auth/components/login-callback-page.tsx", import.meta.url),
  "utf8"
);
const mainShell = await readFile(
  new URL("../src/components/main-shell.tsx", import.meta.url),
  "utf8"
);
const appSidebar = await readFile(
  new URL("../src/components/app-sidebar.tsx", import.meta.url),
  "utf8"
);
const canvasRuntime = await readFile(
  new URL(
    "../src/features/canvas/components/engine/PiloCanvasRuntime.tsx",
    import.meta.url
  ),
  "utf8"
);
const canvasWorkspace = await readFile(
  new URL("../src/features/canvas/components/workspace-canvas.tsx", import.meta.url),
  "utf8"
);
const canvasShapeSync = await readFile(
  new URL("../src/features/canvas/utils/canvas-shape-sync.ts", import.meta.url),
  "utf8"
);
const routePages = await Promise.all(
  [
    "../src/app/calendar/page.tsx",
    "../src/app/github/page.tsx",
    "../src/app/board/page.tsx",
    "../src/app/pr-review/page.tsx",
    "../src/app/meeting/page.tsx",
    "../src/app/canvas/page.tsx"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8"))
);
const featurePages = await Promise.all(
  [
    "../src/features/calendar/page.tsx",
    "../src/features/github-integration/page.tsx",
    "../src/features/board/page.tsx",
    "../src/features/pr-review/page.tsx",
    "../src/features/meeting/page.tsx",
    "../src/features/canvas/page.tsx"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8"))
);
const navigation = navigationFiles.join("\n");
const routes = routePages.join("\n");
const pages = featurePages.join("\n");

assert.match(navigation, /Calendar/);
assert.match(navigation, /GitHub sync/);
assert.match(navigation, /Board/);
assert.match(navigation, /PR review/);
assert.match(navigation, /Voice meeting/);
assert.match(navigation, /Canvas/);
assert.match(githubApiClient, /\/api\/v1/);
assert.match(githubApiClient, /NEXT_PUBLIC_PILO_APP_SERVER_URL/);
assert.match(authApiClient, /\/auth\/\$\{provider\}\/start/);
assert.match(authApiClient, /\/auth\/logout/);
assert.match(authApiClient, /\/workspaces/);
assert.match(authApiClient, /NEXT_PUBLIC_PILO_APP_SERVER_URL/);
assert.match(authSessionStorage, /pilo:access-token/);
assert.match(authSessionStorage, /pilo:workspace-id/);
assert.match(authSession, /AuthGate/);
assert.match(authSession, /router\.replace\(`\/login\?returnUrl=/);
assert.match(authSession, /createWorkspace\(accessToken, "PILO"\)/);
assert.match(loginPage, /Welcome back/);
assert.match(loginPage, /Login with GitHub/);
assert.match(loginPage, /Login with Google/);
assert.doesNotMatch(loginPage, /Or continue with/);
assert.doesNotMatch(loginPage, /Forgot your password/);
assert.match(loginCallbackPage, /access_token/);
assert.match(loginCallbackPage, /loadAuthSessionEntry/);
assert.match(mainShell, /AuthGate/);
assert.match(appSidebar, /useAuthSession/);
assert.match(appSidebar, /logout/);
assert.match(canvasApiClient, /const DEFAULT_CANVAS_MODE = "api"/);
assert.match(canvasApiClient, /\/api\/v1/);
assert.match(canvasApiClient, /NEXT_PUBLIC_PILO_APP_SERVER_URL/);
assert.match(canvasApiClient, /Authorization: `Bearer \$\{authToken\}`/);
assert.match(canvasApiClient, /credentials: "same-origin"/);
assert.match(canvasApiClient, /unwrapCanvasApiData/);
assert.match(canvasApiClient, /\/workspaces\/\$\{encodeURIComponent\(workspaceId\)\}\/canvases/);
assert.match(canvasApiClient, /\/shapes`/);
assert.match(canvasApiClient, /method: "POST"/);
assert.match(canvasApiClient, /method: "PATCH"/);
assert.match(canvasApiClient, /method: "DELETE"/);
assert.match(canvasRuntime, /syncCanvasFreeformShapes/);
assert.match(canvasRuntime, /createCanvasShapeSyncQueue/);
assert.match(canvasRuntime, /shapeSyncQueue\.enqueue/);
assert.match(canvasRuntime, /storageMode === "api"/);
assert.match(canvasRuntime, /writeCanvasStorage\("freeform-shapes"/);
assert.doesNotMatch(canvasRuntime, /view-setting/);
assert.match(canvasWorkspace, /createCanvasClient\(\{ mode: canvasClientMode \}\)/);
assert.match(canvasWorkspace, /createBoard\(workspaceId/);
assert.match(canvasWorkspace, /storageMode=\{boardState.source === "api" \? "api" : "local"\}/);
assert.match(canvasShapeSync, /buildCanvasShapeSyncOperations/);
assert.match(canvasShapeSync, /createCanvasShapeSyncQueue/);
assert.match(canvasShapeSync, /DEFAULT_CANVAS_SHAPE_SYNC_QUEUE_DEBOUNCE_MS = 360/);
assert.match(canvasShapeSync, /mergeQueuedCanvasShapeSyncOperation/);
assert.match(canvasShapeSync, /createShape\(boardId, operation.payload/);
assert.match(canvasShapeSync, /updateShape\(operation.shapeId, operation.payload/);
assert.match(canvasShapeSync, /deleteShape\(operation.shapeId/);
assert.match(canvasShapeSync, /id: typeof shape.id === "string" \? shape.id : ""/);
assert.match(canvasShapeSync, /shapeType: typeof shape.type === "string" \? shape.type : ""/);
assert.match(canvasShapeSync, /x: readFiniteNumber\(shape.x, 0\)/);
assert.match(canvasShapeSync, /y: readFiniteNumber\(shape.y, 0\)/);
assert.match(canvasShapeSync, /rawShape: cloneRawShape\(shape\)/);
assert.match(routes, /as default/);
assert.doesNotMatch(routes, /MainShell/);
assert.match(pages, /MainShell/);
assert.match(pages, /Panel/);

await import("./calendar/test.mjs");
