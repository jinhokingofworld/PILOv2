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
  new URL("../src/canvas/canvas-access.service.ts", import.meta.url),
  "utf8"
);
const canvasPresence = await readFile(
  new URL("../src/canvas/canvas-presence.service.ts", import.meta.url),
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
const socketServer = await readFile(
  new URL("../src/socket/socket-server.ts", import.meta.url),
  "utf8"
);

assert.match(config, /notifications_status_only/);
assert.match(config, /DATABASE_URL/);
assert.match(config, /SOCKET_IO_CORS_ORIGIN/);
assert.match(server, /\/health/);
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
assert.match(canvasAccess, /wm\.user_id = \$3/);

assert.match(socketServer, /validateSessionToken/);
assert.match(socketServer, /canvasClientEvents\.join/);
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
assert.match(socketServer, /redisAdapter\.subscribe/);
assert.match(socketServer, /MEETING_REPORT_REDIS_CHANNEL = "meeting:report-events"/);
assert.match(socketServer, /meetingClientEvents\.subscribe/);
assert.match(socketServer, /meetingServerEvents\.reportUpdated/);
assert.match(socketServer, /createMeetingRoomName/);
assert.match(meetingAccess, /FROM workspace_members/);
assert.match(meetingAccess, /workspace_id = \$1/);
assert.match(meetingEvents, /meeting:subscribe/);
assert.match(meetingEvents, /meeting:report:updated/);

assert.match(canvasPresence, /clearRoomPresence/);
assert.match(canvasPresence, /clearSocket/);
assert.match(canvasPresence, /payload\.sentAt/);
assert.match(canvasPresence, /payload\.viewport/);
assert.match(canvasPresence, /payload\.editingShapeId/);
assert.match(canvasPresence, /payload\.editingMode/);
assert.match(canvasPresence, /userId: user\.userId/);
assert.match(canvasPresence, /workspaceId: payload\.workspaceId/);
assert.match(redisPubSub, /createAdapter/);
assert.match(redisPubSub, /subscribe\(channel/);
