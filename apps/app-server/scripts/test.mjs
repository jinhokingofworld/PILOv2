import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveDatabaseUrl, shouldRequireDatabaseUrl } = require(
  "../dist/database/database.service.js"
);

function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const controller = await readSource("../src/app.controller.ts");
const main = await readSource("../src/main.ts");
const service = await readSource("../src/app.service.ts");
const appModule = await readSource("../src/app.module.ts");
const apiError = await readSource("../src/common/api-error.ts");
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
const googleCalendarController = await readSource("../src/modules/calendar/google-calendar.controller.ts");
const googleCalendarSyncService = await readSource("../src/modules/calendar/google-calendar-sync.service.ts");
const googleCalendarClient = await readSource("../src/modules/calendar/google-calendar.client.ts");
const googleCalendarMigration = await readSource("../../../db/migrations/091_fix_google_calendar_sync_delivery.sql");
const appServerSecretsTerraform = await readSource("../../../infra/modules/secrets/main.tf");
const userController = await readSource("../src/modules/user/user.controller.ts");
const userService = await readSource("../src/modules/user/user.service.ts");
const settingsController = await readSource(
  "../src/modules/settings/settings.controller.ts"
);
const settingsService = await readSource(
  "../src/modules/settings/settings.service.ts"
);
const workspaceController = await readSource(
  "../src/modules/workspace/workspace.controller.ts"
);
const workspaceService = await readSource("../src/modules/workspace/workspace.service.ts");
const canvasModule = await readSource("../src/modules/canvas/canvas.module.ts");
const canvasController = await readSource(
  "../src/modules/canvas/canvas.controller.ts"
);
const canvasServiceFacade = await readSource(
  "../src/modules/canvas/canvas.service.ts"
);
const canvasBoardService = await readSource(
  "../src/modules/canvas/board/canvas-board.service.ts"
);
const canvasAccessService = await readSource(
  "../src/modules/canvas/policies/canvas-access.service.ts"
);
const canvasOperationQueryService = await readSource(
  "../src/modules/canvas/operation/canvas-operation-query.service.ts"
);
const canvasShapeCommandService = await readSource(
  "../src/modules/canvas/shape/canvas-shape-command.service.ts"
);
const canvasShapeQueryService = await readSource(
  "../src/modules/canvas/shape/canvas-shape-query.service.ts"
);
const canvasShapeCleanupService = await readSource(
  "../src/modules/canvas/infrastructure/canvas-shape-cleanup.service.ts"
);
const canvasSyncDocumentService = await readSource(
  "../src/modules/canvas/sync-document/canvas-sync-document.service.ts"
);
const canvasUserStateService = await readSource(
  "../src/modules/canvas/user-state/canvas-user-state.service.ts"
);
const canvasService = [
  canvasServiceFacade,
  canvasAccessService,
  canvasBoardService,
  canvasOperationQueryService,
  canvasShapeCleanupService,
  canvasShapeCommandService,
  canvasShapeQueryService,
  canvasSyncDocumentService,
  canvasUserStateService
].join("\n");
const canvasTypes = await readSource(
  "../src/modules/canvas/contracts/canvas.types.ts"
);
const canvasShapeValidation = await readSource(
  "../src/modules/canvas/shape/canvas-shape.validation.ts"
);
const canvasShapeMapper = await readSource(
  "../src/modules/canvas/shape/canvas-shape.mapper.ts"
);
const canvasShapeHash = await readSource(
  "../src/modules/canvas/shape/canvas-shape-hash.ts"
);
const canvasOperationPublisher = await readSource(
  "../src/modules/canvas/operation/canvas-operation-publisher.service.ts"
);
const canvasAgentRepository = await readSource(
  "../src/modules/canvas/agent/canvas-agent.repository.ts"
);
const canvasAgentActionService = await readSource(
  "../src/modules/canvas/agent/canvas-agent-action.service.ts"
);
const canvasAgentDraftService = await readSource(
  "../src/modules/canvas/agent/canvas-agent-draft.service.ts"
);
const canvasAgentConstants = await readSource(
  "../src/modules/canvas/agent/canvas-agent.constants.ts"
);
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
const liveKitWebhookController = await readSource(
  "../src/modules/meeting/livekit-webhook.controller.ts"
);
const liveKitWebhookService = await readSource(
  "../src/modules/meeting/livekit-webhook.service.ts"
);
const liveKitWebhookMigration = await readSource(
  "../../../db/migrations/032_create_livekit_webhook_deliveries.sql"
);
const workspaceMeetingConstraintMigration = await readSource(
  "../../../db/migrations/006_update_workspace_and_meeting_recording_constraints.sql"
);
const workspaceMembershipMigration = await readSource(
  "../../../db/migrations/008_create_workspace_memberships_and_invitations.sql"
);
const multiWorkspaceMigration = await readSource(
  "../../../db/migrations/035_remove_owner_workspace_unique_limit.sql"
);
const workspaceIconMigration = await readSource(
  "../../../db/migrations/036_add_workspace_icon.sql"
);
const userSettingsMigration = await readSource(
  "../../../db/migrations/052_create_user_settings_and_account_lifecycle.sql"
);
const meetingRoomsMigration = await readSource(
  "../../../db/migrations/053_create_meeting_rooms.sql"
);
const workspaceRecordingConsentsMigration = await readSource(
  "../../../db/migrations/054_create_workspace_recording_consents.sql"
);
const workspaceRecordingConsentsDataApiMigration = await readSource(
  "../../../db/migrations/055_revoke_workspace_recording_consents_data_api_access.sql"
);
const canvasShapeHashMigration = await readSource(
  "../../../db/migrations/009_canvas_shape_hash_revision_viewport_index.sql"
);
const canvasShapeOperationMigration = await readSource(
  "../../../db/migrations/013_canvas_shape_operations.sql"
);
const canvasShapeParentMigration = await readSource(
  "../../../db/migrations/016_canvas_shape_parent_relation.sql"
);
const devTerraformMain = await readSource("../../../infra/envs/dev/main.tf");
const terraformSecretsModule = await readSource(
  "../../../infra/modules/secrets/main.tf"
);
const migrationFilenames = (await readdir(
  new URL("../../../db/migrations/", import.meta.url)
)).filter((filename) => filename.endsWith(".sql"));
const migrationNumbers = migrationFilenames.map((filename) => filename.split("_", 1)[0]);

assert.equal(
  new Set(migrationNumbers).size,
  migrationNumbers.length,
  "migration file numbers must be unique"
);

assert.equal(
  resolveDatabaseUrl({
    APP_ENV: "local"
  }),
  "postgresql://pilo:pilo@localhost:5432/pilo"
);
assert.equal(
  resolveDatabaseUrl({
    NODE_ENV: "test"
  }),
  "postgresql://pilo:pilo@localhost:5432/pilo"
);
assert.equal(
  resolveDatabaseUrl({
    APP_ENV: "dev",
    DATABASE_URL: " postgresql://example.test/pilo "
  }),
  "postgresql://example.test/pilo"
);
assert.equal(shouldRequireDatabaseUrl({ APP_ENV: "dev" }), true);
assert.equal(shouldRequireDatabaseUrl({ NODE_ENV: "production" }), true);
assert.throws(
  () =>
    resolveDatabaseUrl({
      APP_ENV: "dev"
    }),
  /DATABASE_URL is required outside local app-server environments/
);

assert.match(main, /setGlobalPrefix\("api\/v1"\)/);
assert.match(main, /enableCors/);
assert.match(main, /credentials: true/);
assert.match(main, /FRONTEND_URL/);
assert.match(main, /methods: \["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"\]/);
assert.match(
  main,
  /allowedHeaders: \["Authorization", "Content-Type", "Accept", "Idempotency-Key"\]/
);
assert.match(controller, /@Get\("health"\)/);
assert.match(service, /pilo-app-server/);
assert.match(service, /status: "ok"/);
assert.match(appModule, /AuthModule/);
assert.match(appModule, /UserModule/);
assert.match(appModule, /SettingsModule/);
assert.match(appModule, /WorkspaceModule/);
assert.match(appModule, /CalendarModule/);
assert.match(appModule, /CanvasModule/);
assert.match(appModule, /MeetingModule/);
assert.match(apiError, /"CONFLICT"/);
assert.match(apiError, /"WORKSPACE_RECORDING_CONSENT_REQUIRED"/);
assert.match(apiError, /"PAYLOAD_TOO_LARGE"/);
assert.match(apiError, /export function conflict\(message: string\): ApiError/);
assert.match(apiError, /HttpStatus\.CONFLICT/);
assert.match(meetingController, /@Get\("meeting-rooms"\)/);
assert.match(meetingController, /@Post\("meeting-rooms"\)/);
assert.match(meetingController, /@Patch\("meeting-rooms\/:meetingRoomId"\)/);
assert.match(meetingController, /@Delete\("meeting-rooms\/:meetingRoomId"\)/);
assert.match(meetingController, /@Get\("meeting-rooms\/:meetingRoomId\/current"\)/);
assert.match(meetingController, /@Post\("meeting-rooms\/:meetingRoomId\/meetings"\)/);
assert.match(meetingService, /async listMeetingRooms\(/);
assert.match(meetingService, /async createMeetingRoom\(/);
assert.match(meetingService, /async updateMeetingRoom\(/);
assert.match(meetingService, /async deleteMeetingRoom\(/);
assert.match(meetingService, /async startMeetingInRoom\(/);
assert.match(meetingService, /ensureWorkspaceRecordingConsent/);
assert.match(meetingService, /assertAllActiveParticipantsHaveRecordingConsent/);
assert.match(meetingService, /workspace_recording_consents/);
assert.match(meetingService, /workspace_members\.role = 'owner'/);
assert.match(meetingService, /async getReport\(/);
assert.match(meetingService, /await this\.assertWorkspaceAccess\(currentUserId, workspaceId\);/);
assert.match(meetingService, /WHERE meetings\.workspace_id = \$1\s+AND meeting_reports\.id = \$3/);
assert.doesNotMatch(meetingService, /meeting_participants\.user_id = \$3::uuid/);
assert.match(meetingService, /assertWorkspaceOwnerAccess/);
assert.match(meetingRoomsMigration, /CREATE TABLE public\.meeting_rooms/);
assert.match(meetingRoomsMigration, /unique_active_meeting_room_key/);
assert.match(meetingRoomsMigration, /unique_active_meeting_room_name/);
assert.match(meetingRoomsMigration, /ALTER TABLE public\.meeting_rooms ENABLE ROW LEVEL SECURITY/);
assert.match(meetingRoomsMigration, /trg_workspaces_create_default_meeting_room/);
assert.match(
  workspaceRecordingConsentsMigration,
  /CREATE TABLE public\.workspace_recording_consents/
);
assert.match(
  workspaceRecordingConsentsMigration,
  /unique_workspace_recording_consent_policy/
);
assert.match(
  workspaceRecordingConsentsMigration,
  /ALTER TABLE public\.workspace_recording_consents ENABLE ROW LEVEL SECURITY/
);
assert.match(
  workspaceRecordingConsentsDataApiMigration,
  /REVOKE ALL ON TABLE public\.workspace_recording_consents/
);
assert.match(
  workspaceRecordingConsentsDataApiMigration,
  /FROM anon, authenticated, service_role/
);
assert.match(
  apiError,
  /export function payloadTooLarge\(message: string\): ApiError/
);
assert.match(apiError, /HttpStatus\.PAYLOAD_TOO_LARGE/);
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
assert.match(calendarService, /enqueueUpdatedEventInTransaction/);
assert.match(calendarService, /enqueueDeletedEventInTransaction/);
assert.match(googleCalendarController, /calendar\/google/);
assert.match(googleCalendarController, /google-sync/);
assert.match(googleCalendarSyncService, /calendar_google_sync_outbox/);
assert.match(googleCalendarSyncService, /access_type/);
assert.match(googleCalendarSyncService, /refresh/);
assert.match(googleCalendarSyncService, /CLAIM_TIMEOUT_SECONDS/);
assert.match(googleCalendarSyncService, /pg_advisory_xact_lock/);
assert.match(googleCalendarSyncService, /withAdvisoryLock/);
assert.match(googleCalendarSyncService, /pilo\$\{event\.id\}/);
assert.match(googleCalendarClient, /calendar\/v3\/calendars/);
assert.match(googleCalendarClient, /response\.status === 404 \|\| response\.status === 410/);
assert.match(googleCalendarSyncService, /google_calendar_id/);
assert.match(googleCalendarSyncService, /retryEventSync/);
assert.match(googleCalendarSyncService, /requeueFailedSyncInTransaction/);
assert.match(googleCalendarMigration, /google_calendar_id/);
assert.match(googleCalendarMigration, /google_calendar_connections/);
assert.match(appServerSecretsTerraform, /GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY/);
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
assert.doesNotMatch(authModule, /WorkspaceModule/);
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
assert.doesNotMatch(authService, /WorkspaceService/);
assert.doesNotMatch(authService, /ensureDefaultWorkspaceForUser/);
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
assert.match(workspaceController, /@Post\(\)/);
assert.match(workspaceController, /createWorkspace/);
assert.match(workspaceController, /@Get\(":workspaceId"\)/);
assert.match(workspaceController, /@Get\(":workspaceId\/members"\)/);
assert.match(workspaceController, /@Delete\(":workspaceId\/members\/:userId"\)/);
assert.match(workspaceController, /@Get\(":workspaceId\/invitations"\)/);
assert.match(workspaceController, /@Post\(":workspaceId\/invitations"\)/);
assert.match(workspaceController, /@Controller\("me\/workspace-invitations"\)/);
assert.match(workspaceController, /listCurrentUserInvitations/);
assert.match(workspaceController, /acceptCurrentUserInvitation/);
assert.match(workspaceController, /@Controller\("workspace-invitations"\)/);
assert.match(workspaceController, /@Post\(":invitationToken\/accept"\)/);
assert.match(workspaceService, /FROM workspace_members wm/);
assert.match(workspaceService, /JOIN workspaces w/);
assert.match(workspaceService, /WHERE wm\.user_id = \$1/);
assert.match(workspaceService, /ORDER BY wm\.joined_at ASC, w\.created_at ASC/);
assert.match(workspaceService, /assertWorkspaceAccess/);
assert.match(workspaceService, /assertWorkspaceOwnerAccess/);
assert.doesNotMatch(workspaceService, /ensureDefaultWorkspaceForUser/);
assert.match(workspaceService, /INSERT INTO workspaces \(name, icon, owner_user_id\)/);
assert.match(workspaceService, /database\.transaction/);
assert.doesNotMatch(workspaceService, /ON CONFLICT \(owner_user_id\)/);
assert.match(workspaceService, /INSERT INTO workspace_members/);
assert.match(workspaceService, /workspace_invitations/);
assert.match(workspaceService, /hashInvitationToken/);
assert.match(workspaceService, /accepted_by_user_id/);
assert.match(workspaceService, /listCurrentUserInvitations/);
assert.match(workspaceService, /acceptCurrentUserInvitation/);
assert.match(workspaceService, /lower\(wi\.email\) = \$1/);
assert.match(userController, /@Patch\("profile"\)/);
assert.match(userController, /@Delete\(\)/);
assert.match(userService, /INSERT INTO user_settings/);
assert.match(userService, /DELETE FROM user_settings/);
assert.match(userService, /avatar_mode/);
assert.match(settingsController, /@Controller\("me\/settings"\)/);
assert.match(settingsController, /@Get\(\)/);
assert.match(settingsController, /@Patch\(\)/);
assert.match(settingsService, /default_workspace_id/);
assert.match(settingsService, /ON CONFLICT \(user_id\) DO UPDATE/);
assert.match(workspaceController, /@Patch\(":workspaceId"\)/);
assert.match(workspaceController, /@Delete\(":workspaceId"\)/);
assert.match(workspaceService, /us\.job_title AS user_job_title/);
assert.match(workspaceService, /us\.bio AS user_bio/);
assert.match(workspaceService, /DELETE FROM workspaces WHERE id = \$1/);
assert.match(workspaceService, /other_member_exists/);
assert.match(workspaceService, /user_id <> \$2/);
assert.match(userSettingsMigration, /CREATE TABLE public\.user_settings/);
assert.match(userSettingsMigration, /ADD COLUMN deleted_at TIMESTAMPTZ/);
assert.match(
  userSettingsMigration,
  /default_landing_page IN \([\s\S]*'home'[\s\S]*'calendar'[\s\S]*'board'[\s\S]*'canvas'/
);
assert.match(workspaceMeetingConstraintMigration, /unique_workspace_per_owner_user_id/);
assert.match(workspaceMeetingConstraintMigration, /WHERE owner_user_id IS NOT NULL/);
assert.match(multiWorkspaceMigration, /DROP INDEX IF EXISTS public\.unique_workspace_per_owner_user_id/);
assert.match(multiWorkspaceMigration, /CREATE INDEX IF NOT EXISTS idx_workspaces_owner_user_id/);
assert.match(workspaceIconMigration, /ADD COLUMN icon TEXT/);
assert.match(workspaceIconMigration, /workspaces_icon_length_check/);
assert.match(workspaceMembershipMigration, /CREATE TABLE public\.workspace_members/);
assert.match(workspaceMembershipMigration, /CREATE TABLE public\.workspace_invitations/);
assert.match(workspaceMembershipMigration, /UNIQUE \(workspace_id, user_id\)/);
assert.match(workspaceMembershipMigration, /unique_pending_workspace_invitation_email/);
assert.match(workspaceMembershipMigration, /ENABLE ROW LEVEL SECURITY/);
assert.match(workspaceMembershipMigration, /ON CONFLICT \(workspace_id, user_id\) DO NOTHING/);
assert.match(canvasModule, /controllers: \[CanvasController\]/);
assert.match(canvasModule, /CanvasOperationPublisherService/);
assert.match(canvasModule, /CanvasShapeCommandService/);
assert.match(canvasModule, /CanvasShapeQueryService/);
assert.match(canvasModule, /CanvasSyncDocumentService/);
assert.match(canvasModule, /CanvasUserStateService/);
assert.match(canvasController, /@Controller\("workspaces\/:workspaceId"\)/);
assert.match(canvasController, /@Get\("canvases"\)/);
assert.match(canvasController, /@Post\("canvases"\)/);
assert.match(canvasController, /@Get\("canvases\/:canvasId"\)/);
assert.match(canvasController, /@Get\("canvases\/:canvasId\/shapes"\)/);
assert.match(canvasController, /@Get\("canvases\/:canvasId\/operations"\)/);
assert.match(canvasController, /@Post\("canvases\/:canvasId\/shapes"\)/);
assert.match(canvasController, /@Post\("canvases\/:canvasId\/shapes\/batch"\)/);
assert.match(canvasController, /@Get\("canvas-shapes\/:shapeId"\)/);
assert.match(canvasController, /@Post\("canvases\/:canvasId\/enter"\)/);
assert.match(canvasController, /@Patch\("canvases\/:canvasId\/leave"\)/);
assert.match(canvasController, /@Put\("canvases\/:canvasId\/view-settings"\)/);
assert.match(canvasController, /@Patch\("canvas-shapes\/:shapeId"\)/);
assert.match(canvasController, /@Delete\("canvas-shapes\/:shapeId"\)/);
assert.match(canvasService, /assertWorkspaceAccess/);
assert.match(canvasService, /OnModuleInit/);
assert.match(canvasService, /OnModuleDestroy/);
assert.match(canvasService, /CANVAS_SHAPE_CLEANUP_INTERVAL_MS = 10 \* 60 \* 1000/);
assert.match(canvasService, /canvasShapeCleanupInterval/);
assert.match(canvasService, /cleanupDeletedFreeformShapes/);
assert.match(canvasService, /FROM canvas c/);
assert.match(canvasService, /validateCanvasEngineType\(input\.engineType\)/);
assert.match(canvasService, /INSERT INTO canvas \(\s*workspace_id,\s*title,\s*board_type,\s*engine_type,\s*engine_version,\s*created_by\s*\)/);
assert.match(canvasService, /validateCanvasEngineConversion\(input\)/);
assert.match(canvasService, /INSERT INTO canvas \(\s*workspace_id,\s*title,\s*board_type,\s*engine_type,\s*engine_version,\s*source_canvas_id,\s*created_by\s*\)/);
assert.match(canvasService, /canvas_sync_documents/);
assert.match(canvasService, /UPDATE canvas/);
assert.match(canvasService, /viewport_x =/);
assert.match(canvasService, /INSERT INTO canvas_freeform_shapes/);
assert.match(canvasService, /UPDATE canvas_freeform_shapes s/);
assert.match(canvasService, /parent_shape_id/);
assert.match(canvasService, /child_counts\.child_shape_count/);
assert.match(canvasService, /s\.parent_shape_id IS NULL/);
assert.match(canvasService, /s\.parent_shape_id = \$2/);
assert.match(canvasService, /parent_shape_id = \$3/);
assert.match(canvasService, /content_hash/);
assert.match(canvasService, /revision = s\.revision \+ 1/);
assert.match(canvasService, /max_x >= \$2/);
assert.match(canvasService, /max_y >= \$4/);
assert.match(canvasService, /listShapesInViewport/);
assert.match(canvasService, /listOperationsAfterSeq/);
assert.match(canvasService, /canvas_shape_operations/);
assert.match(canvasService, /INSERT INTO canvas_shape_operations/);
assert.match(canvasService, /FOR UPDATE/);
assert.match(canvasService, /publishShapeOperations/);
assert.match(canvasService, /clientOperationId/);
assert.match(canvasService, /op_seq > \$3/);
assert.match(canvasService, /ORDER BY o\.op_seq ASC/);
assert.match(canvasService, /latest_op_seq/);
assert.match(canvasService, /LEFT JOIN canvas_freeform_shapes s/);
assert.match(canvasService, /s\.id IS NULL/);
assert.match(canvasService, /s\.deleted_at IS NOT NULL/);
assert.match(canvasService, /COALESCE\(s\.id, o\.shape_id\)/);
assert.match(canvasService, /jsonb_build_object\(\s*'deletedShape'/);
assert.match(canvasService, /THEN 'delete'/);
assert.match(canvasService, /validateViewportBounds/);
assert.match(canvasService, /getShapeDetail/);
assert.match(canvasService, /syncShapesBatch/);
assert.match(canvasService, /enterCanvas/);
assert.match(canvasService, /leaveCanvas/);
assert.match(canvasService, /canvas_user_states/);
assert.match(canvasService, /DELETE FROM canvas_freeform_shapes/);
assert.doesNotMatch(canvasService, /DELETE FROM canvas_freeform_shapes\s+WHERE canvas_id = \$1/);
assert.match(canvasService, /permanentlyDeletedShapeCount/);
assert.match(canvasService, /deleted_at = now\(\)/);
assert.match(canvasService, /deleted_at IS NULL/);
assert.match(canvasService, /ON CONFLICT \(id\) DO UPDATE/);
assert.match(canvasService, /deleted_at = NULL/);
assert.match(canvasService, /canvas_freeform_shapes\.deleted_at IS NOT NULL/);
assert.match(canvasTypes, /export interface CanvasShapePayload/);
assert.match(canvasTypes, /parentShapeId: string \| null/);
assert.match(canvasTypes, /childShapeCount: number/);
assert.match(canvasTypes, /export interface CanvasOperationsCatchupPayload/);
assert.match(canvasTypes, /export interface CanvasShapeOperationPayload/);
assert.match(canvasTypes, /export interface CanvasShapeOperationRow/);
assert.match(canvasTypes, /contentHash: string/);
assert.match(canvasTypes, /revision: number/);
assert.match(canvasTypes, /export interface CanvasShapeRow/);
assert.match(canvasShapeValidation, /validateShapeBatchOperations/);
assert.match(canvasShapeValidation, /validateCanvasOperationsAfterSeq/);
assert.match(canvasShapeValidation, /validateOptionalClientOperationId/);
assert.match(canvasShapeValidation, /validateOptionalParentShapeId/);
assert.match(canvasShapeValidation, /parentShapeId/);
assert.match(canvasShapeValidation, /validateOptionalBaseRevision/);
assert.match(canvasShapeValidation, /MAX_CANVAS_SHAPE_BATCH_OPERATIONS = 100/);
assert.match(canvasShapeValidation, /Canvas shapeType is invalid/);
assert.match(canvasShapeValidation, /Canvas viewport bounds query is required/);
assert.match(canvasShapeMapper, /export function mapShape/);
assert.match(canvasShapeMapper, /export function mapShapeOperation/);
assert.match(canvasShapeMapper, /attachShapeOperationMeta/);
assert.match(canvasShapeMapper, /contentHash: shape\.content_hash/);
assert.match(canvasShapeMapper, /parentShapeId: shape\.parent_shape_id/);
assert.match(canvasShapeMapper, /childShapeCount/);
assert.match(canvasShapeMapper, /revision: Number\(shape\.revision\)/);
assert.match(canvasShapeMapper, /export function mapDeletedShape/);
assert.match(canvasShapeHash, /export function computeShapeContentHash/);
assert.match(canvasShapeHash, /createHash\("sha256"\)/);
assert.match(canvasShapeHash, /\.sort\(\)/);
assert.match(canvasShapeHashMigration, /ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''/);
assert.match(canvasShapeHashMigration, /ADD COLUMN revision BIGINT NOT NULL DEFAULT 1/);
assert.match(canvasShapeHashMigration, /ADD COLUMN max_x DOUBLE PRECISION/);
assert.match(canvasShapeHashMigration, /idx_canvas_freeform_shapes_viewport_active/);
assert.match(canvasShapeHashMigration, /idx_canvas_freeform_shapes_order_active/);
assert.match(canvasOperationPublisher, /CANVAS_OPERATION_REDIS_CHANNEL = "canvas:operations"/);
assert.match(canvasOperationPublisher, /REDIS_URL/);
assert.match(canvasOperationPublisher, /publishOperation/);
assert.match(canvasAgentRepository, /async discardDraft/);
assert.match(canvasAgentRepository, /DELETE FROM canvas_agent_drafts/);
assert.doesNotMatch(canvasAgentRepository, /SET status = 'discarded'/);
assert.match(canvasAgentConstants, /코드 생성 중 오류가 났어요\. 다시 시도해 주세요\./);
assert.match(canvasAgentActionService, /Canvas Agent shape creation is disabled/);
assert.doesNotMatch(canvasAgentActionService, /shouldCreateCodeDraft/);
assert.doesNotMatch(canvasAgentActionService, /createConnectionBatch/);
assert.match(canvasAgentDraftService, /value\.fileName/);
assert.match(canvasAgentDraftService, /value\.content/);
assert.match(canvasAgentDraftService, /CANVAS_AGENT_CODE_GENERATION_FAILURE_MESSAGE/);
assert.match(canvasShapeOperationMigration, /ALTER TABLE public\.canvas/);
assert.match(canvasShapeOperationMigration, /latest_op_seq/);
assert.match(canvasShapeOperationMigration, /CREATE TABLE public\.canvas_shape_operations/);
assert.match(canvasShapeOperationMigration, /UNIQUE \(canvas_id, op_seq\)/);
assert.match(canvasShapeOperationMigration, /UNIQUE \(canvas_id, actor_user_id, client_operation_id\)/);
assert.match(canvasShapeParentMigration, /ADD COLUMN parent_shape_id TEXT/);
assert.match(canvasShapeParentMigration, /idx_canvas_freeform_shapes_parent_active/);
assert.match(canvasShapeParentMigration, /canvas_id, parent_shape_id/);
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
assert.match(meetingReportJobService, /SQS_MEETING_JOBS_QUEUE_URL/);
assert.doesNotMatch(meetingReportJobService, /SQS_AI_JOBS_QUEUE_URL/);
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
assert.match(liveKitWebhookController, /@Controller\("livekit"\)/);
assert.match(liveKitWebhookController, /@Post\("webhooks"\)/);
assert.doesNotMatch(liveKitWebhookController, /@UseGuards/);
assert.match(liveKitWebhookService, /WebhookReceiver/);
assert.match(liveKitWebhookService, /participant_left/);
assert.match(liveKitWebhookService, /participant_connection_aborted/);
assert.match(liveKitWebhookService, /livekit_webhook_deliveries/);
assert.match(liveKitWebhookMigration, /ENABLE ROW LEVEL SECURITY/);
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
await import("./meeting/livekit-webhook.test.mjs");
await import("./meeting/membership-revocation.test.mjs");
await import("./meeting/meeting-report-job.test.mjs");
await import("./calendar/test.mjs");
await import("./common/activity-log.test.mjs");
await import("./drive/document-schema.test.mjs");
await import("./drive/document-lifecycle.test.mjs");
await import("./drive/document-editor.test.mjs");
await import("./drive/document-lifecycle-mutations.test.mjs");
await import("./canvas/activity-log.test.mjs");
await import("./canvas/review-canvas-access.test.mjs");
await import("./meeting/test.mjs");
if (process.env.DATABASE_URL) {
  await import("./meeting/participant-session-postgres.test.mjs");
}
await import("./github-integration/test.mjs");
await import("./github-integration/source-webhook-reconcile.test.mjs");
await import("./pr-review/test.mjs");
await import("./board/test.mjs");
await import("./sqltoerd/test.mjs");
await import("./sqltoerd/operation-delivery.test.mjs");
await import("./sqltoerd/source-snapshot.test.mjs");
await import("./sqltoerd/operation-publisher.test.mjs");
await import("./sqltoerd/operations-v1-cutover-manifest.test.mjs");
await import("./chat/schema.test.mjs");
await import("./chat/idempotency.test.mjs");
await import("./chat/service.test.mjs");
await import("./chat/contract.test.mjs");
await import("./chat/publisher.test.mjs");
await import("./workspace/membership-revocation.test.mjs");
await import("./workspace/membership-revocation-publisher.test.mjs");
await import("./workspace/membership-revocation-outbox.test.mjs");
await import("./user/account-deletion-revocation.test.mjs");
if (process.env.CHAT_POSTGRES_TEST_URL) {
  await import("./chat/postgres.test.mjs");
}
await import("./sqltoerd/schema-generator.test.mjs");
if (process.env.DATABASE_URL) {
  await import("./sqltoerd/schema-generator-postgres.test.mjs");
}
if (process.env.MYSQL_TEST_URL) {
  await import("./sqltoerd/schema-generator-mysql.test.mjs");
}
await import("./sqltoerd/schema-mutation.test.mjs");
