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
const meetingReportJobService = await readSource(
  "../src/modules/meeting/meeting-report-job.service.ts"
);
const liveKitEgressService = await readSource(
  "../src/modules/meeting/livekit-egress.service.ts"
);
const liveKitTokenService = await readSource(
  "../src/modules/meeting/livekit-token.service.ts"
);
const workspaceMeetingConstraintMigration = await readSource(
  "../../../db/migrations/006_update_workspace_and_meeting_recording_constraints.sql"
);
const workspaceMembershipMigration = await readSource(
  "../../../db/migrations/007_create_workspace_memberships_and_invitations.sql"
);
const devTerraformMain = await readSource("../../../infra/envs/dev/main.tf");
const terraformSecretsModule = await readSource(
  "../../../infra/modules/secrets/main.tf"
);

assert.match(main, /setGlobalPrefix\("api\/v1"\)/);
assert.match(main, /enableCors/);
assert.match(main, /credentials: false/);
assert.match(main, /methods: \["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"\]/);
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
assert.match(authModule, /WorkspaceModule/);
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
assert.doesNotMatch(authService, /github_access_token_encrypted/);
assert.doesNotMatch(authService, /github_token_scope/);
assert.doesNotMatch(authService, /github_connected_at = now\(\)/);
assert.doesNotMatch(authService, /github_revoked_at = NULL/);
assert.doesNotMatch(authService, /GithubTokenEncryptionService/);
assert.match(authService, /buildGithubAuthorizeUrl/);
assert.match(authService, /WorkspaceService/);
assert.match(authService, /ensureDefaultWorkspaceForUser/);
assert.doesNotMatch(authService, /INSERT INTO workspaces \(name, owner_user_id\)/);
assert.match(authConfigService, /GOOGLE_OAUTH_CLIENT_ID/);
assert.match(authConfigService, /GITHUB_LOGIN_CLIENT_ID/);
assert.doesNotMatch(authConfigService, /GITHUB_TOKEN_ENCRYPTION_KEY/);
assert.match(authConfigService, /FRONTEND_URL/);
assert.match(oauthStateService, /createHmac\("sha256"/);
assert.match(oauthStateService, /timingSafeEqual/);
assert.match(googleOAuthClient, /openidconnect\.googleapis\.com\/v1\/userinfo/);
assert.match(githubLoginOAuthClient, /api\.github\.com\/user\/emails/);
assert.match(workspaceController, /@Controller\("workspaces"\)/);
assert.match(workspaceController, /@Get\(\)/);
assert.match(workspaceController, /@Get\(":workspaceId"\)/);
assert.match(workspaceController, /@Get\(":workspaceId\/members"\)/);
assert.match(workspaceController, /@Delete\(":workspaceId\/members\/:userId"\)/);
assert.match(workspaceController, /@Get\(":workspaceId\/invitations"\)/);
assert.match(workspaceController, /@Post\(":workspaceId\/invitations"\)/);
assert.match(workspaceController, /@Controller\("workspace-invitations"\)/);
assert.match(workspaceController, /@Post\(":invitationToken\/accept"\)/);
assert.match(workspaceService, /FROM workspace_members wm/);
assert.match(workspaceService, /JOIN workspaces w/);
assert.match(workspaceService, /WHERE wm\.user_id = \$1/);
assert.match(workspaceService, /ORDER BY wm\.joined_at ASC, w\.created_at ASC/);
assert.match(workspaceService, /assertWorkspaceAccess/);
assert.match(workspaceService, /assertWorkspaceOwnerAccess/);
assert.match(workspaceService, /ensureDefaultWorkspaceForUser/);
assert.match(workspaceService, /INSERT INTO workspaces \(name, owner_user_id\)/);
assert.match(workspaceService, /ON CONFLICT \(owner_user_id\) WHERE owner_user_id IS NOT NULL/);
assert.match(workspaceService, /INSERT INTO workspace_members/);
assert.match(workspaceService, /workspace_invitations/);
assert.match(workspaceService, /hashInvitationToken/);
assert.match(workspaceService, /accepted_by_user_id/);
assert.match(workspaceMeetingConstraintMigration, /unique_workspace_per_owner_user_id/);
assert.match(workspaceMeetingConstraintMigration, /WHERE owner_user_id IS NOT NULL/);
assert.match(workspaceMembershipMigration, /CREATE TABLE public\.workspace_members/);
assert.match(workspaceMembershipMigration, /CREATE TABLE public\.workspace_invitations/);
assert.match(workspaceMembershipMigration, /UNIQUE \(workspace_id, user_id\)/);
assert.match(workspaceMembershipMigration, /unique_pending_workspace_invitation_email/);
assert.match(workspaceMembershipMigration, /ENABLE ROW LEVEL SECURITY/);
assert.match(workspaceMembershipMigration, /ON CONFLICT \(workspace_id, user_id\) DO NOTHING/);
assert.match(canvasModule, /controllers: \[CanvasController\]/);
assert.match(canvasModule, /providers: \[CanvasService\]/);
assert.match(canvasController, /@Controller\("workspaces\/:workspaceId"\)/);
assert.match(canvasController, /@Get\("canvases"\)/);
assert.match(canvasController, /@Post\("canvases"\)/);
assert.match(canvasController, /@Get\("canvases\/:canvasId"\)/);
assert.match(canvasController, /@Get\("canvases\/:canvasId\/shapes"\)/);
assert.match(canvasController, /@Post\("canvases\/:canvasId\/shapes"\)/);
assert.match(canvasController, /@Post\("canvases\/:canvasId\/shapes\/batch"\)/);
assert.match(canvasController, /@Get\("canvas-shapes\/:shapeId"\)/);
assert.match(canvasController, /@Post\("canvases\/:canvasId\/enter"\)/);
assert.match(canvasController, /@Patch\("canvases\/:canvasId\/leave"\)/);
assert.match(canvasController, /@Put\("canvases\/:canvasId\/view-settings"\)/);
assert.match(canvasController, /@Patch\("canvas-shapes\/:shapeId"\)/);
assert.match(canvasController, /@Delete\("canvas-shapes\/:shapeId"\)/);
assert.match(canvasService, /assertWorkspaceAccess/);
assert.match(canvasService, /FROM canvas c/);
assert.match(canvasService, /INSERT INTO canvas \(workspace_id, title, board_type, created_by\)/);
assert.match(canvasService, /UPDATE canvas/);
assert.match(canvasService, /viewport_x =/);
assert.match(canvasService, /INSERT INTO canvas_freeform_shapes/);
assert.match(canvasService, /UPDATE canvas_freeform_shapes s/);
assert.match(canvasService, /listShapesInViewport/);
assert.match(canvasService, /validateViewportBounds/);
assert.match(canvasService, /getShapeDetail/);
assert.match(canvasService, /syncShapesBatch/);
assert.match(canvasService, /validateShapeBatchOperations/);
assert.match(canvasService, /MAX_CANVAS_SHAPE_BATCH_OPERATIONS = 100/);
assert.match(canvasService, /enterCanvas/);
assert.match(canvasService, /leaveCanvas/);
assert.match(canvasService, /canvas_user_states/);
assert.match(canvasService, /DELETE FROM canvas_freeform_shapes/);
assert.match(canvasService, /permanentlyDeletedShapeCount/);
assert.match(canvasService, /SET deleted_at = now\(\)/);
assert.match(canvasService, /deleted_at IS NULL/);
assert.match(meetingModule, /DatabaseModule/);
assert.match(meetingModule, /WorkspaceModule/);
assert.match(meetingModule, /LiveKitEgressService/);
assert.match(meetingModule, /LiveKitTokenService/);
assert.match(meetingModule, /MeetingReportJobService/);
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
assert.match(meetingService, /createJoinToken/);
assert.match(meetingService, /startRoomAudioOnlyEgress/);
assert.match(meetingService, /stopEgress/);
assert.match(meetingService, /INSERT INTO meeting_reports/);
assert.match(meetingService, /PROCESSING/);
assert.match(meetingService, /MeetingReportJobService/);
assert.match(meetingService, /enqueueMeetingReportJob/);
assert.match(meetingService, /jobType: "meeting_report"/);
assert.match(meetingService, /LIVEKIT_EGRESS_S3_PREFIX/);
assert.match(meetingService, /audio_file_url = NULL/);
assert.doesNotMatch(meetingService, /livekit:\s*null/);
assert.match(meetingReportJobService, /jobType: "meeting_report"/);
assert.match(meetingReportJobService, /@aws-sdk\/client-sqs/);
assert.match(meetingReportJobService, /SQSClient/);
assert.match(meetingReportJobService, /SendMessageCommand/);
assert.match(meetingReportJobService, /SQS_AI_JOBS_QUEUE_URL/);
assert.match(meetingReportJobService, /SQS_ENDPOINT/);
assert.match(meetingReportJobService, /Meeting report job queue is not configured/);
assert.match(meetingReportJobService, /Meeting report job could not be enqueued/);
assert.doesNotMatch(meetingReportJobService, /AWS_ACCESS_KEY_ID/);
assert.doesNotMatch(meetingReportJobService, /AWS_SECRET_ACCESS_KEY/);
assert.match(liveKitEgressService, /EgressClient/);
assert.match(liveKitEgressService, /startRoomCompositeEgress/);
assert.match(liveKitEgressService, /listEgress/);
assert.match(liveKitEgressService, /audioOnly:\s*true/);
assert.match(liveKitEgressService, /EGRESS_COMPLETE/);
assert.match(liveKitEgressService, /EncodedFileType\.MP3/);
assert.match(liveKitEgressService, /S3Upload/);
assert.match(liveKitEgressService, /LIVEKIT_RECORDING_MODE/);
assert.match(liveKitEgressService, /LIVEKIT_RECORDINGS_BUCKET/);
assert.match(liveKitEgressService, /LIVEKIT_WS_URL/);
assert.match(liveKitEgressService, /LIVEKIT_URL/);
assert.doesNotMatch(liveKitEgressService, /AWS_ACCESS_KEY_ID/);
assert.doesNotMatch(liveKitEgressService, /AWS_SECRET_ACCESS_KEY/);
assert.match(liveKitTokenService, /livekit-server-sdk/);
assert.match(liveKitTokenService, /TrackSource\.MICROPHONE/);
assert.match(liveKitTokenService, /canPublishData:\s*false/);
assert.match(liveKitTokenService, /canSubscribe:\s*true/);
assert.match(liveKitTokenService, /LIVEKIT_API_KEY/);
assert.match(liveKitTokenService, /LIVEKIT_API_SECRET/);
assert.match(liveKitTokenService, /LIVEKIT_URL/);
assert.match(
  terraformSecretsModule,
  /app_server_ecs_secret_names = \[[^\]]*"LIVEKIT_WS_URL"/
);
assert.match(
  terraformSecretsModule,
  /app_server_ecs_secret_names = \[[^\]]*"LIVEKIT_RECORDINGS_BUCKET"/
);
assert.match(devTerraformMain, /LIVEKIT_RECORDING_MODE\s*=\s*"room_audio_only"/);
assert.match(devTerraformMain, /LIVEKIT_EGRESS_S3_PREFIX\s*=\s*"recordings\/meetings"/);

await import("./meeting/livekit-egress.test.mjs");
await import("./auth/test.mjs");
await import("./meeting/livekit-token.test.mjs");
await import("./meeting/meeting-report-job.test.mjs");
await import("./calendar/test.mjs");
await import("./meeting/test.mjs");
await import("./github-integration/test.mjs");
await import("./pr-review/test.mjs");
await import("./board/test.mjs");
