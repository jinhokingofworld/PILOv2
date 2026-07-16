import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const navigationFiles = await Promise.all(
  [
    "../src/features/home/navigation.ts",
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
const canvasStorage = await readFile(
  new URL("../src/features/canvas/utils/canvas-storage.ts", import.meta.url),
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
const headerNotificationDropdown = await readFile(
  new URL("../src/components/header-notification-dropdown.tsx", import.meta.url),
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
const appSettingsDialog = await readFile(
  new URL(
    "../src/features/settings/components/user-settings-dialog.tsx",
    import.meta.url
  ),
  "utf8"
);
const settingsApiClient = await readFile(
  new URL("../src/features/settings/api/client.ts", import.meta.url),
  "utf8"
);
const memberProfileDialog = await readFile(
  new URL(
    "../src/features/home/components/member-profile-dialog.tsx",
    import.meta.url
  ),
  "utf8"
);
const workspaceCreationRoute = await readFile(
  new URL("../src/app/workspace/new/page.tsx", import.meta.url),
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
const canvasRemoteOperations = await readFile(
  new URL(
    "../src/features/canvas/components/engine/runtime/canvas-remote-operations.ts",
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
const canvasAiChatOverlay = await readFile(
  new URL(
    "../src/features/canvas/components/engine/surface/CanvasAiChatOverlay.tsx",
    import.meta.url
  ),
  "utf8"
);
const canvasShapeSync = await readFile(
  new URL("../src/features/canvas/utils/canvas-shape-sync.ts", import.meta.url),
  "utf8"
);
const canvasCollapse = await readFile(
  new URL("../src/features/canvas/utils/canvas-collapse.ts", import.meta.url),
  "utf8"
);
const canvasCss = await readFile(
  new URL("../src/features/canvas/styles/canvas.css", import.meta.url),
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
const canvasAgentToolStepPlayback = await readFile(
  new URL(
    "../src/features/canvas/components/engine/surface/canvas-agent-tool-step-playback.ts",
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
const canvasRealtimeTypes = await readFile(
  new URL("../src/shared/canvas-realtime/canvas-realtime-types.ts", import.meta.url),
  "utf8"
);
const canvasRealtimeClient = await readFile(
  new URL("../src/shared/canvas-realtime/canvas-realtime-client.ts", import.meta.url),
  "utf8"
);
const canvasPresenceHook = await readFile(
  new URL("../src/features/canvas/realtime/useCanvasPresence.ts", import.meta.url),
  "utf8"
);
const canvasRemoteCursorOverlay = await readFile(
  new URL("../src/shared/canvas-realtime/RemoteCursorOverlay.tsx", import.meta.url),
  "utf8"
);
const canvasRealtimeCss = await readFile(
  new URL("../src/shared/canvas-realtime/canvas-realtime.css", import.meta.url),
  "utf8"
);
const canvasRemotePresenceContext = await readFile(
  new URL(
    "../src/features/canvas/realtime/CanvasRemotePresenceContext.tsx",
    import.meta.url
  ),
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
const piloCollapsedFrameOverlay = await readFile(
  new URL(
    "../src/features/canvas/components/engine/surface/PiloCollapsedFrameOverlay.tsx",
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
const piloCanvasFileImport = await readFile(
  new URL(
    "../src/features/canvas/components/engine/interactions/pilo-canvas-file-import.ts",
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
    "../src/app/(workspace)/home/page.tsx",
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
    "../src/features/home/page.tsx",
    "../src/features/github-integration/page.tsx",
    "../src/features/board/page.tsx",
    "../src/features/pr-review/page.tsx",
    "../src/features/meeting/page.tsx",
    "../src/features/canvas/page.tsx"
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8"))
);
const navigation = navigationFiles.join("\n");
const featureNavigation = await readFile(
  new URL("../src/features/navigation.ts", import.meta.url),
  "utf8"
);
const canvasNavigationSource = await readFile(
  new URL("../src/features/canvas/navigation.ts", import.meta.url),
  "utf8"
);
const routes = routePages.join("\n");
const pages = featurePages.join("\n");
const deprecatedCanvasTokenEnv = "NEXT_PUBLIC_PILO_" + "ACCESS_TOKEN";

assert.match(navigation, /Calendar/);
assert.match(navigation, /Home/);
assert.match(navigation, /GitHub sync/);
assert.match(navigation, /Board/);
assert.match(navigation, /PR review/);
assert.match(navigation, /Voice meeting/);
assert.match(navigation, /Canvas/);
assert.match(featureNavigation, /meetingNavigation,[\s\S]*canvasNavigation,[\s\S]*driveNavigation/);
assert.match(canvasNavigationSource, /items:\s*\[\]/);
assert.doesNotMatch(canvasNavigationSource, /최근 캔버스|새 캔버스|도형 보드/);
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
assert.match(authSession, /WorkspaceOnboardingRequiredError/);
assert.match(authSession, /\/workspace\/new\?onboarding=1/);
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
assert.doesNotMatch(authApiClient, /revokeWorkspaceInvitation/);
assert.match(authApiClient, /rejectCurrentUserWorkspaceInvitation/);
assert.match(authApiClient, /acceptWorkspaceInvitation/);
assert.doesNotMatch(authSession, /createWorkspace\(/);
assert.match(authApiClient, /createWorkspace\(/);
assert.match(loginPage, /Welcome back/);
assert.match(loginPage, /Login with GitHub/);
assert.match(loginPage, /Login with Google/);
assert.match(loginPage, /devPreview/);
assert.match(loginPage, /UI Preview/);
assert.match(loginPage, /buildDevPreviewCallbackUrl/);
assert.match(loginPage, /PILO_DEV_PREVIEW_ACCESS_TOKEN/);
assert.match(loginPage, /\/home/);
assert.doesNotMatch(loginPage, /Or continue with/);
assert.doesNotMatch(loginPage, /Forgot your password/);
assert.match(loginCallbackPage, /access_token/);
assert.match(loginCallbackPage, /loadAuthSessionEntry/);
assert.match(loginCallbackPage, /\/home/);
assert.match(workspaceLayout, /AuthGate/);
assert.match(workspaceLayout, /MeetingRuntimeProvider/);
assert.match(workspaceLayout, /<MainShell>\{children\}<\/MainShell>/);
assert.doesNotMatch(mainShell, /AuthGate/);
assert.match(mainShell, /usePathname/);
assert.match(mainShell, /getFeatureNavigationItemForPathname/);
assert.match(mainShell, /HeaderMeetingStatus/);
assert.match(mainShell, /HeaderNotificationDropdown/);
assert.match(mainShell, /sticky top-0/);
assert.match(mainShell, /<span className="truncate">\{activeFeature\.title\}<\/span>/);
assert.match(mainShell, /peer-data-\[variant=inset\]:!m-0/);
assert.match(mainShell, /peer-data-\[state=collapsed\]:!ml-0/);
assert.match(headerNotificationDropdown, /PopoverTrigger/);
assert.match(headerNotificationDropdown, /PopoverContent/);
assert.match(headerNotificationDropdown, /DialogContent/);
assert.match(headerNotificationDropdown, /unreadCount > 0/);
assert.doesNotMatch(headerNotificationDropdown, /INITIAL_NOTIFICATIONS/);
assert.match(headerNotificationDropdown, /표시할 알림이 없습니다/);
assert.match(headerNotificationDropdown, /READ_INVITATIONS_STORAGE_PREFIX/);
assert.match(headerNotificationDropdown, /localStorage/);
assert.match(headerNotificationDropdown, /closeInvitationDialogAsRead/);
assert.match(appSidebar, /useAuthSession/);
assert.match(appSidebar, /usePathname/);
assert.match(appSidebar, /pathname === subItem\.href/);
assert.match(appSidebar, /pathname\.startsWith\(`\$\{subItem\.href\}\/`\)/);
assert.match(appSidebar, /useMeetingRuntime/);
assert.match(appSidebar, /leaveActiveMeeting/);
assert.match(appSidebar, /logout/);
assert.match(appSidebar, /ACTIVE_MEETING_LEAVE_FAILED_MESSAGE/);
assert.match(appSidebar, /sessionActionStatus/);
assert.match(
  headerNotificationDropdown,
  /await meetingRuntime\.leaveActiveMeeting\(\);[\s\S]*await acceptCurrentUserWorkspaceInvitation\(/
);
assert.match(headerNotificationDropdown, /workspaceInvitations/);
assert.match(headerNotificationDropdown, /acceptSelectedInvitation/);
assert.match(headerNotificationDropdown, /rejectSelectedInvitation/);
assert.match(headerNotificationDropdown, /listCurrentUserWorkspaceInvitations/);
assert.match(headerNotificationDropdown, /acceptCurrentUserWorkspaceInvitation/);
assert.match(headerNotificationDropdown, /rejectCurrentUserWorkspaceInvitation/);
assert.doesNotMatch(appSidebar, /pendingInvitationCount/);
assert.doesNotMatch(appSidebar, /handleOpenInvitations/);
assert.doesNotMatch(appSidebar, /listCurrentUserWorkspaceInvitations/);
assert.match(appSidebar, /handleSelectWorkspace/);
assert.match(appSidebar, /내가 만든 워크스페이스/);
assert.match(appSidebar, /참여 중인 워크스페이스/);
assert.match(appSidebar, /새 워크스페이스 만들기/);
assert.doesNotMatch(appSidebar, /previewWorkspaces/);
assert.doesNotMatch(appSidebar, /Design Team/);
assert.doesNotMatch(appSidebar, /Review Lab/);
assert.match(appSidebar, /router\.push\("\/workspace\/new"\)/);
assert.match(appSidebar, /canManageWorkspace=\{activeWorkspace\.role === "owner"\}/);
assert.match(appSettingsDialog, /value="workspace"/);
assert.match(appSettingsDialog, /disabled=\{!canManageWorkspace\}/);
assert.match(appSettingsDialog, /Workspace 삭제/);
assert.match(appSettingsDialog, /Member는 Workspace 정보를 조회만 할 수 있습니다/);
assert.doesNotMatch(appSettingsDialog, /MOCK_GITHUB_CONNECTIONS/);
assert.match(settingsApiClient, /\/me\/settings/);
assert.match(settingsApiClient, /\/me\/profile/);
assert.match(settingsApiClient, /deleteCurrentAccount/);
assert.match(appSettingsDialog, /githubContent: ReactNode/);
assert.match(appSettingsDialog, /\{githubContent\}/);
assert.match(workspaceCreationRoute, /WorkspaceCreationPage/);
assert.match(
  headerNotificationDropdown,
  /authSession\.refreshSession\(result\.workspace\.id\)/
);
assert.doesNotMatch(appSidebar, /activeWorkspaceDetail/);
assert.doesNotMatch(appSidebar, /listWorkspaceMembers/);
assert.doesNotMatch(appSidebar, /removeWorkspaceMember/);
assert.doesNotMatch(appSidebar, /handleRemoveWorkspaceMember/);
assert.doesNotMatch(appSidebar, /handleHideInvitation/);
assert.doesNotMatch(appSidebar, /findAcceptedInvitationMember/);
assert.doesNotMatch(appSidebar, /AlertDialogContent/);
assert.doesNotMatch(appSidebar, /AlertDialogAction/);
assert.doesNotMatch(appSidebar, /createWorkspaceInvitation/);
assert.doesNotMatch(appSidebar, /listWorkspaceInvitations/);
assert.doesNotMatch(appSidebar, /revokeWorkspaceInvitation/);
assert.match(appSidebar, /AvatarImage/);
assert.match(appSidebar, /avatarUrl: authSession\.user\.avatarUrl/);
assert.match(appSidebar, /src=\{displayUser\.avatarUrl \|\| undefined\}/);
assert.match(appSidebar, /group-data-\[collapsible=icon\]:justify-center/);
assert.match(appSidebar, /group-data-\[collapsible=icon\]:hidden/);
assert.match(appSidebar, /group-data-\[collapsible=icon\]:mx-auto/);
assert.match(appSidebar, /group-data-\[collapsible=icon\]:w-8/);
assert.doesNotMatch(appSidebar, /\{item\.description\}/);
assert.doesNotMatch(appSidebar, /ProfileDialog/);
assert.doesNotMatch(appSidebar, /AccountDialog/);
assert.match(appSidebar, /SettingsDialog/);
assert.doesNotMatch(appSidebar, /openUserDialog/);
assert.match(appSidebar, /setIsSettingsDialogOpen\(true\)/);
assert.match(appSidebar, /open=\{isSettingsDialogOpen\}/);
assert.match(appSettingsDialog, /DialogContent/);
assert.doesNotMatch(appSettingsDialog, /export function ProfileDialog/);
assert.doesNotMatch(appSettingsDialog, /export function AccountDialog/);
assert.match(appSettingsDialog, /export function SettingsDialog/);
assert.match(appSettingsDialog, /<TabsContent value="profile">/);
assert.match(appSettingsDialog, /<TabsContent value="account">/);
assert.match(appSettingsDialog, /<TabsContent value="github">/);
assert.match(appSettingsDialog, /max-h-\[44rem\]/);
assert.doesNotMatch(appSettingsDialog, /DIALOG_VIEWS/);
assert.doesNotMatch(appSettingsDialog, /aria-label="사용자 메뉴"/);
assert.doesNotMatch(appSettingsDialog, /MOCK_CURRENT_SESSION/);
assert.doesNotMatch(appSettingsDialog, /value="security"/);
assert.match(appSettingsDialog, /API 연결됨/);
assert.match(appSettingsDialog, /updateCurrentSettings/);
assert.match(appSettingsDialog, /updateCurrentProfile/);
assert.match(appSettingsDialog, /deleteCurrentAccount/);
assert.match(appSettingsDialog, /updateWorkspace/);
assert.match(appSettingsDialog, /deleteWorkspace/);
assert.match(appSettingsDialog, /workspaceDeleteError/);
assert.match(appSettingsDialog, /role="alert"/);
assert.match(appSettingsDialog, /계정 탈퇴/);
assert.doesNotMatch(appSettingsDialog, /프로필 편집/);
assert.doesNotMatch(appSettingsDialog, /파일 업로드 없이/);
assert.match(appSettingsDialog, /URL 이미지/);
assert.match(appSettingsDialog, /setCustomAvatarUrl/);
assert.match(memberProfileDialog, /export function MemberProfileDialog/);
assert.match(memberProfileDialog, /member\.user\.name/);
assert.match(memberProfileDialog, /member\.user\.lastSeenAt/);
assert.match(memberProfileDialog, /member\.user\.jobTitle/);
assert.match(memberProfileDialog, /member\.user\.bio/);
assert.match(memberProfileDialog, /canRemoveSelectedMember/);
assert.match(memberProfileDialog, /member\.role !== "owner"/);
assert.match(memberProfileDialog, /max-w-4xl/);
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
assert.match(canvasApiClient, /listOperationsAfterSeq/);
assert.match(canvasApiClient, /\/operations\?\$\{search\.toString\(\)\}/);
assert.match(canvasTypes, /signal\?: AbortSignal/);
assert.match(canvasTypes, /CanvasOperationsCatchupPayload/);
assert.match(canvasTypes, /CanvasShapeOperationPayload/);
assert.match(canvasNormalizers, /normalizeCanvasOperationsCatchup/);
assert.match(canvasNormalizers, /normalizeCanvasOperation/);
assert.match(canvasApiClient, /enterCanvas/);
assert.match(canvasApiClient, /leaveCanvas/);
assert.match(canvasApiClient, /syncShapesBatch/);
assert.match(canvasApiClient, /\/enter`/);
assert.match(canvasApiClient, /\/leave`/);
assert.match(canvasApiClient, /\/shapes\/batch`/);
assert.match(canvasApiClient, /URLSearchParams/);
assert.match(canvasApiClient, /parentShapeId/);
assert.match(canvasApiClient, /method: "POST"/);
assert.match(canvasApiClient, /method: "PATCH"/);
assert.match(canvasApiClient, /method: "DELETE"/);
assert.match(canvasMockClient, /readCanvasStorage/);
assert.match(canvasMockClient, /writeCanvasStorage/);
assert.match(canvasMockClient, /createMockCanvasClient/);
assert.match(canvasMockClient, /mock-board-list/);
assert.match(canvasMockClient, /mock-user/);
assert.match(canvasMockClient, /zoom: 0\.8/);
assert.match(canvasMockClient, /listOperationsAfterSeq/);
assert.doesNotMatch(canvasMockClient, /Authorization: `Bearer/);
assert.doesNotMatch(canvasMockClient, /NEXT_PUBLIC_PILO_APP_SERVER_URL/);
assert.doesNotMatch(canvasMockClient, /requestCanvasJson/);
assert.match(canvasNormalizers, /createMockCanvasBoardDetail/);
assert.match(canvasNormalizers, /normalizeCanvasBoardDetail/);
assert.match(canvasNormalizers, /unwrapCanvasApiData/);
assert.match(canvasNormalizers, /zoom: 0\.8/);
assert.match(canvasNormalizers, /normalizeCanvasShapes/);
assert.match(canvasNormalizers, /PILO_CHILD_SHAPE_COUNT_META_KEY/);
assert.match(canvasNormalizers, /value\.parentShapeId/);
assert.match(canvasNormalizers, /rawShape\.id = id/);
assert.match(canvasNormalizers, /rawShape\.type = shapeType/);
assert.match(canvasNormalizers, /delete rawShape\.parentId/);
assert.match(canvasStorage, /normalizeParentId/);
assert.match(canvasStorage, /delete normalizedShape\.parentId/);
assert.match(canvasStorage, /delete normalizedShape\.index/);
assert.match(canvasStorage, /delete props\.assetId/);
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
assert.match(canvasRuntime, /loadFrameChildren/);
assert.match(canvasRuntime, /<CanvasZoomControls/);
assert.match(canvasRuntimeTypes, /CanvasViewSettingApiClient/);
assert.match(canvasRuntimeUtils, /hasCanvasFreeformShapeChanged/);
assert.match(canvasRuntimeUtils, /buildFrameChildrenQueryKey/);
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
assert.match(canvasShapePersistence, /deletedShapeIdsRef\.current\.add\(shapeId\)/);
assert.match(canvasShapePersistence, /deletedShapeIdsRef\.current\.has\(shapeId\)/);
assert.match(canvasShapePersistence, /unloadedShapeIdsRef/);
assert.match(canvasShapePersistence, /buildPersistableLocalShapes/);
assert.match(canvasShapePersistence, /nextShapes: buildPersistableLocalShapes\(nextFreeformShapes\)/);
assert.match(canvasShapePersistence, /previousShapes: buildPersistableLocalShapes\(currentFreeformShapes\)/);
assert.match(canvasShapePersistence, /pendingLocalShapeVersionsRef\.current\.has\(shapeId\)/);
assert.match(canvasShapePersistence, /shapeSyncQueue\s*\.\s*whenIdle\(\)/);
assert.match(canvasViewportQueries, /queryClient\s*\.\s*fetchQuery/);
assert.match(canvasViewportQueries, /queryClient\s*\.\s*cancelQueries/);
assert.match(canvasViewportQueries, /queryClient\.removeQueries\(\{ exact: true, queryKey \}\)/);
assert.match(canvasViewportQueries, /listShapesInViewport/);
assert.match(canvasViewportQueries, /parentShapeId: frameId/);
assert.match(canvasViewportQueries, /staleTime: 0/);
assert.match(canvasViewportQueries, /isPiloFrameCollapsed/);
assert.match(canvasViewportQueries, /mergeFrameChildren/);
assert.match(canvasViewportQueries, /getShapeDetail/);
assert.match(canvasViewportQueries, /CANVAS_SHAPE_DETAIL_MIN_ZOOM/);
assert.match(canvasViewportQueries, /createViewportShapeLoadBounds/);
assert.match(canvasViewportQueries, /doesLoadedViewportCoverBounds/);
assert.match(canvasViewportQueries, /MAX_LOADED_VIEWPORT_BOUNDS = 24/);
assert.match(canvasViewportQueries, /loadedViewportBoundsRef/);
assert.match(canvasViewportQueries, /currentLoadedViewport\.bounds\.some/);
assert.match(canvasRuntimeUtils, /DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN/);
assert.match(canvasRuntimeUtils, /DEFAULT_VIEW_SETTING_SYNC_DEBOUNCE_MS = 3_000/);
assert.match(
  canvasRuntimeUtils,
  /DEFAULT_VIEWPORT_SHAPE_LOAD_DEBOUNCE_MS = 700/,
);
assert.match(canvasRuntimeUtils, /CANVAS_VIEWPORT_SHAPE_QUERY_GRID_SIZE = 1_000/);
assert.match(canvasRuntimeUtils, /Math\.floor\(value \/ CANVAS_VIEWPORT_SHAPE_QUERY_GRID_SIZE\)/);
assert.match(canvasRuntimeUtils, /Math\.round\(bounds\.zoom \* 4\) \/ 4/);
assert.doesNotMatch(canvasRuntimeUtils, /round\(bounds\.x\)/);
assert.match(canvasViewSettingPersistence, /storageMode === "api"/);
assert.match(canvasViewSettingPersistence, /updateViewSetting/);
assert.match(canvasShapePersistence, /writeCanvasStorage\([\s\S]*"freeform-shapes"/);
assert.match(canvasViewSettingPersistence, /writeCanvasStorage\("view-setting"/);
assert.match(canvasRuntime, /onSnapStateChange/);
assert.match(canvasRuntime, /INITIAL_CANVAS_VIEW_SETTING/);
assert.match(canvasRuntime, /zoom: 0\.8/);
assert.match(canvasRuntime, /canvasSnapState\.isSmartGuideEnabled/);
assert.match(canvasRuntime, /setSmartGuidesEnabled/);
assert.match(canvasZoomControls, /aria-label="스마트가이드"/);
assert.match(canvasZoomControls, /<Magnet/);
assert.match(canvasZoomControls, /Magnet, Trash2/);
assert.match(
  canvasZoomControls,
  /aria-label="축소"[\s\S]*<strong>\{Math\.round\(viewSetting\.zoom \* 100\)\}%<\/strong>[\s\S]*aria-label="확대"[\s\S]*aria-label="스마트가이드"[\s\S]*aria-label="선택 삭제"/
);
assert.match(canvasZoomControls, /className="canvas-trash-drop-zone"/);
assert.match(canvasZoomControls, /data-tooltip="휴지통"/);
assert.match(canvasZoomControls, /canvasActions\?\.deleteSelection\(\)/);
assert.match(canvasWorkspace, /useAuthSession/);
assert.match(canvasWorkspace, /authSession\?\.activeWorkspaceId/);
assert.match(canvasWorkspace, /authToken: authSession\?\.accessToken/);
assert.match(canvasWorkspace, /createBoard\(workspaceId/);
assert.doesNotMatch(canvasWorkspace, /NEXT_PUBLIC_PILO_WORKSPACE_ID/);
assert.doesNotMatch(canvasWorkspace, /getCanvasWorkspaceId/);
assert.match(canvasWorkspace, /const shouldUseCanvasApi =/);
assert.match(canvasWorkspace, /const activeBoard =/);
assert.match(canvasWorkspace, /boardState\.board\.workspaceId === workspaceId/);
assert.match(canvasWorkspace, /!boardId \|\| boardState\.board\.id === boardId/);
assert.match(canvasWorkspace, /boardState.status === "ready"/);
assert.match(canvasWorkspace, /activeBoard !== null/);
assert.match(canvasWorkspace, /key=\{`\$\{board\.workspaceId\}:\$\{board\.id\}:\$\{shouldUseCanvasApi \? "api" : "local"\}`\}/);
assert.match(canvasWorkspace, /canvasRealtimeConfig/);
assert.match(canvasWorkspace, /isDevPreviewAccessToken/);
assert.match(canvasWorkspace, /RETURN_TO_CLASSIC_CANVAS_SHORTCUT = "Ctrl\+Alt\+C"/);
assert.match(canvasWorkspace, /returnToSourceClassicCanvas/);
assert.match(canvasWorkspace, /sourceCanvasId/);
assert.match(canvasWorkspace, /realtime=\{canvasRealtimeConfig\}/);
assert.match(canvasWorkspace, /canvasHistoryState\.canUndo/);
assert.match(canvasWorkspace, /canvasHistoryState\.canRedo/);
assert.match(canvasWorkspace, /onHistoryStateChange=\{setCanvasHistoryState\}/);
assert.match(canvasWorkspace, /canvasActions\?\.createNote\(\)/);
assert.doesNotMatch(canvasWorkspace, /createStickyNote/);
assert.match(canvasWorkspace, /canvasActions\?\.setColor\(color\)/);
assert.match(canvasWorkspace, /openPopover === "color"/);
assert.match(canvasWorkspace, /<Dialog/);
assert.match(canvasWorkspace, /<DialogTitle>/);
assert.match(canvasWorkspace, /<Input/);
assert.doesNotMatch(canvasWorkspace, /window\.prompt/);
assert.match(canvasWorkspace, /label="더보기"/);
assert.match(canvasWorkspace, /label="사각형"[\s\S]*label="원"[\s\S]*label="삼각형"/);
assert.match(canvasWorkspace, /label="더보기"/);
assert.match(canvasWorkspace, /aria-label="더보기 도구"/);
assert.doesNotMatch(canvasWorkspace, /label="삽입"/);
assert.doesNotMatch(canvasWorkspace, /label="스마트가이드"/);
assert.match(canvasWorkspace, /canvasClient=\{shouldUseCanvasApi \? canvasClient : null\}/);
assert.match(canvasWorkspace, /storageMode=\{shouldUseCanvasApi \? "api" : "local"\}/);
assert.match(canvasRuntime, /useCanvasPresence/);
assert.match(canvasRuntime, /canvasClient,\s*[\r\n]\s*latestViewportBoundsRef/);
assert.doesNotMatch(canvasRuntime, /persistenceCanvasClient/);
assert.doesNotMatch(canvasRuntime, /commitShapeOperations/);
assert.match(canvasRuntime, /canvas-sync-notice/);
assert.match(canvasRuntime, /getShapeSyncErrorNoticeMessage/);
assert.match(canvasRuntime, /onShapeSyncError: handleShapeSyncError/);
assert.match(canvasRuntime, /catchUpCanvasOperations/);
assert.match(canvasRuntime, /applyRemoteCanvasOperations/);
assert.match(canvasRuntime, /deferredRemoteOperationsRef/);
assert.match(canvasRuntime, /MAX_DEFERRED_REMOTE_OPERATIONS = 80/);
assert.match(canvasRuntime, /queueDeferredRemoteOperation/);
assert.match(canvasRuntime, /readDeferredRemoteOperations/);
assert.match(canvasRuntime, /remoteShapeRevisionRef/);
assert.match(canvasRuntime, /deletedShapeIdsRef/);
assert.match(canvasRuntime, /markShapeDeleted/);
assert.match(canvasRuntime, /pendingLocalShapeVersionsRef\.current\.has/);
assert.match(canvasRuntime, /actorUserId === currentRealtimeUserId/);
assert.match(canvasRuntime, /listOperationsAfterSeq/);
assert.match(canvasRuntime, /realtime\?: CanvasRealtimeConfig \| null/);
assert.match(canvasRuntime, /presence=\{canvasPresence\}/);
assert.match(canvasRuntime, /serializeCanvasRoomStateShape/);
assert.match(canvasRuntime, /serializedShape\.revision = shapeRecord\.revision/);
assert.match(canvasRuntime, /serializedShape\.contentHash = shapeRecord\.contentHash/);
assert.match(canvasRuntime, /onViewportShapesLoaded: reportLoadedViewport/);
assert.match(canvasRuntime, /hydrateShapes: hydrateRoomShapes/);
assert.match(canvasRuntime, /applyRoomShapePatch/);
assert.match(canvasRuntime, /onRoomShapePatch: sendRoomShapePatch/);
assert.match(canvasRuntime, /persistThroughRoomState: canvasPresence\.enabled/);
assert.match(canvasRuntime, /checkpointStatus\?\.status !== "delayed"/);
assert.match(canvasRuntime, /저장이 지연되고 있어요/);
assert.match(canvasRuntime, /shapeDetailCacheRef\.current\.set\(shape\.id, shape\)/);
assert.match(canvasRemoteOperations, /applyCanvasRemoteOperation/);
assert.match(canvasRemoteOperations, /PILO_ARROW_BINDINGS_META_KEY/);
assert.match(canvasRemoteOperations, /preserveArrowBindingMeta/);
assert.match(canvasRemoteOperations, /shapeDetailCache\.set/);
assert.match(canvasRemoteOperations, /shapeDetailCache\.delete/);
assert.match(canvasRemoteOperations, /intersectsViewport/);
assert.match(canvasRemoteOperations, /isPiloFrameCollapsed/);
assert.match(canvasRemoteOperations, /getPiloChildShapeCount/);
assert.match(canvasRemoteOperations, /expandedFrameIds/);
assert.match(canvasRemoteOperations, /unloadedShapeIds/);
assert.match(canvasRemoteOperations, /collectDescendantShapeIds/);
assert.match(canvasRemoteOperations, /function isShapeParentId/);
assert.match(canvasRemoteOperations, /parentId\.startsWith\("shape:"\)/);
assert.match(canvasRemoteOperations, /shapeDetailCache\.get\(parentId\)/);
assert.match(canvasRemoteOperations, /parentId/);
assert.match(canvasRuntime, /pendingRemoteFrameChildrenRequestRef/);
assert.match(canvasRuntime, /result\.expandedFrameIds/);
assert.match(canvasRuntime, /result\.unloadedShapeIds/);
assert.match(canvasRuntime, /loadFrameChildren\(frameId\)/);
assert.match(canvasRuntime, /getPreservedFreeformShapeSnapshots/);
assert.match(canvasViewportQueries, /pendingFrameChildrenReloadRef/);
assert.match(piloTldrawCanvas, /CanvasPresenceReporter/);
assert.match(piloTldrawCanvas, /getCanvasPresenceEditingMode/);
assert.match(piloTldrawCanvas, /editingShapeId/);
assert.match(piloTldrawCanvas, /editingMode/);
assert.match(piloTldrawCanvas, /RemoteCursorOverlay/);
assert.match(piloTldrawCanvas, /CanvasRemotePresenceProvider/);
assert.match(piloTldrawCanvas, /CanvasRealtimePreviewApplier/);
assert.match(piloTldrawCanvas, /handleRealtimePreviewDraftChange/);
assert.match(piloTldrawCanvas, /claimShapeLocks/);
assert.match(piloTldrawCanvas, /releaseShapeLocks/);
assert.match(piloTldrawCanvas, /deletedShapeIds/);
assert.match(piloTldrawCanvas, /shapesToHide/);
assert.match(piloTldrawCanvas, /remoteShapeLocks/);
assert.match(piloTldrawCanvas, /remoteShapePreviews/);
assert.match(piloTldrawCanvas, /resolveRealtimePreviewSnapshot/);
assert.match(piloTldrawCanvas, /syncFreeformShapesIncrementally/);
assert.match(piloTldrawCanvas, /shouldPreserveMissingFrameChildShape/);
assert.match(piloTldrawCanvas, /getPreservedFreeformShapeSnapshots/);
assert.match(piloTldrawCanvas, /editor\.updateShapes\(shapesToUpdate/);
assert.match(canvasAgentToolStepPlayback, /playbackState/);
assert.match(canvasAgentToolStepPlayback, /setPlaybackState\("playing"\)/);
assert.match(canvasAgentToolStepPlayback, /setPlaybackState\("complete"\)/);
assert.match(canvasAgentToolStepPlayback, /new Set<string>\(\)/);
assert.match(piloTldrawCanvas, /removeStaleSerializedArrowBindings/);
assert.match(piloTldrawCanvas, /editor\.getContainer\(\)/);
assert.match(piloTldrawCanvas, /editor\.screenToPage/);
assert.match(canvasRealtimeTypes, /CanvasRealtimeConfig/);
assert.match(canvasRealtimeTypes, /CanvasRemotePresenceState/);
assert.match(canvasRealtimeTypes, /CanvasPresenceEditingMode/);
assert.match(canvasRealtimeTypes, /editingShapeId/);
assert.match(canvasRealtimeTypes, /CanvasPresenceViewport/);
assert.match(canvasRealtimeTypes, /CanvasRoomLoadedRegion/);
assert.match(canvasRealtimeTypes, /"canvas:viewport:loaded"/);
assert.match(canvasRealtimeTypes, /"canvas:room:loaded-regions:update"/);
assert.match(canvasRealtimeTypes, /"canvas:room:shapes:hydrate"/);
assert.match(canvasRealtimeTypes, /"canvas:room:shape:patch"/);
assert.match(canvasRealtimeTypes, /CanvasRoomCheckpointStatusPayload/);
assert.match(canvasRealtimeTypes, /"canvas:room:checkpoint"/);
assert.match(canvasRealtimeTypes, /roomShapes: Record<string, unknown>\[\]/);
assert.match(canvasRealtimeTypes, /"canvas:operation"/);
assert.match(canvasRealtimeTypes, /"canvas:sync:required"/);
assert.match(canvasRealtimeTypes, /"canvas:presence:update"/);
assert.match(canvasRealtimeTypes, /"canvas:shape:lock:claim"/);
assert.doesNotMatch(canvasRealtimeTypes, /"canvas:shape:commit"/);
assert.doesNotMatch(canvasRealtimeTypes, /CanvasShapeCommitAck/);
assert.match(canvasRealtimeTypes, /"canvas:shape:lock:accepted"/);
assert.match(canvasRealtimeTypes, /"canvas:shape:lock:rejected"/);
assert.match(canvasRealtimeTypes, /"canvas:shape:lock:update"/);
assert.match(canvasRealtimeTypes, /"canvas:shape:preview"/);
assert.match(canvasRealtimeTypes, /"canvas:shape:preview:clear"/);
assert.match(canvasRealtimeTypes, /previews: CanvasShapePreviewEventPayload\[\]/);
assert.match(canvasRealtimeTypes, /shapeLocks: CanvasShapeLockState\[\]/);
assert.match(canvasRealtimeTypes, /deletedShapeIds/);
assert.match(canvasPresenceHook, /remoteShapeLocks/);
assert.match(canvasPresenceHook, /removeShapePreviewIds/);
assert.match(canvasPresenceHook, /remoteShapePreviews/);
assert.match(canvasPresenceHook, /roomLoadedRegions/);
assert.match(canvasPresenceHook, /reportLoadedViewport/);
assert.match(canvasPresenceHook, /hydrateShapes/);
assert.match(canvasPresenceHook, /sendRoomShapePatch/);
assert.match(canvasPresenceHook, /applyRoomShapePatch/);
assert.match(canvasPresenceHook, /checkpointStatus/);
assert.match(canvasPresenceHook, /sendShapePreview/);
assert.match(canvasShapePersistence, /persistThroughRoomState/);
assert.match(canvasShapePersistence, /clearPendingLocalShapeChanges\(pendingLocalShapeVersions\)/);
assert.match(canvasPresenceHook, /clearShapePreview/);
assert.match(canvasPresenceHook, /STALE_SHAPE_PREVIEW_TIMEOUT_MS = 5_000/);
assert.match(canvasRealtimeClient, /NEXT_PUBLIC_PILO_REALTIME_SERVER_URL/);
assert.match(canvasRealtimeClient, /http:\/\/localhost:3001/);
assert.match(canvasRealtimeClient, /transports: \["websocket"\]/);
assert.match(canvasPresenceHook, /canvas:join/);
assert.match(canvasPresenceHook, /canvas:leave/);
assert.doesNotMatch(canvasPresenceHook, /SHAPE_COMMIT_ACK_TIMEOUT_MS = 10_000/);
assert.doesNotMatch(canvasPresenceHook, /canvas:shape:commit/);
assert.doesNotMatch(canvasPresenceHook, /CanvasRealtimeCommitError/);
assert.match(canvasPresenceHook, /lastSeenOpSeqRef/);
assert.match(canvasPresenceHook, /runCatchUp/);
assert.match(canvasPresenceHook, /applyOperations/);
assert.match(canvasPresenceHook, /applyContiguousOperations/);
assert.match(canvasPresenceHook, /liveOperationBufferRef/);
assert.match(canvasPresenceHook, /flushBufferedOperations/);
assert.match(canvasPresenceHook, /canvas:operation/);
assert.match(canvasPresenceHook, /canvas:sync:required/);
assert.match(canvasPresenceHook, /operation\.opSeq === lastSeenOpSeq \+ 1/);
assert.match(canvasPresenceHook, /STALE_PRESENCE_TIMEOUT_MS = 15_000/);
assert.match(canvasPresenceHook, /normalizeRemotePresence/);
assert.match(canvasPresenceHook, /isPresenceEditingMode/);
assert.match(canvasPresenceHook, /editingShapeId/);
assert.match(canvasPresenceHook, /editingMode/);
assert.match(canvasPresenceHook, /payload\.presence/);
assert.match(canvasPresenceHook, /payload\.shapeLocks/);
assert.match(canvasPresenceHook, /payload\.previews\.filter/);
assert.match(canvasPresenceHook, /payload\.loadedRegions/);
assert.match(canvasPresenceHook, /payload\.roomShapes/);
assert.match(canvasPresenceHook, /canvas:room:shapes:hydrate/);
assert.match(canvasPresenceHook, /canvas:room:shape:patch/);
assert.match(canvasPresenceHook, /canvas:room:checkpoint/);
assert.match(canvasPresenceHook, /ownedShapeLocks: CanvasShapeLockState\[\]/);
assert.match(canvasPresenceHook, /const joinedShapeLocks = upsertShapeLocks\(\[\], payload\.shapeLocks\)/);
assert.match(canvasPresenceHook, /setOwnedShapeLocks/);
assert.match(canvasPresenceHook, /sentAt: new Date\(\)\.toISOString\(\)/);
assert.match(canvasPresenceHook, /userId !== currentUserId/);
assert.match(canvasRemoteCursorOverlay, /pageToScreen/);
assert.match(canvasRemoteCursorOverlay, /getBoundingClientRect/);
assert.match(canvasRemoteCursorOverlay, /getShapePageBounds/);
assert.match(canvasRemoteCursorOverlay, /canvas-remote-selection-outline/);
assert.match(canvasRemoteCursorOverlay, /getStableCursorColor/);
assert.match(canvasRemoteCursorOverlay, /entry\.cursor === null/);
assert.match(canvasRealtimeCss, /canvas-remote-cursor-layer/);
assert.match(canvasRealtimeCss, /canvas-remote-selection-outline/);
assert.match(canvasRemotePresenceContext, /CanvasRemotePresenceProvider/);
assert.match(canvasRemotePresenceContext, /useCanvasRemoteShapePresence/);
assert.match(canvasRemotePresenceContext, /useCanvasRemoteShapeEditingPresence/);
assert.match(canvasRemotePresenceContext, /selectedShapeIds/);
assert.match(canvasRemotePresenceContext, /editingShapeId/);
assert.match(canvasShapeSync, /buildCanvasShapeSyncOperations/);
assert.match(canvasShapeSync, /createCanvasShapeSyncQueue/);
assert.match(canvasShapeSync, /getBaseRevision/);
assert.match(canvasShapeSync, /baseRevision/);
assert.match(canvasShapeSync, /createCanvasClientOperationId/);
assert.match(canvasShapeSync, /clientOperationId/);
assert.match(canvasShapeSync, /DEFAULT_CANVAS_SHAPE_SYNC_QUEUE_DEBOUNCE_MS = 500/);
assert.match(canvasShapeSync, /DEFAULT_CANVAS_SHAPE_SYNC_RETRY_ATTEMPTS = 3/);
assert.match(canvasShapeSync, /DEFAULT_CANVAS_SHAPE_SYNC_BATCH_SIZE = 100/);
assert.match(canvasShapeSync, /NON_RETRYABLE_CANVAS_API_STATUSES/);
assert.match(canvasShapeSync, /new Set\(\[400, 401, 403, 404, 409\]\)/);
assert.match(canvasShapeSync, /isStaleMissingShapeOperation/);
assert.match(canvasShapeSync, /CanvasShapeSyncFailure/);
assert.match(canvasShapeSync, /isNonRetryableCanvasShapeSyncError/);
assert.match(canvasShapeSync, /CanvasShapeSyncConflict/);
assert.match(canvasShapeSync, /CanvasShapeSyncResult/);
assert.match(canvasShapeSync, /readCanvasShapeSyncConflict/);
assert.match(canvasShapeSync, /readCanvasShapeSyncResult/);
assert.match(canvasShapeSync, /shapeRevisions: new Map<string, number>\(\)/);
assert.match(canvasShapeSync, /Math\.max\(localRevision, remoteRevision\)/);
assert.match(canvasShapeSync, /latestShape/);
assert.match(canvasShapeSync, /latestOperation/);
assert.match(canvasShapeSync, /onConflict\?\.\(conflict\)/);
assert.match(canvasShapeSync, /onSynced\?\.\(operations, result\)/);
assert.match(canvasShapeSync, /shouldRetry\(\{ error \}\)/);
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
assert.match(canvasShapeSync, /runBatchOperationsIndividually/);
assert.match(canvasShapeSync, /operations\.slice\(\s*index,\s*index \+ DEFAULT_CANVAS_SHAPE_SYNC_BATCH_SIZE/);
assert.match(canvasShapeSync, /createShape\(\s*boardId,/);
assert.match(canvasShapeSync, /updateShape\(\s*operation\.shapeId,/);
assert.match(canvasShapeSync, /clientOperationId: operation\.clientOperationId/);
assert.match(canvasShapeSync, /deleteShape\(\s*operation\.shapeId,/);
assert.match(canvasShapeSync, /baseRevision: operation\.baseRevision/);
assert.match(canvasShapeSync, /id: typeof shape.id === "string" \? shape.id : ""/);
assert.match(canvasShapeSync, /function resolveParentShapeId/);
assert.match(canvasShapeSync, /parentId\.startsWith\("shape:"\)/);
assert.match(canvasShapeSync, /parentShapeId: resolveParentShapeId\(shape\.parentId\)/);
assert.match(canvasShapeSync, /shapeType: typeof shape.type === "string" \? shape.type : ""/);
assert.match(canvasShapeSync, /x: readFiniteNumber\(shape.x, 0\)/);
assert.match(canvasShapeSync, /y: readFiniteNumber\(shape.y, 0\)/);
assert.match(canvasShapeSync, /rawShape: cloneRawShape\(shape\)/);
assert.match(canvasNormalizers, /defineCanvasShapeMetadata/);
assert.match(canvasNormalizers, /enumerable: false/);
assert.match(canvasNormalizers, /defineCanvasShapeMetadata\(rawShape, "revision", value\.revision\)/);
assert.match(canvasNormalizers, /defineCanvasShapeMetadata\(rawShape, "contentHash", value\.contentHash\)/);
assert.match(canvasApiLifecycle, /result\.shapeRevisions\.forEach/);
assert.match(canvasShapePersistence, /result\.shapeRevisions\.forEach/);
assert.match(packageJson, /"@tanstack\/react-query"/);
assert.match(packageJson, /"p-queue"/);
assert.match(packageJson, /"p-retry"/);
assert.match(packageJson, /"microdiff"/);
assert.match(packageJson, /"socket\.io-client"/);
assert.match(tldrawSurface, /export function TldrawSurface/);
assert.match(tldrawSurface, /shapeUtils=\{shapeUtils\}/);
assert.match(tldrawSurface, /onMount=\{onMount\}/);
assert.doesNotMatch(tldrawSurface, /useCanvasPresence/);
assert.doesNotMatch(tldrawSurface, /RemoteCursorOverlay/);
assert.doesNotMatch(tldrawSurface, /createCanvasShapeSyncQueue/);
assert.doesNotMatch(tldrawSurface, /writeCanvasStorage/);
assert.match(piloTldrawCanvas, /TldrawSurface/);
assert.match(piloTldrawCanvas, /piloCanvasShapeUtils/);
assert.match(piloTldrawCanvas, /hideUi/);
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
assert.match(piloTldrawCanvas, /deleteSelection: \(\) => void/);
assert.match(piloTldrawCanvas, /function isPointerInsideTrashDropZone/);
assert.match(piloTldrawCanvas, /function updateTrashDropZoneAttraction/);
assert.match(
  piloTldrawCanvas,
  /Boolean\(trashDropZone\) && editor\.getSelectedShapeIds\(\)\.length > 0/,
);
assert.match(piloTldrawCanvas, /window\.addEventListener\("pointermove"/);
assert.match(piloTldrawCanvas, /closest\("\.canvas-trash-drop-zone"\)/);
assert.match(piloTldrawCanvas, /window\.addEventListener\("pointerup"/);
assert.match(piloTldrawCanvas, /window\.requestAnimationFrame\(\(\) => \{/);
assert.match(piloTldrawCanvas, /collectRemoteBusyShapeIds/);
assert.match(piloTldrawCanvas, /collectRemoteSelectedShapeIds/);
assert.match(piloTldrawCanvas, /filterUnlockedShapeIds/);
assert.match(piloTldrawCanvas, /entry\.selectedShapeIds\.forEach\(\(shapeId\)/);
assert.match(piloTldrawCanvas, /presence\?\.remoteShapePreviews\.forEach/);
assert.match(piloTldrawCanvas, /CANVAS_COLLABORATION_GUARD_MESSAGE/);
assert.match(piloTldrawCanvas, /showCollaborationNotice/);
assert.match(piloTldrawCanvas, /getShapeInteractionLockIds/);
assert.match(piloTldrawCanvas, /requestedShapeLockIdsRef\.current = nextLockShapeIds/);
assert.match(piloTldrawCanvas, /localPreviewShapeIdsRef\.current = nextShapeIds/);
assert.match(piloTldrawCanvas, /CANVAS_PENDING_PREVIEW_GROUP_TTL_MS = 30_000/);
assert.match(piloTldrawCanvas, /CANVAS_PENDING_PREVIEW_HEARTBEAT_MS = 1_500/);
assert.match(piloTldrawCanvas, /CANVAS_REMOTE_PREVIEW_DELETE_GRACE_MS = 8_000/);
assert.match(piloTldrawCanvas, /PendingRealtimePreviewGroup/);
assert.match(piloTldrawCanvas, /registerPendingRealtimePreviewGroup/);
assert.match(piloTldrawCanvas, /collectPendingPreviewGroupShapes/);
assert.match(piloTldrawCanvas, /isShapeHiddenByCollapsedAncestor/);
assert.match(piloTldrawCanvas, /previewDeleteGraceSinceRef/);
assert.match(piloTldrawCanvas, /remoteBusyShapeIdsRef/);
assert.match(piloTldrawCanvas, /remoteDeleteBlockedShapeIdsRef/);
assert.match(
  piloTldrawCanvas,
  /deleteSelectedShapes\(editor, remoteDeleteBlockedShapeIdsRef\.current\)/,
);
assert.match(piloTldrawCanvas, /isPiloErasableShape/);
assert.match(piloTldrawCanvas, /shape\.type === "draw" \|\| shape\.type === "highlight"/);
assert.match(piloTldrawCanvas, /activatePiloEraserWithShortcut/);
assert.match(piloTldrawCanvas, /event\.key\.toLowerCase\(\) !== "e"/);
assert.match(piloTldrawCanvas, /cancelPiloEraserWithEscape/);
assert.match(piloTldrawCanvas, /event\.key !== "Escape"/);
assert.match(piloTldrawCanvas, /deactivatePiloEraser\(\)/);
assert.match(piloTldrawCanvas, /erasePiloDrawShapeAtScreenPoint/);
assert.match(piloTldrawCanvas, /isPiloEraserActive/);
assert.match(piloTldrawCanvas, /is-pilo-eraser-active/);
assert.doesNotMatch(piloTldrawCanvas, /editor\.setCurrentTool\("eraser"\)/);
assert.match(piloTldrawCanvas, /history: "ignore"/);
assert.match(piloTldrawCanvas, /SelectedGroupToolbar/);
assert.doesNotMatch(piloTldrawCanvas, /PiloCanvasSmartGuides/);
assert.doesNotMatch(piloTldrawCanvas, /applyPiloSmartSnap/);
assert.doesNotMatch(piloTldrawCanvas, /SmartGuidesOverlay/);
assert.match(piloTldrawCanvas, /cameraRestoreVersion/);
assert.match(piloTldrawCanvas, /resetFreeformShapes\(/);
assert.match(piloTldrawCanvas, /preserveLocalState/);
assert.match(piloTldrawCanvas, /editor\.getEditingShapeId\(\)/);
assert.match(piloTldrawCanvas, /editor\.setEditingShape\(editingShapeId\)/);
assert.match(piloTldrawCanvas, /editor\.setSelectedShapes\(nextSelectedShapeIds\)/);
assert.match(piloTldrawCanvas, /CanvasLocalInteractionReporter/);
assert.match(piloTldrawCanvas, /getProtectedLocalShapeIds/);
assert.match(piloTldrawCanvas, /onLocalInteractionStateChange/);
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
assert.match(piloTldrawCanvas, /onFrameChildrenRequest/);
assert.match(piloTldrawCanvas, /onFrameChildShapesUnload/);
assert.match(piloTldrawCanvas, /collectFrameDescendantShapes/);
assert.match(piloTldrawCanvas, /onFreeformShapesChange\(nextFreeformShapes\)/);
assert.match(piloTldrawCanvas, /PiloCollapsedFrameOverlay/);
assert.match(piloTldrawCanvas, /onViewportBoundsChange/);
assert.match(piloTldrawCanvas, /placePiloCanvasShapeAt/);
assert.doesNotMatch(piloTldrawCanvas, /createCanvasShapeSyncQueue/);
assert.doesNotMatch(piloTldrawCanvas, /writeCanvasStorage\(/);
assert.match(piloCanvasStateReporter, /onFreeformShapesChange/);
assert.match(piloCanvasStateReporter, /onFreeformShapesDraftChange/);
assert.match(piloCanvasStateReporter, /onViewChange/);
assert.match(piloCanvasStateReporter, /getViewportPageBounds/);
assert.match(piloCanvasStateReporter, /withSerializedArrowBindings/);
assert.match(piloCanvasStateReporter, /withPiloMediaAsset/);
assert.match(piloCanvasStateReporter, /onResolveFreeformShapeSnapshot/);
assert.match(piloCanvasStateReporter, /source:\s*"user"/);
assert.match(piloTldrawCanvas, /mergeRemoteChanges/);
assert.match(piloTldrawCanvas, /CANVAS_SHAPE_LOCK_RELEASE_GRACE_MS/);
assert.match(piloTldrawCanvas, /scheduleShapeLockRelease/);
assert.match(piloTldrawCanvas, /cancelScheduledShapeLockRelease/);
assert.match(piloCanvasArrowBindings, /piloArrowBindingsV1/);
assert.match(piloCanvasArrowBindings, /getBindingsInvolvingShape\(shape\.id, "arrow"\)/);
assert.match(piloCanvasArrowBindings, /editor\.createBindings/);
assert.match(piloCanvasArrowBindings, /removeStaleSerializedArrowBindings/);
assert.match(piloCanvasArrowBindings, /editor\.deleteBindings\(staleBindings\)/);
assert.match(piloCanvasArrowBindings, /pending/);
assert.doesNotMatch(piloCanvasArrowBindings, /fetch\(/);
assert.doesNotMatch(piloCanvasArrowBindings, /src\/shared\/tldraw/);
assert.match(piloCanvasTypes, /export type PiloCanvasFreeformShape/);
assert.match(piloCanvasTypes, /export type PiloCanvasLocalInteractionState/);
assert.match(piloCanvasTypes, /protectedShapeIds: string\[\]/);
assert.match(piloCanvasTypes, /export type PiloCanvasViewSetting/);
assert.match(piloCanvasTypes, /export type PiloCanvasViewportBounds/);
assert.match(piloCanvasTypes, /export type PiloCanvasShapeDetailRequest/);
assert.match(canvasRuntime, /localInteractionStateRef/);
assert.match(canvasRuntime, /isRemoteOperationProtectedByLocalInteraction/);
assert.match(canvasRuntime, /queueDeferredRemoteOperation\(/);
assert.match(canvasRuntime, /handleShapeSyncConflict/);
assert.match(canvasRuntime, /readConflictLatestFreeformShape/);
assert.match(canvasRuntime, /onShapeSyncConflict: handleShapeSyncConflict/);
assert.match(canvasRuntime, /onLocalInteractionStateChange=\{handleLocalInteractionStateChange\}/);
assert.match(canvasRuntimeHydration, /normalizeCanvasFreeformShapes/);
assert.match(canvasRemoteOperations, /normalizeCanvasFreeformShapes/);
assert.match(canvasShapeSync, /rawShape: cloneRawShape\(shape\)/);
assert.match(piloCanvasAssets, /withPiloMediaAsset/);
assert.match(piloCanvasAssets, /editor\.getAsset\(assetId\)/);
assert.match(piloCanvasAssets, /piloAsset/);
assert.doesNotMatch(piloCanvasAssets, /surface\/pilo-canvas-state-reporter/);
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
assert.match(piloFrameShapeUtil, /isPiloFrameCollapsed/);
assert.match(piloFrameShapeUtil, /shouldClipChild/);
assert.match(piloFrameShapeUtil, /return false/);
assert.doesNotMatch(piloFrameSelectionToolbar, /FrameShapeUtil\.configure/);
assert.match(piloFrameSelectionToolbar, /onFrameCollapsedChange/);
assert.match(piloFrameSelectionToolbar, /FRAME_TOOLBAR_BASE_WIDTH/);
assert.match(piloFrameSelectionToolbar, /frameViewportWidth/);
assert.match(piloFrameSelectionToolbar, /scale: toolbarScale/);
assert.match(piloFrameSelectionToolbar, /topCenter\.y \+ 12 \* toolbarScale/);
assert.match(piloFrameSelectionToolbar, /translateX\(-50%\) scale/);
assert.match(piloFrameSelectionToolbar, /editor\.getShape\(selectedFrame\.id\)/);
assert.match(piloFrameSelectionToolbar, /if \(!isPiloFrameShape\(currentFrame\)\) return/);
assert.match(piloTldrawCanvas, /if \(!frameShape\.isLocked\) \{\s*return;\s*\}/);
assert.match(piloCollapsedFrameOverlay, /pilo-collapsed-frame-card/);
assert.match(piloCollapsedFrameOverlay, /pilo-collapsed-frame-expand/);
assert.match(piloCollapsedFrameOverlay, /is-selected/);
assert.match(piloCollapsedFrameOverlay, /scale\(\$\{item\.zoom\}\)/);
assert.match(piloCollapsedFrameOverlay, /handleExpandPointerDown/);
assert.match(piloCollapsedFrameOverlay, /onFrameCollapsedChange\(frame, false\)/);
assert.match(piloCollapsedFrameOverlay, /getPiloChildShapeCount/);
assert.match(piloCodeBlockShapeUtil, /BaseBoxShapeUtil/);
assert.match(piloCodeBlockShapeUtil, /isCollapsed: T\.boolean\.optional/);
assert.doesNotMatch(piloCodeBlockShapeUtil, /BaseFrameLikeShapeUtil/);
assert.doesNotMatch(piloCodeBlockShapeUtil, /@codemirror/);
assert.doesNotMatch(piloCodeBlockShapeUtil, /navigator\.clipboard/);
assert.match(piloCodeBlockComponent, /PiloCodeMirrorEditor/);
assert.match(piloCodeBlockComponent, /PILO_CODE_BLOCK_COLLAPSED_META_KEY/);
assert.match(piloCodeBlockComponent, /pilo-code-preview/);
assert.match(piloCodeBlockComponent, /isPiloCodeBlockShape/);
assert.match(piloCodeBlockComponent, /editor\.getShape\(shape\.id\)/);
assert.match(piloCodeBlockComponent, /if \(!isPiloCodeBlockShape\(currentShape\)\) return/);
assert.match(piloCodeBlockComponent, /useCanvasRemoteShapePresence/);
assert.match(piloCodeBlockComponent, /useCanvasRemoteShapeEditingPresence/);
assert.match(piloCodeBlockComponent, /isEditSoftLocked/);
assert.match(piloCodeBlockComponent, /pilo-code-remote-presence-badge/);
assert.match(piloCodeBlockComponent, /pilo-code-remote-edit-badge/);
assert.match(canvasCss, /pilo-code-remote-presence-badge/);
assert.match(canvasCss, /pilo-code-remote-edit-badge/);
assert.match(canvasCss, /is-remotely-selected/);
assert.match(canvasCss, /is-remotely-edit-locked/);
assert.match(canvasCss, /is-pilo-eraser-active/);
assert.match(canvasCss, /pilo-tldraw-canvas \.tl-canvas/);
assert.match(canvasCss, /crosshair !important/);
assert.match(piloCodeMirrorEditor, /@codemirror\/view/);
assert.match(piloCodeBlockShapeTypes, /export type PiloCodeBlockShape/);
assert.match(piloCodeBlockShapeTypes, /isCollapsed\?: boolean/);
assert.match(canvasCollapse, /piloFrameCollapsed/);
assert.match(canvasCollapse, /piloCodeBlockCollapsed/);
assert.match(canvasCollapse, /piloChildShapeCount/);
assert.match(canvasCollapse, /piloCodeBlockExpandedSize/);
assert.match(piloCanvasPlacement, /PiloPlacementRequest/);
assert.match(piloCanvasPlacement, /placePiloCanvasShapeAt/);
assert.match(piloCanvasFileImport, /PILO_CODE_IMPORT_MAX_FILES = 30/);
assert.match(piloCanvasFileImport, /PILO_CODE_IMPORT_MAX_SINGLE_FILE_BYTES = 200 \* 1024/);
assert.match(piloCanvasFileImport, /PILO_CODE_IMPORT_MAX_TOTAL_BYTES = 2 \* 1024 \* 1024/);
assert.match(piloCanvasFileImport, /PILO_CODE_IMPORT_MAX_FOLDER_DEPTH = 4/);
assert.match(piloCanvasFileImport, /webkitGetAsEntry/);
assert.match(piloCanvasFileImport, /collectDirectoryFiles/);
assert.match(piloCanvasFileImport, /createImportedCodeFolderNode/);
assert.match(piloCanvasFileImport, /folder\.folders\.push\(childFolder\)/);
assert.match(piloCanvasFileImport, /queuedFile\.folder\.files\.push\(codeFile\)/);
assert.match(piloCanvasFileImport, /pruneImportedCodeFolder/);
assert.match(piloCanvasFileImport, /ignoredFolderNames/);
assert.match(piloCanvasFileImport, /importCodeFilesFromDataTransfer/);
assert.match(piloCanvasFileImport, /inferLanguageFromShebang/);
assert.match(piloCanvasFileImport, /isProbablyBinary/);
assert.match(piloCanvasFileImport, /바이너리 파일은 제외했습니다/);
assert.match(piloCanvasFileImport, /제외 폴더입니다/);
assert.match(piloTldrawCanvas, /CanvasFileDropImporter/);
assert.match(piloTldrawCanvas, /createNote: \(\) => void/);
assert.match(piloTldrawCanvas, /editor\.setCurrentTool\("note"\)/);
assert.match(canvasWorkspace, /setActiveCanvasTool\("note"\)/);
assert.match(canvasWorkspace, /active=\{isCanvasToolActive\("note"\)\}/);
assert.match(piloTldrawCanvas, /setColor: \(color: PiloCanvasColor\) => void/);
assert.match(piloTldrawCanvas, /editor\.setStyleForNextShapes\(DefaultColorStyle, color\)/);
assert.match(piloTldrawCanvas, /editor\.setStyleForSelectedShapes\(DefaultColorStyle, color\)/);
assert.match(piloTldrawCanvas, /color === "default"/);
assert.match(piloTldrawCanvas, /stylesForNextShape/);
assert.match(canvasWorkspace, /value: "default", className: "is-default"/);
assert.match(canvasWorkspace, /color\.value === "default"/);
assert.match(canvasWorkspace, /<RotateCcw/);
assert.match(canvasWorkspace, /useState<PiloCanvasColor>\("default"\)/);
assert.doesNotMatch(piloTldrawCanvas, /pilo-sticky-note/);
assert.doesNotMatch(piloCanvasShapeUtils, /PiloStickyNoteShapeUtil/);
assert.match(piloTldrawCanvas, /event\.key\.toLowerCase\(\) !== "c"/);
assert.match(piloTldrawCanvas, /CANVAS_AI_CHAT_HOLD_MS = 500/);
assert.match(piloTldrawCanvas, /window\.addEventListener\("keydown", startCanvasAiChatWithShortcut, true\)/);
assert.match(piloTldrawCanvas, /window\.addEventListener\("keyup", cancelCanvasAiChatWithShortcut, true\)/);
assert.match(piloTldrawCanvas, /window\.requestAnimationFrame\(\s*updateHoldProgress/);
assert.match(piloTldrawCanvas, /canvasAiChatPointerRef\.current/);
assert.match(piloTldrawCanvas, /function trackCanvasAiChatPointer/);
assert.match(piloTldrawCanvas, /onPointerMoveCapture=\{handleCanvasPointerMoveCapture\}/);
assert.match(piloTldrawCanvas, /onPointerUpCapture=\{handleCanvasPointerUpCapture\}/);
assert.match(piloTldrawCanvas, /openCanvasAiChat: \(anchor: CanvasAiChatAnchor\) => void/);
assert.match(piloTldrawCanvas, /function openCanvasAiChatAt\(anchor: CanvasAiChatAnchor\)/);
assert.match(canvasWorkspace, /agentTarget="toolbar\.canvas_ai"/);
assert.match(canvasWorkspace, /onClick=\{openCanvasAiChat\}/);
assert.match(piloTldrawCanvas, /if \(currentAnchor\) return null/);
assert.doesNotMatch(piloTldrawCanvas, /onContextMenuCapture/);
assert.doesNotMatch(piloTldrawCanvas, /event\.button === 2/);
assert.match(piloTldrawCanvas, /editor\.updateInstanceState\(\{ isToolLocked: false \}\)/);
assert.match(piloTldrawCanvas, /preset === "pen" \|\| preset === "highlight"/);
assert.match(piloTldrawCanvas, /isToolLocked: shouldKeepDrawing/);
assert.match(piloTldrawCanvas, /function placePendingShapeAt/);
assert.match(piloTldrawCanvas, /onOneShotToolCreatedRef\.current\?\.\(\)/);
assert.match(piloTldrawCanvas, /const connectionTools = new Set<PiloCanvasTool>\(\["arrow", "line"\]\)/);
assert.match(piloTldrawCanvas, /!connectionTools\.has\(tool\)/);
assert.match(piloTldrawCanvas, /tool !== "text"/);
assert.match(piloTldrawCanvas, /function getArrowAtPoint/);
assert.match(piloTldrawCanvas, /getShapesAtPoint\(pagePoint/);
assert.match(piloTldrawCanvas, /getArrowAtPoint\(editor, pagePoint\) \?\? directShape/);
assert.match(piloTldrawCanvas, /currentToolId === "select" \|\| currentToolId\.startsWith\("select\."\)/);
assert.doesNotMatch(piloTldrawCanvas, /\.tl-frame-heading, \.tl-frame-heading-hit-area, \.tl-frame-label, \.tl-frame-name-input/);
assert.match(piloTldrawCanvas, /editor\.setCurrentTool\("select\.idle"\)/);
assert.match(canvasAiChatOverlay, /Canvas AI 열기 진행 중/);
assert.match(canvasAiChatOverlay, /conic-gradient/);
assert.match(canvasAiChatOverlay, /aria-label="Canvas AI 채팅"/);
assert.match(canvasAiChatOverlay, /setMessages/);
assert.match(canvasAiChatOverlay, /max-h-64/);
assert.match(canvasAiChatOverlay, /overflow-y-auto/);
assert.match(canvasAiChatOverlay, /scrollbar-width:none/);
assert.match(piloCanvasShapeFactory, /createImportedCodeFolderShapes/);
assert.match(piloCanvasShapeFactory, /createImportedCodeFolderLayout/);
assert.match(piloCanvasShapeFactory, /createFrameTree/);
assert.match(piloCanvasShapeFactory, /frame\.parentId = parentId/);
assert.match(piloCanvasShapeFactory, /frames: PiloFramePartial\[\]/);
assert.match(piloCanvasShapeFactory, /getShapeDepth/);
assert.match(piloTldrawCanvas, /createImportedCodeBlockShape/);
assert.match(piloTldrawCanvas, /createImportedCodeFolderShapes/);
assert.match(piloTldrawCanvas, /getImportedFolderCodeBlockCount/);
assert.match(piloTldrawCanvas, /topLevelFrames/);
assert.match(piloTldrawCanvas, /folderShapes\.push\(\.\.\.createdFolder\.shapes\)/);
assert.match(piloTldrawCanvas, /getImportedCodeBlockCount/);
assert.match(piloTldrawCanvas, /closest\("\.pilo-tldraw-canvas"\)/);
assert.match(piloTldrawCanvas, /stopImmediatePropagation/);
assert.match(piloTldrawCanvas, /getCodeFileDropSignature/);
assert.match(piloTldrawCanvas, /pilo-code-file-drop-overlay/);
assert.match(piloTldrawCanvas, /pilo-code-file-import-toast/);
assert.match(piloCanvasGroupToolbar, /shape\.type === "group"/);
assert.match(piloCanvasGroupToolbar, /editor\.ungroupShapes/);
assert.match(piloCanvasGroupToolbar, /LockOpen/);
assert.match(routes, /as default/);
assert.doesNotMatch(routes, /MainShell/);
assert.doesNotMatch(pages, /MainShell/);
assert.match(pages, /Panel/);

function createScenarioShape(id, value = 0) {
  return {
    id,
    type: "geo",
    x: value,
    y: value,
    props: {
      h: 100,
      w: 100
    }
  };
}

function shapeMap(shapes) {
  return new Map(shapes.map((shape) => [shape.id, shape]));
}

function createScenarioSyncOperations(previousShapes, nextShapes) {
  const previousShapeMap = shapeMap(previousShapes);
  const nextShapeMap = shapeMap(nextShapes);
  const operations = [];

  nextShapes.forEach((shape) => {
    const previousShape = previousShapeMap.get(shape.id);

    if (!previousShape) {
      operations.push({
        shapeId: shape.id,
        type: "create",
        payload: shape
      });
      return;
    }

    if (JSON.stringify(previousShape) !== JSON.stringify(shape)) {
      operations.push({
        shapeId: shape.id,
        type: "update",
        payload: shape
      });
    }
  });

  previousShapes.forEach((shape) => {
    if (nextShapeMap.has(shape.id)) return;

    operations.push({
      shapeId: shape.id,
      type: "delete"
    });
  });

  return operations;
}

function mergeScenarioQueuedOperation(pendingOperations, operation) {
  const pendingOperation = pendingOperations.get(operation.shapeId);

  if (!pendingOperation) {
    pendingOperations.set(operation.shapeId, operation);
    return;
  }

  if (operation.type === "create") {
    pendingOperations.set(
      operation.shapeId,
      pendingOperation.type === "create"
        ? operation
        : {
            shapeId: operation.shapeId,
            type: "update",
            payload: operation.payload
          }
    );
    return;
  }

  if (operation.type === "update") {
    pendingOperations.set(
      operation.shapeId,
      pendingOperation.type === "create"
        ? {
            shapeId: operation.shapeId,
            type: "create",
            payload: operation.payload
          }
        : operation
    );
    return;
  }

  if (pendingOperation.type === "create") {
    pendingOperations.delete(operation.shapeId);
    return;
  }

  pendingOperations.set(operation.shapeId, operation);
}

function applyScenarioRemoteOperation(state, operation) {
  if (operation.type === "delete") {
    state.deletedShapeIds.add(operation.shapeId);
    state.cache.delete(operation.shapeId);
    state.unloadedShapeIds.delete(operation.shapeId);
    state.shapes = state.shapes.filter((shape) => shape.id !== operation.shapeId);
    return;
  }

  if (state.deletedShapeIds.has(operation.shapeId)) {
    return;
  }

  const nextShape = operation.payload ?? createScenarioShape(operation.shapeId);
  const existingIndex = state.shapes.findIndex((shape) => shape.id === operation.shapeId);
  state.cache.set(operation.shapeId, nextShape);

  if (existingIndex >= 0) {
    state.shapes = state.shapes.map((shape) =>
      shape.id === operation.shapeId ? nextShape : shape
    );
    return;
  }

  state.shapes = [...state.shapes, nextShape];
}

function mergeScenarioLoadedShapes(state, loadedShapes) {
  loadedShapes.forEach((shape) => {
    if (state.deletedShapeIds.has(shape.id)) return;

    const existingIndex = state.shapes.findIndex((currentShape) => currentShape.id === shape.id);
    state.cache.set(shape.id, shape);

    if (existingIndex >= 0) {
      state.shapes = state.shapes.map((currentShape) =>
        currentShape.id === shape.id ? shape : currentShape
      );
      return;
    }

    state.shapes = [...state.shapes, shape];
  });
}

function buildScenarioPersistableShapes(state) {
  const nextShapeMap = shapeMap(state.shapes);

  state.unloadedShapeIds.forEach((shapeId) => {
    if (state.deletedShapeIds.has(shapeId)) return;

    const cachedShape = state.cache.get(shapeId);

    if (cachedShape) {
      nextShapeMap.set(shapeId, cachedShape);
    }
  });

  return Array.from(nextShapeMap.values());
}

function canvasApiError(status) {
  return Object.assign(new Error(`Canvas API ${status}`), { status });
}

async function runScenarioBatchFallback(operations, runBatch) {
  try {
    await runBatch(operations);
    return;
  } catch (error) {
    if (error.status !== 404 || operations.length <= 1) {
      throw error;
    }
  }

  for (const operation of operations) {
    try {
      await runBatch([operation]);
    } catch (error) {
      if (error.status === 404 && operation.type !== "create") {
        continue;
      }

      throw error;
    }
  }
}

{
  const pendingOperations = new Map();
  mergeScenarioQueuedOperation(pendingOperations, {
    shapeId: "shape:1",
    type: "create",
    payload: createScenarioShape("shape:1", 1)
  });
  mergeScenarioQueuedOperation(pendingOperations, {
    shapeId: "shape:1",
    type: "update",
    payload: createScenarioShape("shape:1", 2)
  });
  assert.deepEqual(Array.from(pendingOperations.values()), [
    {
      shapeId: "shape:1",
      type: "create",
      payload: createScenarioShape("shape:1", 2)
    }
  ]);
}

{
  const pendingOperations = new Map();
  mergeScenarioQueuedOperation(pendingOperations, {
    shapeId: "shape:1",
    type: "create",
    payload: createScenarioShape("shape:1", 1)
  });
  mergeScenarioQueuedOperation(pendingOperations, {
    shapeId: "shape:1",
    type: "delete"
  });
  assert.equal(pendingOperations.size, 0);
}

{
  const pendingOperations = new Map();
  mergeScenarioQueuedOperation(pendingOperations, {
    shapeId: "shape:1",
    type: "update",
    payload: createScenarioShape("shape:1", 2)
  });
  mergeScenarioQueuedOperation(pendingOperations, {
    shapeId: "shape:1",
    type: "delete"
  });
  assert.deepEqual(Array.from(pendingOperations.values()), [
    {
      shapeId: "shape:1",
      type: "delete"
    }
  ]);
}

{
  const operations = createScenarioSyncOperations(
    [createScenarioShape("shape:1", 1), createScenarioShape("shape:2", 1)],
    [createScenarioShape("shape:1", 2), createScenarioShape("shape:3", 1)]
  );
  assert.deepEqual(
    operations.map((operation) => `${operation.type}:${operation.shapeId}`),
    ["update:shape:1", "create:shape:3", "delete:shape:2"]
  );
}

{
  const state = {
    cache: new Map([["shape:1", createScenarioShape("shape:1", 1)]]),
    deletedShapeIds: new Set(),
    shapes: [createScenarioShape("shape:1", 1)],
    unloadedShapeIds: new Set()
  };

  applyScenarioRemoteOperation(state, {
    shapeId: "shape:1",
    type: "delete"
  });
  applyScenarioRemoteOperation(state, {
    shapeId: "shape:1",
    type: "update",
    payload: createScenarioShape("shape:1", 2)
  });
  mergeScenarioLoadedShapes(state, [createScenarioShape("shape:1", 3)]);
  assert.deepEqual(state.shapes, []);
  assert.equal(state.deletedShapeIds.has("shape:1"), true);
  assert.equal(state.cache.has("shape:1"), false);
}

{
  const state = {
    cache: new Map([["shape:child", createScenarioShape("shape:child", 1)]]),
    deletedShapeIds: new Set(["shape:child"]),
    shapes: [],
    unloadedShapeIds: new Set(["shape:child"])
  };

  assert.deepEqual(buildScenarioPersistableShapes(state), []);
}

{
  const sentOperations = [];
  const operations = [
    { shapeId: "shape:stale-update", type: "update" },
    { shapeId: "shape:new", type: "create" },
    { shapeId: "shape:stale-delete", type: "delete" },
    { shapeId: "shape:move", type: "update" }
  ];

  await runScenarioBatchFallback(operations, async (batchOperations) => {
    if (batchOperations.length > 1) {
      throw canvasApiError(404);
    }

    const [operation] = batchOperations;

    if (operation.shapeId.includes("stale")) {
      throw canvasApiError(404);
    }

    sentOperations.push(operation);
  });
  assert.deepEqual(sentOperations, [
    { shapeId: "shape:new", type: "create" },
    { shapeId: "shape:move", type: "update" }
  ]);
}

{
  await assert.rejects(
    () =>
      runScenarioBatchFallback(
        [{ shapeId: "shape:create-missing", type: "create" }],
        async () => {
          throw canvasApiError(404);
        }
      ),
    /Canvas API 404/
  );
}

await import("./calendar/test.mjs");
await import("../src/features/agent/agent-feature.test.mjs");
await import("./github-integration/test.mjs");
await import("../src/features/board/board-feature.test.mjs");
await import("../src/features/board/board-load.test.mjs");
await import("./meeting/test.mjs");
await import("./pr-review/test.mjs");
await import("./pr-review-decision-realtime.test.mjs");
await import("./sql-erd/test.mjs");
await import("./sql-erd-realtime.test.mjs");
await import("../src/shared/page-cursor/page-cursor.test.mjs");
await import("../src/features/workspace-onboarding/github-onboarding.test.mjs");
