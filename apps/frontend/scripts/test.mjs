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
const canvasClientFacade = await readFile(
  new URL("../src/features/canvas/api/canvas-client.ts", import.meta.url),
  "utf8"
);
const canvasApiClient = await readFile(
  new URL("../src/features/canvas/api/canvas-api-client.ts", import.meta.url),
  "utf8"
);
const canvasMockClient = await readFile(
  new URL("../src/features/canvas/api/canvas-mock-client.ts", import.meta.url),
  "utf8"
);
const canvasNormalizers = await readFile(
  new URL("../src/features/canvas/api/canvas-normalizers.ts", import.meta.url),
  "utf8"
);
const canvasTypes = await readFile(
  new URL("../src/features/canvas/api/canvas-types.ts", import.meta.url),
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
const workspaceLayout = await readFile(
  new URL("../src/app/(workspace)/layout.tsx", import.meta.url),
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
const canvasRuntimeTypes = await readFile(
  new URL(
    "../src/features/canvas/components/engine/runtime/canvas-runtime-types.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasRuntimeUtils = await readFile(
  new URL(
    "../src/features/canvas/components/engine/runtime/canvas-runtime-utils.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasRuntimeHydration = await readFile(
  new URL(
    "../src/features/canvas/components/engine/runtime/useCanvasRuntimeHydration.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasApiLifecycle = await readFile(
  new URL(
    "../src/features/canvas/components/engine/runtime/useCanvasApiLifecycle.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasShapePersistence = await readFile(
  new URL(
    "../src/features/canvas/components/engine/runtime/useCanvasShapePersistence.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasViewSettingPersistence = await readFile(
  new URL(
    "../src/features/canvas/components/engine/runtime/useCanvasViewSettingPersistence.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasViewportQueries = await readFile(
  new URL(
    "../src/features/canvas/components/engine/runtime/useCanvasViewportQueries.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasZoomControls = await readFile(
  new URL(
    "../src/features/canvas/components/engine/runtime/CanvasZoomControls.tsx",
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
const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
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
const piloCanvasArrowBindings = await readFile(
  new URL(
    "../src/features/canvas/components/engine/surface/pilo-canvas-arrow-bindings.ts",
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
const piloCodeBlockShapeUtil = await readFile(
  new URL(
    "../src/features/canvas/components/engine/shapes/code-block/PiloCodeBlockShapeUtil.tsx",
    import.meta.url
  ),
  "utf8"
);
const piloCodeBlockComponent = await readFile(
  new URL(
    "../src/features/canvas/components/engine/shapes/code-block/PiloCodeBlockComponent.tsx",
    import.meta.url
  ),
  "utf8"
);
const piloCodeMirrorEditor = await readFile(
  new URL(
    "../src/features/canvas/components/engine/shapes/code-block/PiloCodeMirrorEditor.tsx",
    import.meta.url
  ),
  "utf8"
);
const piloCodeBlockShapeTypes = await readFile(
  new URL(
    "../src/features/canvas/components/engine/shapes/code-block/PiloCodeBlockShapeTypes.ts",
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
const piloCanvasGroupToolbar = await readFile(
  new URL(
    "../src/features/canvas/components/engine/interactions/PiloCanvasGroupToolbar.tsx",
    import.meta.url
  ),
  "utf8"
);
const routePages = await Promise.all(
  [
    "../src/app/(workspace)/calendar/page.tsx",
    "../src/app/(workspace)/github/page.tsx",
    "../src/app/(workspace)/board/page.tsx",
    "../src/app/(workspace)/pr-review/page.tsx",
    "../src/app/(workspace)/meeting/page.tsx",
    "../src/app/(workspace)/canvas/page.tsx"
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
const deprecatedCanvasTokenEnv = "NEXT_PUBLIC_PILO_" + "ACCESS_TOKEN";

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
assert.match(authSession, /activeWorkspace/);
assert.match(authSession, /refreshSession/);
assert.match(authSession, /role: "owner"/);
assert.match(authSession, /currentState\.status === "ready"/);
assert.match(authApiClient, /role: WorkspaceRole/);
assert.match(authApiClient, /CurrentUserWorkspaceInvitation/);
assert.match(authApiClient, /listCurrentUserWorkspaceInvitations/);
assert.match(authApiClient, /acceptCurrentUserWorkspaceInvitation/);
assert.match(authApiClient, /listWorkspaceInvitations/);
assert.match(authApiClient, /createWorkspaceInvitation/);
assert.match(authApiClient, /revokeWorkspaceInvitation/);
assert.match(authApiClient, /acceptWorkspaceInvitation/);
assert.doesNotMatch(authSession, /createWorkspace\(/);
assert.doesNotMatch(authApiClient, /createWorkspace\(/);
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
assert.match(workspaceLayout, /AuthGate/);
assert.match(workspaceLayout, /MeetingRuntimeProvider/);
assert.doesNotMatch(mainShell, /AuthGate/);
assert.match(mainShell, /HeaderMeetingStatus/);
assert.match(mainShell, /sticky top-0/);
assert.match(mainShell, /<span className="truncate">\{activeFeature\.title\}<\/span>/);
assert.match(mainShell, /peer-data-\[variant=inset\]:!m-0/);
assert.match(mainShell, /peer-data-\[state=collapsed\]:!ml-0/);
assert.match(appSidebar, /useAuthSession/);
assert.match(appSidebar, /useMeetingRuntime/);
assert.match(appSidebar, /leaveActiveMeeting/);
assert.match(appSidebar, /logout/);
assert.match(appSidebar, /ACTIVE_MEETING_LEAVE_FAILED_MESSAGE/);
assert.match(appSidebar, /sessionActionStatus/);
assert.match(
  appSidebar,
  /await meetingRuntime\.leaveActiveMeeting\(\);[\s\S]*await acceptCurrentUserWorkspaceInvitation\(/
);
assert.match(appSidebar, /activeWorkspaceDetail/);
assert.match(appSidebar, /canManageWorkspace/);
assert.match(appSidebar, /pendingInvitationCount/);
assert.match(appSidebar, /handleAcceptCurrentUserInvitation/);
assert.match(appSidebar, /listCurrentUserWorkspaceInvitations/);
assert.match(appSidebar, /acceptCurrentUserWorkspaceInvitation/);
assert.match(appSidebar, /listWorkspaceMembers/);
assert.match(appSidebar, /removeWorkspaceMember/);
assert.match(appSidebar, /handleRemoveWorkspaceMember/);
assert.match(appSidebar, /handleHideInvitation/);
assert.match(appSidebar, /findAcceptedInvitationMember/);
assert.match(appSidebar, /대기중/);
assert.match(appSidebar, /수락됨/);
assert.match(appSidebar, /취소됨/);
assert.match(appSidebar, /만료됨/);
assert.match(appSidebar, /추방/);
assert.match(appSidebar, /AlertDialogContent/);
assert.match(appSidebar, /AlertDialogAction/);
assert.match(appSidebar, /createWorkspaceInvitation/);
assert.match(appSidebar, /listWorkspaceInvitations/);
assert.match(appSidebar, /revokeWorkspaceInvitation/);
assert.match(appSidebar, /AvatarImage/);
assert.match(appSidebar, /avatarUrl: authSession\.user\.avatarUrl/);
assert.match(appSidebar, /src=\{displayUser\.avatarUrl \|\| undefined\}/);
assert.match(appSidebar, /group-data-\[collapsible=icon\]:justify-center/);
assert.match(appSidebar, /group-data-\[collapsible=icon\]:hidden/);
assert.doesNotMatch(appSidebar, /\{item\.description\}/);
assert.match(canvasClientFacade, /const DEFAULT_CANVAS_MODE = "api"/);
assert.match(canvasClientFacade, /createCanvasApiClient\(options\)/);
assert.match(canvasClientFacade, /createMockCanvasClient\(\)/);
assert.match(canvasClientFacade, /resolveCanvasClientMode/);
assert.doesNotMatch(canvasClientFacade, /readCanvasStorage/);
assert.doesNotMatch(canvasClientFacade, /requestCanvasJson/);
assert.match(canvasApiClient, /\/api\/v1/);
assert.match(canvasApiClient, /NEXT_PUBLIC_PILO_APP_SERVER_URL/);
assert.doesNotMatch(canvasApiClient, new RegExp(deprecatedCanvasTokenEnv));
assert.match(canvasApiClient, /Authorization: `Bearer \$\{authToken\}`/);
assert.match(canvasApiClient, /credentials: "same-origin"/);
assert.match(canvasApiClient, /unwrapCanvasApiData/);
assert.match(canvasApiClient, /\/workspaces\/\$\{encodeURIComponent\(workspaceId\)\}\/canvases/);
assert.match(canvasApiClient, /\/shapes`/);
assert.match(canvasApiClient, /listShapesInViewport/);
assert.match(canvasApiClient, /getShapeDetail/);
assert.match(canvasTypes, /signal\?: AbortSignal/);
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
assert.match(canvasMockClient, /readCanvasStorage/);
assert.match(canvasMockClient, /writeCanvasStorage/);
assert.match(canvasMockClient, /createMockCanvasClient/);
assert.match(canvasMockClient, /mock-board-list/);
assert.match(canvasMockClient, /mock-user/);
assert.doesNotMatch(canvasMockClient, /Authorization: `Bearer/);
assert.doesNotMatch(canvasMockClient, /NEXT_PUBLIC_PILO_APP_SERVER_URL/);
assert.doesNotMatch(canvasMockClient, /requestCanvasJson/);
assert.match(canvasNormalizers, /createMockCanvasBoardDetail/);
assert.match(canvasNormalizers, /normalizeCanvasBoardDetail/);
assert.match(canvasNormalizers, /unwrapCanvasApiData/);
assert.match(canvasNormalizers, /normalizeCanvasShapes/);
assert.match(canvasRuntime, /@tanstack\/react-query/);
assert.match(canvasRuntime, /QueryClientProvider/);
assert.match(canvasRuntime, /viewportShapeLoadRequestSeqRef/);
assert.match(canvasRuntime, /shapeDetailRequestSeqRef/);
assert.match(canvasRuntime, /pendingLocalShapeVersionsRef/);
assert.match(canvasRuntime, /useCanvasRuntimeHydration/);
assert.match(canvasRuntime, /useCanvasApiLifecycle/);
assert.match(canvasRuntime, /useCanvasShapePersistence/);
assert.match(canvasRuntime, /useCanvasViewSettingPersistence/);
assert.match(canvasRuntime, /useCanvasViewportQueries/);
assert.match(canvasRuntime, /<CanvasZoomControls/);
assert.match(canvasRuntimeTypes, /CanvasViewSettingApiClient/);
assert.match(canvasRuntimeUtils, /hasCanvasFreeformShapeChanged/);
assert.match(canvasRuntimeUtils, /getChangedFreeformShapeIds/);
assert.match(canvasRuntimeHydration, /readCanvasStorage\("freeform-shapes"/);
assert.match(canvasRuntimeHydration, /readCanvasStorage\("view-setting"/);
assert.match(canvasApiLifecycle, /createCanvasShapeSyncQueue/);
assert.match(canvasApiLifecycle, /queryClient\s*\.\s*invalidateQueries/);
assert.match(canvasApiLifecycle, /enterCanvas/);
assert.match(canvasApiLifecycle, /leaveCanvas/);
assert.match(canvasApiLifecycle, /shapeSyncQueue\.flush/);
assert.match(canvasShapePersistence, /syncCanvasFreeformShapes/);
assert.match(canvasShapePersistence, /shapeSyncQueue\.enqueue/);
assert.match(canvasShapePersistence, /areCanvasFreeformShapesEqual/);
assert.match(canvasRuntime, /captureDraftFreeformShapes/);
assert.match(canvasShapePersistence, /shapeDetailCacheRef\.current\.set\(shapeId, nextShape\)/);
assert.match(canvasShapePersistence, /pendingLocalShapeVersionsRef\.current\.has\(shapeId\)/);
assert.match(canvasShapePersistence, /shapeSyncQueue\s*\.\s*whenIdle\(\)/);
assert.match(canvasViewportQueries, /queryClient\s*\.\s*fetchQuery/);
assert.match(canvasViewportQueries, /queryClient\s*\.\s*cancelQueries/);
assert.match(canvasViewportQueries, /listShapesInViewport/);
assert.match(canvasViewportQueries, /getShapeDetail/);
assert.match(canvasViewportQueries, /CANVAS_SHAPE_DETAIL_MIN_ZOOM/);
assert.match(canvasRuntimeUtils, /DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN/);
assert.match(canvasViewSettingPersistence, /storageMode === "api"/);
assert.match(canvasViewSettingPersistence, /updateViewSetting/);
assert.match(canvasShapePersistence, /writeCanvasStorage\("freeform-shapes"/);
assert.match(canvasViewSettingPersistence, /writeCanvasStorage\("view-setting"/);
assert.match(canvasRuntime, /onSnapStateChange/);
assert.match(canvasRuntime, /canvasSnapState\.isSmartGuideEnabled/);
assert.match(canvasRuntime, /setSmartGuidesEnabled/);
assert.match(canvasZoomControls, /aria-label="스마트가이드"/);
assert.match(canvasZoomControls, /<Magnet/);
assert.match(canvasZoomControls, /aria-label="스마트가이드"[\s\S]*aria-label="축소"[\s\S]*<strong>/);
assert.match(canvasWorkspace, /useAuthSession/);
assert.match(canvasWorkspace, /authSession\?\.activeWorkspaceId/);
assert.match(canvasWorkspace, /authToken: authSession\?\.accessToken/);
assert.match(canvasWorkspace, /createBoard\(workspaceId/);
assert.doesNotMatch(canvasWorkspace, /NEXT_PUBLIC_PILO_WORKSPACE_ID/);
assert.doesNotMatch(canvasWorkspace, /getCanvasWorkspaceId/);
assert.match(canvasWorkspace, /const shouldUseCanvasApi =/);
assert.match(canvasWorkspace, /boardState.status === "ready"/);
assert.match(canvasWorkspace, /boardState.board !== null/);
assert.match(canvasWorkspace, /canvasHistoryState\.canUndo/);
assert.match(canvasWorkspace, /canvasHistoryState\.canRedo/);
assert.match(canvasWorkspace, /onHistoryStateChange=\{setCanvasHistoryState\}/);
assert.match(canvasWorkspace, /label="더보기"/);
assert.match(canvasWorkspace, /aria-label="더보기 도구"/);
assert.doesNotMatch(canvasWorkspace, /label="삽입"/);
assert.doesNotMatch(canvasWorkspace, /label="스마트가이드"/);
assert.match(canvasWorkspace, /canvasClient=\{shouldUseCanvasApi \? canvasClient : null\}/);
assert.match(canvasWorkspace, /storageMode=\{shouldUseCanvasApi \? "api" : "local"\}/);
assert.match(canvasShapeSync, /buildCanvasShapeSyncOperations/);
assert.match(canvasShapeSync, /createCanvasShapeSyncQueue/);
assert.match(canvasShapeSync, /DEFAULT_CANVAS_SHAPE_SYNC_QUEUE_DEBOUNCE_MS = 500/);
assert.match(canvasShapeSync, /DEFAULT_CANVAS_SHAPE_SYNC_RETRY_ATTEMPTS = 3/);
assert.match(canvasShapeSync, /CanvasShapeSyncFailure/);
assert.match(canvasShapeSync, /runWithRetry/);
assert.match(canvasShapeSync, /import diff from "microdiff"/);
assert.match(canvasShapeSync, /import PQueue from "p-queue"/);
assert.match(canvasShapeSync, /import pRetry from "p-retry"/);
assert.match(canvasShapeSync, /new PQueue\(\{ concurrency: 1 \}\)/);
assert.match(canvasShapeSync, /pRetry/);
assert.match(canvasShapeSync, /hasCanvasFreeformShapeChanged/);
assert.match(canvasShapeSync, /areCanvasFreeformShapesEqual/);
assert.match(canvasShapeSync, /mergeQueuedCanvasShapeSyncOperation/);
assert.match(canvasShapeSync, /queuedDuringFlush/);
assert.match(canvasShapeSync, /whenIdle: \(\) => Promise<void>/);
assert.match(canvasShapeSync, /resolveIdleWaiters/);
assert.match(canvasShapeSync, /syncShapesBatch/);
assert.match(canvasShapeSync, /createShape\(boardId, operation.payload/);
assert.match(canvasShapeSync, /updateShape\(operation.shapeId, operation.payload/);
assert.match(canvasShapeSync, /deleteShape\(operation.shapeId/);
assert.match(canvasShapeSync, /id: typeof shape.id === "string" \? shape.id : ""/);
assert.match(canvasShapeSync, /shapeType: typeof shape.type === "string" \? shape.type : ""/);
assert.match(canvasShapeSync, /x: readFiniteNumber\(shape.x, 0\)/);
assert.match(canvasShapeSync, /y: readFiniteNumber\(shape.y, 0\)/);
assert.match(canvasShapeSync, /rawShape: cloneRawShape\(shape\)/);
assert.match(packageJson, /"@tanstack\/react-query"/);
assert.match(packageJson, /"p-queue"/);
assert.match(packageJson, /"p-retry"/);
assert.match(packageJson, /"microdiff"/);
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
assert.match(piloTldrawCanvas, /CanvasHistoryStateReporter/);
assert.match(piloTldrawCanvas, /editor\.getCanUndo/);
assert.match(piloTldrawCanvas, /editor\.getCanRedo/);
assert.match(piloTldrawCanvas, /PiloCanvasSnapState/);
assert.match(piloTldrawCanvas, /CanvasSnapStateReporter/);
assert.match(piloTldrawCanvas, /editor\.user\.getIsSnapMode/);
assert.match(piloTldrawCanvas, /editor\.user\.updateUserPreferences/);
assert.match(piloTldrawCanvas, /history: "ignore"/);
assert.match(piloTldrawCanvas, /SelectedGroupToolbar/);
assert.doesNotMatch(piloTldrawCanvas, /PiloCanvasSmartGuides/);
assert.doesNotMatch(piloTldrawCanvas, /applyPiloSmartSnap/);
assert.doesNotMatch(piloTldrawCanvas, /SmartGuidesOverlay/);
assert.match(piloTldrawCanvas, /cameraRestoreVersion/);
assert.match(piloTldrawCanvas, /resetFreeformShapes\(/);
assert.match(piloTldrawCanvas, /freeformShapesRef\.current/);
assert.match(piloTldrawCanvas, /pendingArrowBindingsRef/);
assert.match(piloTldrawCanvas, /piloDefaultArrowKindHydrationGuardRef/);
assert.match(piloTldrawCanvas, /readSerializedArrowBindings/);
assert.match(piloTldrawCanvas, /restoreSerializedArrowBindings/);
assert.match(piloTldrawCanvas, /uniquePendingArrowBindings/);
assert.match(piloTldrawCanvas, /shape\.props\.kind !== "elbow"/);
assert.match(piloTldrawCanvas, /kind: "elbow"/);
assert.match(piloTldrawCanvas, /editor\.createShapes\(sortFreeformShapesForCreate\(shapes\)\)/);
assert.match(piloTldrawCanvas, /onShapeDetailRequest/);
assert.match(piloTldrawCanvas, /onViewportBoundsChange/);
assert.match(piloTldrawCanvas, /placePiloCanvasShapeAt/);
assert.doesNotMatch(piloTldrawCanvas, /createCanvasShapeSyncQueue/);
assert.doesNotMatch(piloTldrawCanvas, /writeCanvasStorage\(/);
assert.match(piloCanvasStateReporter, /onFreeformShapesChange/);
assert.match(piloCanvasStateReporter, /onFreeformShapesDraftChange/);
assert.match(piloCanvasStateReporter, /onViewChange/);
assert.match(piloCanvasStateReporter, /getViewportPageBounds/);
assert.match(piloCanvasStateReporter, /withSerializedArrowBindings/);
assert.match(piloCanvasArrowBindings, /piloArrowBindingsV1/);
assert.match(piloCanvasArrowBindings, /getBindingsInvolvingShape\(shape\.id, "arrow"\)/);
assert.match(piloCanvasArrowBindings, /editor\.createBindings/);
assert.match(piloCanvasArrowBindings, /pending/);
assert.doesNotMatch(piloCanvasArrowBindings, /fetch\(/);
assert.doesNotMatch(piloCanvasArrowBindings, /src\/shared\/tldraw/);
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
assert.match(piloCodeBlockShapeUtil, /BaseFrameLikeShapeUtil/);
assert.doesNotMatch(piloCodeBlockShapeUtil, /@codemirror/);
assert.doesNotMatch(piloCodeBlockShapeUtil, /navigator\.clipboard/);
assert.match(piloCodeBlockComponent, /PiloCodeMirrorEditor/);
assert.match(piloCodeMirrorEditor, /@codemirror\/view/);
assert.match(piloCodeBlockShapeTypes, /export type PiloCodeBlockShape/);
assert.match(piloCanvasPlacement, /PiloPlacementRequest/);
assert.match(piloCanvasPlacement, /placePiloCanvasShapeAt/);
assert.match(piloCanvasGroupToolbar, /shape\.type === "group"/);
assert.match(piloCanvasGroupToolbar, /editor\.ungroupShapes/);
assert.match(piloCanvasGroupToolbar, /LockOpen/);
assert.match(routes, /as default/);
assert.doesNotMatch(routes, /MainShell/);
assert.match(pages, /MainShell/);
assert.match(pages, /Panel/);

await import("./calendar/test.mjs");
await import("./meeting/test.mjs");
await import("./pr-review/test.mjs");
