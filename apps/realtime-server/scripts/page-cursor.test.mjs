import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const typescriptCompiler = fileURLToPath(
  new URL("../node_modules/typescript/bin/tsc", import.meta.url),
);
const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

execFileSync(process.execPath, [typescriptCompiler, "-p", "tsconfig.build.json"], {
  cwd: packageRoot,
  stdio: "inherit",
});

const [
  { createPageCursorRoomName, normalizePageCursorRoomRef },
  { readPageCursorRoomRef, readPageCursorUpdatePayload },
] = await Promise.all([
  import("../dist/page-cursor/page-cursor-room.js"),
  import("../dist/page-cursor/page-cursor-payload.js"),
]);
const [socketServerSource, socketHandlers, events] = await Promise.all([
  readSource("../src/socket/socket-server.ts"),
  readSource("../src/page-cursor/page-cursor-socket-handlers.ts"),
  readSource("../src/page-cursor/page-cursor-events.ts"),
]);
const socketServer = `${socketServerSource}\n${socketHandlers}`;

const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

assert.deepEqual(
  normalizePageCursorRoomRef({
    page: "home",
    workspaceId: workspaceId.toUpperCase(),
  }),
  {
    page: "home",
    workspaceId,
  },
);
assert.deepEqual(
  normalizePageCursorRoomRef({
    boardId: "42",
    page: "board",
    workspaceId,
  }),
  {
    boardId: "42",
    page: "board",
    workspaceId,
  },
);
assert.equal(
  normalizePageCursorRoomRef({
    page: "sql-erd",
    workspaceId,
  }),
  null,
);
assert.equal(
  normalizePageCursorRoomRef({
    boardId: "0042",
    page: "board",
    workspaceId,
  }),
  null,
);
assert.equal(
  createPageCursorRoomName({
    page: "calendar",
    workspaceId,
  }),
  `workspace:${workspaceId}:page:calendar`,
);
assert.equal(
  createPageCursorRoomName({
    boardId: "42",
    page: "board",
    workspaceId,
  }),
  `workspace:${workspaceId}:page:board:42`,
);
assert.deepEqual(readPageCursorRoomRef({ page: "home", workspaceId }), {
  page: "home",
  workspaceId,
});
assert.deepEqual(
  readPageCursorUpdatePayload({
    fallback: { xRatio: 0.5, yRatio: 0.25 },
    page: "calendar",
    sentAt: "2026-07-15T00:00:00.000Z",
    target: { id: "2026-07-15", label: "7월 15일", type: "calendar_date" },
    targetPoint: { xRatio: 0.75, yRatio: 0.1 },
    workspaceId,
  }),
  {
    fallback: { xRatio: 0.5, yRatio: 0.25 },
    page: "calendar",
    sentAt: "2026-07-15T00:00:00.000Z",
    target: { id: "2026-07-15", label: "7월 15일", type: "calendar_date" },
    targetPoint: { xRatio: 0.75, yRatio: 0.1 },
    workspaceId,
  },
);
assert.equal(
  readPageCursorUpdatePayload({
    fallback: { xRatio: 1.1, yRatio: 0.25 },
    page: "home",
    target: null,
    targetPoint: null,
    workspaceId,
  }),
  null,
);

assert.match(events, /page-cursor:join/);
assert.match(events, /page-cursor:update/);
assert.match(events, /page-cursor:leave/);
assert.match(socketServer, /pageCursorClientEvents\.join/);
assert.match(socketServer, /canJoinPageCursorRoom/);
assert.match(socketServer, /getPageCursorRoomSocketPresence/);
assert.match(socketServer, /pageCursorPresenceByRoom/);
assert.match(socketServer, /room_not_joined/);

console.log("page cursor realtime behavior tests passed");
