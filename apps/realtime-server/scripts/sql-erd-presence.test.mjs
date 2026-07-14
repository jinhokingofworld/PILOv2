import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const access = await readFile(
  new URL("../src/sql-erd/sql-erd-access.service.ts", import.meta.url),
  "utf8",
);
const presence = await readFile(
  new URL("../src/sql-erd/sql-erd-presence.service.ts", import.meta.url),
  "utf8",
);
const room = await readFile(
  new URL("../src/sql-erd/sql-erd-room.service.ts", import.meta.url),
  "utf8",
);
const events = await readFile(
  new URL("../src/sql-erd/sql-erd-socket-events.ts", import.meta.url),
  "utf8",
);
const roomNames = await readFile(
  new URL("../src/socket/room-names.ts", import.meta.url),
  "utf8",
);
const socketServer = await readFile(
  new URL("../src/socket/socket-server.ts", import.meta.url),
  "utf8",
);

assert.match(access, /FROM sql_erd_sessions AS s/);
assert.match(access, /JOIN workspace_members AS wm/);
assert.match(access, /s\.deleted_at IS NULL/);
assert.match(access, /wm\.user_id = \$3/);
assert.match(access, /\[room\.sessionId, room\.workspaceId, context\.userId\]/);
assert.match(roomNames, /workspace:\$\{workspaceId\}:sql-erd:\$\{sessionId\}/);

assert.match(presence, /clearRoomPresence/);
assert.match(presence, /clearSocket/);
assert.match(presence, /presenceByRoom\.get\(createSqlErdRoomName\(room\)\)/);
assert.match(presence, /selectedShapeIds: payload\.selectedShapeIds/);
assert.match(presence, /tool: payload\.tool/);
assert.match(presence, /updatedAt: new Date\(\)\.toISOString\(\)/);
assert.match(room, /latestOpSeq: 0/);
assert.match(room, /presence: presenceService\.getPresence\(payload\)/);

assert.match(events, /sql-erd:join/);
assert.match(events, /sql-erd:presence:update/);
assert.match(events, /sql-erd:presence:leave/);
assert.match(socketServer, /createSqlErdAccessService/);
assert.match(socketServer, /sqlErdClientEvents\.join/);
assert.match(socketServer, /sqlErdClientEvents\.presenceUpdate/);
assert.match(socketServer, /sqlErdServerEvents\.presenceUpdate/);
assert.match(socketServer, /sqlErdServerEvents\.presenceLeave/);
assert.match(socketServer, /readSqlErdPresenceUpdatePayload/);
assert.match(socketServer, /join SQLtoERD room before sending presence/);
assert.match(socketServer, /fetchSockets\(\)/);
assert.match(socketServer, /sqlErdPresenceByRoom/);

console.log("SQLtoERD realtime presence tests passed");
