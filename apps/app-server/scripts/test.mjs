import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const controller = await readSource("../src/app.controller.ts");
const main = await readSource("../src/main.ts");
const service = await readSource("../src/app.service.ts");
const appModule = await readSource("../src/app.module.ts");
const authGuard = await readSource("../src/common/auth.guard.ts");
const sessionService = await readSource("../src/common/session.service.ts");
const authModule = await readSource("../src/modules/auth/auth.module.ts");
const authController = await readSource("../src/modules/auth/auth.controller.ts");
const authService = await readSource("../src/modules/auth/auth.service.ts");
const authConfigService = await readSource(
  "../src/modules/auth/auth-config.service.ts"
);
const oauthStateService = await readSource("../src/modules/auth/oauth-state.service.ts");
const googleOAuthClient = await readSource(
  "../src/modules/auth/google-oauth.client.ts"
);
const githubLoginOAuthClient = await readSource(
  "../src/modules/auth/github-login-oauth.client.ts"
);
const calendarController = await readSource(
  "../src/modules/calendar/calendar.controller.ts"
);
const calendarModule = await readSource("../src/modules/calendar/calendar.module.ts");
const calendarService = await readSource("../src/modules/calendar/calendar.service.ts");
const userController = await readSource("../src/modules/user/user.controller.ts");
const workspaceController = await readSource(
  "../src/modules/workspace/workspace.controller.ts"
);
const workspaceService = await readSource("../src/modules/workspace/workspace.service.ts");
const canvasModule = await readSource("../src/modules/canvas/canvas.module.ts");
const canvasController = await readSource(
  "../src/modules/canvas/canvas.controller.ts"
);
const canvasService = await readSource("../src/modules/canvas/canvas.service.ts");
const meetingController = await readSource(
  "../src/modules/meeting/meeting.controller.ts"
);
const meetingModule = await readSource("../src/modules/meeting/meeting.module.ts");
const meetingService = await readSource("../src/modules/meeting/meeting.service.ts");
const workspaceMeetingConstraintMigration = await readSource(
  "../../../db/migrations/006_update_workspace_and_meeting_recording_constraints.sql"
);

assert.match(main, /setGlobalPrefix\("api\/v1"\)/);
assert.match(main, /enableCors/);
assert.match(main, /credentials: false/);
assert.match(main, /methods: \["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"\]/);
assert.match(main, /allowedHeaders: \["Authorization", "Content-Type", "Accept"\]/);
assert.match(controller, /@Get\("health"\)/);
assert.match(service, /pilo-app-server/);
assert.match(service, /status: "ok"/);
assert.match(appModule, /AuthModule/);
assert.match(appModule, /UserModule/);
assert.match(appModule, /WorkspaceModule/);
assert.match(appModule, /CalendarModule/);
assert.match(appModule, /CanvasModule/);
assert.match(appModule, /MeetingModule/);
assert.match(calendarModule, /WorkspaceModule/);
assert.match(calendarController, /@Controller\("workspaces\/:workspaceId\/calendar\/events"\)/);
assert.match(calendarController, /@UseGuards\(AuthGuard\)/);
assert.match(calendarController, /@Get\(\)/);
assert.match(calendarController, /@Get\(":eventId"\)/);
assert.match(calendarController, /@Post\(\)/);
assert.match(calendarController, /@Patch\(":eventId"\)/);
assert.match(calendarController, /@Delete\(":eventId"\)/);
assert.match(calendarService, /apiContract: "docs\/api\/calendar-api.md"/);
assert.match(calendarService, /assertWorkspaceAccess/);
assert.match(calendarService, /calendar_events/);
assert.match(calendarService, /createdByUser/);
assert.match(calendarService, /addOneHour/);
assert.match(calendarService, /const endTime = shouldNormalizeEndTime\s*\?\s*null/);
assert.match(userController, /@Controller\("me"\)/);
assert.match(userController, /@UseGuards\(AuthGuard\)/);
assert.match(authGuard, /SessionService/);
assert.doesNotMatch(authGuard, /UUID_PATTERN/);
assert.match(sessionService, /user_sessions/);
assert.match(sessionService, /token_hash = \$1/);
assert.match(sessionService, /revoked_at IS NULL/);
assert.match(sessionService, /expires_at > now\(\)/);
assert.match(sessionService, /revokeSessionToken/);
assert.match(authModule, /controllers: \[AuthController\]/);
assert.match(authModule, /GoogleOAuthClient/);
assert.match(authModule, /GithubLoginOAuthClient/);
assert.match(authController, /@Controller\("auth"\)/);
assert.match(authController, /@Post\("google\/start"\)/);
assert.match(authController, /@Get\("google\/callback"\)/);
assert.match(authController, /@Post\("github\/start"\)/);
assert.match(authController, /@Get\("github\/callback"\)/);
assert.match(authController, /@Post\("logout"\)/);
assert.match(authService, /user_sessions/);
assert.match(authService, /token_hash/);
assert.match(authService, /google_user_id/);
assert.match(authService, /github_user_id/);
assert.match(authService, /github_access_token_encrypted/);
assert.match(authService, /github_token_scope/);
assert.match(authService, /github_connected_at = now\(\)/);
assert.match(authService, /github_revoked_at = NULL/);
assert.match(authService, /GithubTokenEncryptionService/);
assert.match(authService, /buildGithubAuthorizeUrl/);
assert.match(authConfigService, /GOOGLE_OAUTH_CLIENT_ID/);
assert.match(authConfigService, /GITHUB_LOGIN_CLIENT_ID/);
assert.match(authConfigService, /GITHUB_TOKEN_ENCRYPTION_KEY/);
assert.match(authConfigService, /FRONTEND_URL/);
assert.match(oauthStateService, /createHmac\("sha256"/);
assert.match(oauthStateService, /timingSafeEqual/);
assert.match(googleOAuthClient, /openidconnect\.googleapis\.com\/v1\/userinfo/);
assert.match(githubLoginOAuthClient, /api\.github\.com\/user\/emails/);
assert.match(workspaceController, /@Controller\("workspaces"\)/);
assert.match(workspaceController, /@Get\(\)/);
assert.match(workspaceController, /@Get\(":workspaceId"\)/);
assert.match(workspaceService, /WHERE owner_user_id = \$1/);
assert.match(workspaceService, /ORDER BY created_at ASC/);
assert.match(workspaceService, /assertWorkspaceAccess/);
assert.match(authService, /ensureWorkspaceForUser/);
assert.match(authService, /INSERT INTO workspaces \(name, owner_user_id\)/);
assert.match(authService, /ON CONFLICT \(owner_user_id\) WHERE owner_user_id IS NOT NULL/);
assert.match(workspaceMeetingConstraintMigration, /unique_workspace_per_owner_user_id/);
assert.match(workspaceMeetingConstraintMigration, /WHERE owner_user_id IS NOT NULL/);
assert.match(canvasModule, /controllers: \[CanvasController\]/);
assert.match(canvasModule, /providers: \[CanvasService\]/);
assert.match(canvasController, /@Controller\("workspaces\/:workspaceId"\)/);
assert.match(canvasController, /@Get\("canvases"\)/);
assert.match(canvasController, /@Post\("canvases"\)/);
assert.match(canvasController, /@Get\("canvases\/:canvasId"\)/);
assert.match(canvasController, /@Post\("canvases\/:canvasId\/shapes"\)/);
assert.match(canvasController, /@Patch\("canvas-shapes\/:shapeId"\)/);
assert.match(canvasController, /@Delete\("canvas-shapes\/:shapeId"\)/);
assert.match(canvasService, /assertWorkspaceAccess/);
assert.match(canvasService, /FROM canvas c/);
assert.match(canvasService, /INSERT INTO canvas \(workspace_id, title, board_type, created_by\)/);
assert.match(canvasService, /INSERT INTO canvas_freeform_shapes/);
assert.match(canvasService, /UPDATE canvas_freeform_shapes s/);
assert.match(canvasService, /SET deleted_at = now\(\)/);
assert.match(canvasService, /deleted_at IS NULL/);
assert.match(meetingModule, /DatabaseModule/);
assert.match(meetingModule, /WorkspaceModule/);
assert.match(meetingController, /@Controller\("workspaces\/:workspaceId"\)/);
assert.match(meetingController, /@UseGuards\(AuthGuard\)/);
assert.match(meetingController, /@Get\("meetings\/current"\)/);
assert.match(meetingController, /@Post\("meetings"\)/);
assert.match(meetingController, /@Post\("meetings\/:meetingId\/recordings"\)/);
assert.match(meetingController, /@Post\("meetings\/:meetingId\/recordings\/:recordingId\/end"\)/);
assert.match(meetingController, /@Get\("meetings\/:meetingId\/recordings"\)/);
assert.match(meetingService, /MAIN_MEETING_ROOM/);
assert.match(meetingService, /unique_active_meeting_per_room/);
assert.match(meetingService, /INSERT INTO meetings/);
assert.match(meetingService, /INSERT INTO meeting_participants/);

await import("./calendar/test.mjs");
await import("./meeting/test.mjs");
await import("./github-integration/test.mjs");
await import("./pr-review/test.mjs");
