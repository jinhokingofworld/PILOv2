import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
const rootReadme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const canvasReadme = await readFile(
  new URL("../src/canvas/README.md", import.meta.url),
  "utf8"
);
const config = await readFile(
  new URL("../src/config/realtime-config.ts", import.meta.url),
  "utf8"
);
const sessionService = await readFile(
  new URL("../src/auth/session.service.ts", import.meta.url),
  "utf8"
);
const canvasAccess = await readFile(
  new URL("../src/canvas/room/canvas-access.service.ts", import.meta.url),
  "utf8"
);
const canvasRoom = await readFile(
  new URL("../src/canvas/room/canvas-room.service.ts", import.meta.url),
  "utf8"
);
const canvasRoomCheckpoint = await readFile(
  new URL(
    "../src/canvas/checkpoint/canvas-room-checkpoint.service.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasRoomStateSource = await readFile(
  new URL("../src/canvas/state/canvas-room-state.service.ts", import.meta.url),
  "utf8"
);
const canvasLoadedRegion = await readFile(
  new URL("../src/canvas/state/canvas-loaded-region.ts", import.meta.url),
  "utf8"
);
const canvasShapeRecord = await readFile(
  new URL("../src/canvas/state/canvas-shape-record.ts", import.meta.url),
  "utf8"
);
const canvasRoomState = [
  canvasRoomStateSource,
  canvasLoadedRegion,
  canvasShapeRecord
].join("\n");
const canvasPresence = await readFile(
  new URL("../src/canvas/presence/canvas-presence.service.ts", import.meta.url),
  "utf8"
);
const canvasShapeLock = await readFile(
  new URL(
    "../src/canvas/review-lock/canvas-shape-lock.service.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasShapePreview = await readFile(
  new URL(
    "../src/canvas/preview/canvas-shape-preview.service.ts",
    import.meta.url
  ),
  "utf8"
);
const canvasSocketHandlers = await readFile(
  new URL("../src/canvas/socket/canvas-socket-handlers.ts", import.meta.url),
  "utf8"
);
const canvasSocketPayloads = await readFile(
  new URL("../src/canvas/socket/canvas-socket-payloads.ts", import.meta.url),
  "utf8"
);
const meetingAccess = await readFile(
  new URL("../src/meeting/meeting-access.service.ts", import.meta.url),
  "utf8"
);
const meetingEvents = await readFile(
  new URL("../src/meeting/meeting-socket-events.ts", import.meta.url),
  "utf8"
);
const redisPubSub = await readFile(
  new URL("../src/redis/redis-pubsub.ts", import.meta.url),
  "utf8"
);
const socketServerSource = await readFile(
  new URL("../src/socket/socket-server.ts", import.meta.url),
  "utf8"
);
const socketServer = [
  socketServerSource,
  canvasSocketHandlers,
  canvasSocketPayloads
].join("\n");

assert.match(config, /notifications_status_only/);
assert.match(config, /DATABASE_URL/);
assert.match(config, /APP_SERVER_URL/);
assert.match(config, /SOCKET_IO_CORS_ORIGIN/);
assert.match(server, /\/health/);
assert.match(server, /classic_room_state/);
assert.match(server, /getCanvasRoomStateStats/);
assert.match(server, /pathname\.startsWith\("\/ws\/"\)/);
assert.match(server, /pathname\.startsWith\("\/socket\.io\/"\)/);
assert.match(server, /type: "ready"/);

assert.match(rootReadme, /Common realtime code belongs/);
assert.match(rootReadme, /DATABASE_URL/);
assert.match(canvasReadme, /Bearer token is validated against `user_sessions`/);
assert.match(canvasReadme, /Long-term presence storage/);

assert.match(sessionService, /UPDATE user_sessions/);
assert.match(sessionService, /token_hash = \$1/);
assert.match(sessionService, /expires_at > now\(\)/);
assert.match(sessionService, /revoked_at IS NULL/);

assert.match(canvasAccess, /JOIN workspace_members wm/);
assert.match(canvasAccess, /c\.board_type = 'freeform'/);
assert.match(canvasAccess, /c\.board_type = 'review'/);
assert.match(canvasAccess, /review_room\.status IN \('active', 'completed'\)/);
assert.match(canvasAccess, /wm\.user_id = \$3/);
assert.match(canvasRoom, /getCanvasRoomAccess/);
assert.match(canvasRoom, /appServerUrl/);
assert.match(canvasRoom, /hydrateInitialViewportIfNeeded/);
assert.match(canvasRoom, /\/shapes\?/);
assert.match(canvasRoom, /recordLoadedViewport\(room, bounds, shapes\)/);
assert.match(canvasRoom, /readOnly: access\.readOnly/);

assert.match(socketServer, /validateSessionToken/);
assert.match(socketServer, /canvasClientEvents\.join/);
assert.match(socketServer, /canvasRoomsByName/);
assert.match(socketServer, /canvasServerEvents\.presenceUpdate/);
assert.match(socketServer, /emit\(canvasServerEvents\.presenceUpdate, presence\)/);
assert.doesNotMatch(socketServer, /presence,\s*[\r\n]\s*workspaceId/);
assert.match(socketServer, /room_not_joined/);
assert.match(socketServer, /isCanvasPresenceViewport/);
assert.match(socketServer, /isCanvasPresenceEditingMode/);
assert.match(socketServer, /editingShapeId/);
assert.match(socketServer, /editingMode/);
assert.match(socketServer, /isIsoDateString/);
assert.match(socketServer, /createSocketIoRedisAdapter/);
assert.match(socketServer, /CANVAS_OPERATION_REDIS_CHANNEL = "canvas:operations"/);
assert.match(socketServer, /isCanvasShapeOperationPayload/);
assert.match(socketServer, /canvasServerEvents\.operation/);
assert.doesNotMatch(socketServer, /canvasClientEvents\.shapeLockClaim/);
assert.doesNotMatch(socketServer, /canvasClientEvents\.shapeLockRelease/);
assert.match(socketServer, /canvasClientEvents\.shapePatch/);
assert.match(
  socketServer,
  /shapePreviewService\s*\.clearRoomPreview\(\s*socket\.id,\s*actorUserId,\s*patchPayload,\s*patchedShapeIds,/,
);
assert.match(socketServer, /canvasClientEvents\.historyUndo/);
assert.match(socketServer, /canvasClientEvents\.historyRedo/);
assert.doesNotMatch(socketServer, /canvasClientEvents\.shapeCommit/);
assert.match(socketServer, /canvasClientEvents\.shapePreview/);
assert.match(socketServer, /canvasClientEvents\.shapePreviewClear/);
assert.match(socketServer, /canvasClientEvents\.viewportLoaded/);
assert.match(socketServer, /readCanvasLoadedViewportBounds/);
assert.match(socketServer, /initialViewportBounds/);
assert.match(socketServer, /canvasServerEvents\.shapesHydrate/);
assert.match(socketServer, /canvasServerEvents\.shapePatch/);
assert.match(socketServer, /io\.to\(roomName\)\.emit\(canvasServerEvents\.shapePatch/);
assert.match(socketServer, /historySeq: historyState\.historySeq/);
assert.match(socketServer, /canUndo: historyState\.canUndo/);
assert.match(socketServer, /canRedo: historyState\.canRedo/);
assert.match(socketServer, /canvasServerEvents\.checkpoint/);
assert.match(
  socketServer,
  /const actorUserId = socket\.data\.auth\.userId \?\? socket\.id/,
);
assert.doesNotMatch(socketServer, /canvasServerEvents\.shapeLockAccepted/);
assert.doesNotMatch(socketServer, /canvasServerEvents\.shapeLockRejected/);
assert.doesNotMatch(socketServer, /canvasServerEvents\.shapeLockUpdate/);
assert.match(socketServer, /canvasServerEvents\.shapePreview/);
assert.match(socketServer, /canvasServerEvents\.shapePreviewClear/);
assert.match(socketServer, /createCanvasShapePreviewService/);
assert.match(socketServer, /createCanvasRoomStateService/);
assert.match(socketServer, /getCanvasRoomStateStats/);
assert.match(socketServer, /createCanvasRoomCheckpointService/);
assert.match(socketServer, /roomCheckpointService\.scheduleCheckpoint/);
assert.match(socketServer, /roomCheckpointService\.flushCheckpointNow/);
assert.match(socketServer, /socket\.data\.canvasRoomsByName\.values\(\)/);
assert.match(socketServer, /socket\.data\.canvasRoomsByName\.clear\(\)/);
assert.doesNotMatch(socketServer, /createCanvasShapeCommitService/);
assert.doesNotMatch(socketServer, /clearCommitShapePreview/);
assert.doesNotMatch(socketServer, /getShapeCommitBlockedByLocks/);
assert.doesNotMatch(socketServer, /shape is locked by another user/);
assert.match(socketServer, /redisAdapter\?\.stateClient/);
assert.match(socketServer, /await shapePreviewService\.updatePreview/);
assert.match(socketServer, /await shapePreviewService\.clearRoomPreview/);
assert.match(socketServer, /shapePreviewService\.clearSocket/);
assert.match(socketServer, /assertCanvasRoomWritable/);
assert.match(socketServer, /canvas room is read-only/);
assert.match(socketServer, /redisAdapter\.subscribe/);
assert.match(socketServer, /PR_REVIEW_CONFLICT_DRAFT_REDIS_CHANNEL/);
assert.match(socketServer, /pr-review:conflict-draft:lock:claim/);
assert.match(socketServer, /PR_REVIEW_CONFLICT_DRAFT_LOCK_RELEASED_EVENT/);
assert.match(socketServer, /MEETING_REPORT_REDIS_CHANNEL = "meeting:report-events"/);
assert.match(socketServer, /MEETING_STATE_REDIS_CHANNEL = "meeting:state-events"/);
assert.match(socketServer, /meetingClientEvents\.subscribe/);
assert.match(socketServer, /meetingServerEvents\.reportUpdated/);
assert.match(socketServer, /meetingServerEvents\.stateUpdated/);
assert.match(socketServer, /createMeetingRoomName/);
assert.match(meetingAccess, /FROM workspace_members/);
assert.match(meetingAccess, /workspace_id = \$1/);
assert.match(meetingEvents, /meeting:subscribe/);
assert.match(meetingEvents, /meeting:report:updated/);
assert.match(meetingEvents, /meeting:state:updated/);
assert.match(meetingEvents, /isMeetingStateRedisEvent/);
assert.match(meetingEvents, /recording_failed/);

assert.match(canvasPresence, /clearRoomPresence/);
assert.match(canvasPresence, /clearSocket/);
assert.match(canvasPresence, /payload\.sentAt/);
assert.match(canvasPresence, /payload\.viewport/);
assert.match(canvasPresence, /payload\.editingShapeId/);
assert.match(canvasPresence, /payload\.editingMode/);
assert.match(canvasPresence, /userId: user\.userId/);
assert.match(canvasPresence, /workspaceId: payload\.workspaceId/);
assert.match(canvasShapeLock, /CANVAS_SHAPE_LOCK_TTL_MS = 8_000/);
assert.match(canvasShapeLock, /claimLocks/);
assert.match(canvasShapeLock, /clearRoomLocks/);
assert.match(canvasShapeLock, /clearSocket/);
assert.match(canvasShapeLock, /getRoomLocks/);
assert.match(canvasShapeLock, /CANVAS_SHAPE_LOCK_REDIS_PREFIX/);
assert.match(canvasShapeLock, /redisClient\.set/);
assert.match(canvasShapeLock, /ownerSocketId/);
assert.match(canvasShapeLock, /expiresAt/);
assert.match(canvasShapePreview, /CANVAS_SHAPE_PREVIEW_TTL_MS = 5_000/);
assert.match(canvasShapePreview, /CANVAS_SHAPE_PREVIEW_REDIS_PREFIX/);
assert.match(canvasShapePreview, /getRoomPreviews/);
assert.match(canvasShapePreview, /updatePreview/);
assert.match(canvasShapePreview, /clearRoomPreview/);
assert.match(canvasShapePreview, /clearSocket/);
assert.match(canvasRoomState, /MAX_ROOM_LOADED_REGIONS = 64/);
assert.match(canvasRoomState, /MAX_ROOM_CACHED_SHAPES = 2_000/);
assert.match(canvasRoomState, /MAX_ROOM_HISTORY_ITEMS = 200/);
assert.match(canvasRoomState, /evictStaleCleanRoomShapes/);
assert.match(canvasRoomState, /!dirtyShapeIds\.has\(shapeId\)/);
assert.match(canvasRoomState, /CanvasRoomStateStats/);
assert.match(canvasRoomState, /getStats\(\)/);
assert.match(canvasRoomState, /cachedShapeCount/);
assert.match(canvasRoomState, /dirtyShapeCount/);
assert.match(canvasRoomState, /mergeLoadedRegions/);
assert.match(canvasRoomState, /doRegionsOverlap/);
assert.match(canvasRoomState, /recordLoadedViewport/);
assert.match(canvasRoomState, /applyShapePatch/);
assert.match(canvasRoomState, /!options\.markDirty && tombstones\.has\(shapeId\)/);
assert.match(canvasRoomState, /if \(options\.markDirty\) \{\s*[\r\n]+\s*tombstones\.delete\(shapeId\);/);
assert.match(canvasRoomState, /getLoadedRegions/);
assert.match(canvasRoomState, /getCachedShapes/);
assert.match(canvasRoomState, /getDirtyShapeIds/);
assert.match(canvasRoomState, /getDeletedTombstones/);
assert.match(canvasRoomState, /getCheckpointSnapshot/);
assert.match(canvasRoomState, /getCheckpointState/);
assert.match(canvasRoomState, /getHistoryState/);
assert.match(canvasRoomState, /markCheckpointSucceeded/);
assert.match(canvasRoomState, /upsertRoomShapes/);
assert.match(canvasRoomState, /checkpointOperationIdsByRoom/);
assert.match(canvasRoomState, /checkpointVersionByRoom/);
assert.match(canvasRoomState, /checkpointHistorySeqByRoom/);
assert.match(canvasRoomState, /historyByRoom/);
assert.match(canvasRoomState, /redoHistoryByRoom/);
assert.match(canvasRoomState, /historySeqByRoom/);
assert.match(canvasRoomState, /recordRoomHistoryChange/);
assert.match(canvasRoomState, /undoLastHistory/);
assert.match(canvasRoomState, /redoLastHistory/);
assert.match(canvasRoomState, /createUndoPatch/);
assert.match(canvasRoomState, /createRedoPatch/);
assert.match(canvasRoomState, /readPersistedShapeMetadataById/);
assert.match(canvasRoomState, /applyPersistedShapeMetadata/);
assert.match(canvasRoomState, /readShapeRevision\(shape\)/);
assert.match(canvasRoomState, /readShapeContentHash\(shape\)/);
assert.match(canvasRoomState, /baseRevision: null/);
assert.match(canvasRoomState, /delete rawShape\.revision/);
assert.match(canvasRoomState, /delete rawShape\.contentHash/);
assert.match(canvasRoom, /loadedRegions: roomStateService\.getLoadedRegions/);
assert.match(canvasRoom, /roomShapes: roomStateService\.getCachedShapes/);
assert.match(canvasRoom, /checkpointVersion: checkpointState\.checkpointVersion/);
assert.match(canvasRoom, /historySeq: historyState\.historySeq/);
assert.match(canvasRoomCheckpoint, /checkpointVersion: checkpointState\.checkpointVersion/);
assert.match(canvasRoomCheckpoint, /historySeq: checkpointState\.historySeq/);
assert.match(
  canvasRoomCheckpoint,
  /CANVAS_CHECKPOINT_INTERVAL_MS = 5 \* 60 \* 1_000/
);
assert.match(canvasRoomCheckpoint, /SPLITTABLE_CHECKPOINT_STATUSES/);
assert.match(canvasRoomCheckpoint, /if \(timersByRoom\.has\(roomKey\)\) return/);
assert.match(canvasRoomCheckpoint, /flushCheckpointNow/);
assert.match(canvasRoomCheckpoint, /await Promise\.all\(Array\.from\(roomsByKey\.keys\(\), flushCheckpoint\)\)/);
assert.match(canvasRoomCheckpoint, /\/shapes\/batch/);
assert.match(canvasRoomCheckpoint, /Authorization: `Bearer \$\{token\}`/);
assert.match(canvasRoomCheckpoint, /onCheckpointStatus/);
assert.match(canvasRoomCheckpoint, /"saving"/);
assert.match(canvasRoomCheckpoint, /"delayed"/);
assert.match(canvasRoomCheckpoint, /"saved"/);
assert.match(canvasRoomCheckpoint, /persistOperations/);
assert.match(canvasRoomCheckpoint, /runningCheckpointsByRoom/);
assert.match(canvasRoomCheckpoint, /advanceCheckpoint/);
assert.match(redisPubSub, /createAdapter/);
assert.match(redisPubSub, /stateClient/);
assert.match(redisPubSub, /NX: true/);
assert.match(redisPubSub, /PX: options\.px/);
assert.match(redisPubSub, /subscribe\(channel/);

await import("./canvas-access.test.mjs");
await import("./sql-erd-presence.test.mjs");
await import("./sql-erd-socket-lifecycle.test.mjs");
await import("./sql-erd-operation-relay.test.mjs");
await import("./pr-review-decision-events.test.mjs");
await import("./pr-review-room-events.test.mjs");
await import("./pr-review-conflict-draft-events.test.mjs");
await import("./page-cursor.test.mjs");
await import("./github-source/test.mjs");
await import("../src/documents/document-access.service.test.mjs");
await import("../src/documents/document-hocuspocus.service.test.mjs");
await import("../src/documents/document-hocuspocus-transport.test.mjs");
await import("../src/documents/document-route-contract.test.mjs");
