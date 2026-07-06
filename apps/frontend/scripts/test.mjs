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
    "../src/features/canvas/components/engine/runtime/PiloCanvasRuntime.tsx",
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
const tldrawSurface = await readFile(
  new URL("../src/shared/tldraw/TldrawSurface.tsx", import.meta.url),
  "utf8"
);
const piloTldrawCanvas = await readFile(
  new URL(
    "../src/features/canvas/components/engine/surface/PiloTldrawCanvas.tsx",
    import.meta.url
  ),
  "utf8"
);
const piloCanvasStateReporter = await readFile(
  new URL(
    "../src/features/canvas/components/engine/surface/pilo-canvas-state-reporter.tsx",
    import.meta.url
  ),
  "utf8"
);
const piloCanvasTypes = await readFile(
  new URL("../src/features/canvas/components/engine/types.ts", import.meta.url),
  "utf8"
);
const piloCanvasAssets = await readFile(
  new URL(
    "../src/features/canvas/components/engine/assets/pilo-canvas-assets.ts",
    import.meta.url
  ),
  "utf8"
);
const piloCanvasShapeFactory = await readFile(
  new URL(
    "../src/features/canvas/components/engine/shapes/pilo-canvas-shape-factory.ts",
    import.meta.url
  ),
  "utf8"
);
const piloCanvasShapeUtils = await readFile(
  new URL(
    "../src/features/canvas/components/engine/shapes/pilo-canvas-shape-utils.ts",
    import.meta.url
  ),
  "utf8"
);
const piloFrameShapeUtil = await readFile(
  new URL(
    "../src/features/canvas/components/engine/shapes/frame/PiloFrameShapeUtil.ts",
    import.meta.url
  ),
  "utf8"
);
const piloFrameSelectionToolbar = await readFile(
  new URL(
    "../src/features/canvas/components/engine/shapes/frame/PiloFrameSelectionToolbar.tsx",
    import.meta.url
  ),
  "utf8"
);
const piloCanvasPlacement = await readFile(
  new URL(
    "../src/features/canvas/components/engine/interactions/pilo-canvas-placement.ts",
    import.meta.url
  ),
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
assert.match(authSessionStorage, /PILO_DEV_PREVIEW_ACCESS_TOKEN/);
assert.match(authSessionStorage, /PILO_DEV_PREVIEW_WORKSPACE_ID/);
assert.match(authSessionStorage, /isDevPreviewEnabled/);
assert.match(authSessionStorage, /NEXT_PUBLIC_PILO_ENABLE_UI_PREVIEW/);
assert.match(authSession, /AuthGate/);
assert.match(authSession, /router\.replace\(`\/login\?returnUrl=/);
assert.match(authSession, /Default workspace was not initialized during login/);
assert.match(authSession, /isDevPreviewAccessToken/);
assert.match(authSession, /PILO UI Preview/);
assert.doesNotMatch(authSession, /createWorkspace/);
assert.doesNotMatch(authApiClient, /createWorkspace/);
assert.match(loginPage, /Welcome back/);
assert.match(loginPage, /Login with GitHub/);
assert.match(loginPage, /Login with Google/);
assert.match(loginPage, /devPreview/);
assert.match(loginPage, /UI Preview/);
assert.match(loginPage, /saveDevPreviewAuthSession/);
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
assert.match(canvasApiClient, /listShapesInViewport/);
assert.match(canvasApiClient, /getShapeDetail/);
assert.match(canvasApiClient, /enterCanvas/);
assert.match(canvasApiClient, /leaveCanvas/);
assert.match(canvasApiClient, /syncShapesBatch/);
assert.match(canvasApiClient, /\/enter`/);
assert.match(canvasApiClient, /\/leave`/);
assert.match(canvasApiClient, /\/shapes\/batch`/);
assert.match(canvasApiClient, /URLSearchParams/);
assert.match(canvasApiClient, /method: "POST"/);
assert.match(canvasApiClient, /method: "PATCH"/);
assert.match(canvasApiClient, /method: "DELETE"/);
assert.match(canvasRuntime, /syncCanvasFreeformShapes/);
assert.match(canvasRuntime, /createCanvasShapeSyncQueue/);
assert.match(canvasRuntime, /shapeSyncQueue\.enqueue/);
assert.match(canvasRuntime, /listShapesInViewport/);
assert.match(canvasRuntime, /getShapeDetail/);
assert.match(canvasRuntime, /enterCanvas/);
assert.match(canvasRuntime, /leaveCanvas/);
assert.match(canvasRuntime, /shapeSyncQueue\.flush/);
assert.match(canvasRuntime, /CANVAS_SHAPE_DETAIL_MIN_ZOOM/);
assert.match(canvasRuntime, /DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN/);
assert.match(canvasRuntime, /storageMode === "api"/);
assert.match(canvasRuntime, /writeCanvasStorage\("freeform-shapes"/);
assert.match(canvasRuntime, /updateViewSetting/);
assert.match(canvasRuntime, /writeCanvasStorage\("view-setting"/);
assert.match(canvasWorkspace, /useAuthSession/);
assert.match(canvasWorkspace, /authSession\?\.activeWorkspaceId/);
assert.match(canvasWorkspace, /authToken: authSession\?\.accessToken/);
assert.match(canvasWorkspace, /createBoard\(workspaceId/);
assert.doesNotMatch(canvasWorkspace, /NEXT_PUBLIC_PILO_WORKSPACE_ID/);
assert.doesNotMatch(canvasWorkspace, /getCanvasWorkspaceId/);
assert.match(canvasWorkspace, /const shouldUseCanvasApi =/);
assert.match(canvasWorkspace, /boardState.status === "ready"/);
assert.match(canvasWorkspace, /boardState.board !== null/);
assert.match(canvasWorkspace, /canvasClient=\{shouldUseCanvasApi \? canvasClient : null\}/);
assert.match(canvasWorkspace, /storageMode=\{shouldUseCanvasApi \? "api" : "local"\}/);
assert.match(canvasShapeSync, /buildCanvasShapeSyncOperations/);
assert.match(canvasShapeSync, /createCanvasShapeSyncQueue/);
assert.match(canvasShapeSync, /DEFAULT_CANVAS_SHAPE_SYNC_QUEUE_DEBOUNCE_MS = 500/);
assert.match(canvasShapeSync, /mergeQueuedCanvasShapeSyncOperation/);
assert.match(canvasShapeSync, /syncShapesBatch/);
assert.match(canvasShapeSync, /createShape\(boardId, operation.payload/);
assert.match(canvasShapeSync, /updateShape\(operation.shapeId, operation.payload/);
assert.match(canvasShapeSync, /deleteShape\(operation.shapeId/);
assert.match(canvasShapeSync, /id: typeof shape.id === "string" \? shape.id : ""/);
assert.match(canvasShapeSync, /shapeType: typeof shape.type === "string" \? shape.type : ""/);
assert.match(canvasShapeSync, /x: readFiniteNumber\(shape.x, 0\)/);
assert.match(canvasShapeSync, /y: readFiniteNumber\(shape.y, 0\)/);
assert.match(canvasShapeSync, /rawShape: cloneRawShape\(shape\)/);
assert.match(tldrawSurface, /export function TldrawSurface/);
assert.match(tldrawSurface, /shapeUtils=\{shapeUtils\}/);
assert.match(tldrawSurface, /onMount=\{onMount\}/);
assert.doesNotMatch(tldrawSurface, /createCanvasShapeSyncQueue/);
assert.doesNotMatch(tldrawSurface, /writeCanvasStorage/);
assert.match(piloTldrawCanvas, /TldrawSurface/);
assert.match(piloTldrawCanvas, /piloCanvasShapeUtils/);
assert.match(piloTldrawCanvas, /CanvasStateReporter/);
assert.match(piloTldrawCanvas, /initialViewSetting/);
assert.match(piloTldrawCanvas, /editor\.setCamera/);
assert.match(piloTldrawCanvas, /cameraRestoreVersion/);
assert.match(piloTldrawCanvas, /resetFreeformShapes\(editor, freeformShapesRef\.current\)/);
assert.match(piloTldrawCanvas, /onShapeDetailRequest/);
assert.match(piloTldrawCanvas, /onViewportBoundsChange/);
assert.match(piloTldrawCanvas, /placePiloCanvasShapeAt/);
assert.doesNotMatch(piloTldrawCanvas, /createCanvasShapeSyncQueue/);
assert.doesNotMatch(piloTldrawCanvas, /writeCanvasStorage\(/);
assert.match(piloCanvasStateReporter, /onFreeformShapesChange/);
assert.match(piloCanvasStateReporter, /onViewChange/);
assert.match(piloCanvasStateReporter, /getViewportPageBounds/);
assert.match(piloCanvasTypes, /export type PiloCanvasFreeformShape/);
assert.match(piloCanvasTypes, /export type PiloCanvasViewSetting/);
assert.match(piloCanvasTypes, /export type PiloCanvasViewportBounds/);
assert.match(piloCanvasTypes, /export type PiloCanvasShapeDetailRequest/);
assert.doesNotMatch(piloCanvasAssets, /surface\/pilo-canvas-state-reporter/);
assert.match(piloCanvasShapeFactory, /createStickyNoteShape/);
assert.match(piloCanvasShapeFactory, /createCodeBlockShape/);
assert.match(piloCanvasShapeFactory, /createInsertableShape/);
assert.doesNotMatch(
  piloCanvasShapeFactory,
  /surface\/pilo-canvas-state-reporter/
);
assert.match(piloCanvasShapeUtils, /frame\/PiloFrameShapeUtil/);
assert.doesNotMatch(piloCanvasShapeUtils, /frame\/PiloFrameSelectionToolbar/);
assert.match(piloFrameShapeUtil, /FrameShapeUtil\.configure/);
assert.match(piloFrameShapeUtil, /resolveNextFrameName/);
assert.doesNotMatch(piloFrameSelectionToolbar, /FrameShapeUtil\.configure/);
assert.match(piloCanvasPlacement, /PiloPlacementRequest/);
assert.match(piloCanvasPlacement, /placePiloCanvasShapeAt/);
assert.match(routes, /as default/);
assert.doesNotMatch(routes, /MainShell/);
assert.match(pages, /MainShell/);
assert.match(pages, /Panel/);

await import("./calendar/test.mjs");
