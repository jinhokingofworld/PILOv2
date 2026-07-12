import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const typescriptCompiler = fileURLToPath(
  new URL("../../node_modules/typescript/bin/tsc", import.meta.url),
);
const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

execFileSync(process.execPath, [typescriptCompiler, "-p", "tsconfig.build.json"], {
  cwd: packageRoot,
  stdio: "inherit",
});

const [
  { createBoardAccessService },
  { createBoardInvalidationFanOut },
  { parseBoardRoomRef },
  { createBoardRoomService },
  { handleBoardJoin, registerBoardSocketHandlers },
] = await Promise.all([
  import("../../dist/board/board-access.service.js"),
  import("../../dist/board/board-invalidation-fan-out.js"),
  import("../../dist/board/board-payload.parser.js"),
  import("../../dist/board/board-room.service.js"),
  import("../../dist/board/board-socket-handlers.js"),
]);
const [boardApiContract, realtimeReadme] = await Promise.all([
  readSource("../../../../docs/api/board-api.md"),
  readSource("../../README.md"),
]);

const uppercaseWorkspaceId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const canonicalWorkspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const validRoom = {
  boardId: "42",
  workspaceId: uppercaseWorkspaceId,
};
const canonicalRoom = {
  boardId: "42",
  workspaceId: canonicalWorkspaceId,
};
const memberContext = {
  token: "session-token",
  userId: "member-user",
};

assert.deepEqual(parseBoardRoomRef(validRoom), canonicalRoom);
assert.equal(parseBoardRoomRef({ workspaceId: canonicalWorkspaceId }), null);
assert.equal(
  parseBoardRoomRef({ workspaceId: canonicalWorkspaceId, boardId: "0" }),
  null,
);
assert.equal(
  parseBoardRoomRef({ workspaceId: canonicalWorkspaceId, boardId: "0042" }),
  null,
);
assert.equal(
  parseBoardRoomRef({ workspaceId: canonicalWorkspaceId, boardId: "42.5" }),
  null,
);
assert.equal(
  parseBoardRoomRef({
    workspaceId: canonicalWorkspaceId,
    boardId: "9223372036854775808",
  }),
  null,
);
assert.deepEqual(
  parseBoardRoomRef({
    workspaceId: canonicalWorkspaceId,
    boardId: "9007199254740991",
  }),
  {
    boardId: "9007199254740991",
    workspaceId: canonicalWorkspaceId,
  },
);
assert.equal(
  parseBoardRoomRef({
    workspaceId: canonicalWorkspaceId,
    boardId: "9007199254740992",
  }),
  null,
);

assert.match(boardApiContract, /board:invalidated/);
assert.match(boardApiContract, /updatedAt/);
assert.match(boardApiContract, /Raw GitHub payload/);
assert.match(boardApiContract, /board:join/);
assert.match(boardApiContract, /board:leave/);
assert.match(boardApiContract, /board:joined/);
assert.match(boardApiContract, /board:error/);
assert.match(boardApiContract, /boardId is a positive integer string/i);
assert.match(boardApiContract, /"boardId": "42"/);
assert.match(boardApiContract, /connect_error[\s\S]*unauthenticated/i);
assert.match(
  boardApiContract,
  /board:error[\s\S]*invalid payload[\s\S]*forbidden Board join/i,
);
assert.match(boardApiContract, /workspace_members/);
assert.match(
  boardApiContract,
  /hydrate_pilo_board_from_github[\s\S]*board:invalidations/,
);
assert.match(boardApiContract, /reconnect[\s\S]*snapshot/i);
assert.match(realtimeReadme, /Board realtime events: `docs\/api\/board-api\.md`/);
assert.match(realtimeReadme, /board\//);

const databaseQueries = [];
const database = {
  async queryOne(_query, values) {
    databaseQueries.push(values);

    return values[0] === canonicalWorkspaceId &&
      values[1] === "42" &&
      values[2] === memberContext.userId
      ? { id: "42" }
      : null;
  },
};
const accessService = createBoardAccessService(database);

assert.equal(await accessService.canJoinBoard(memberContext, validRoom), true);
assert.deepEqual(databaseQueries, [[canonicalWorkspaceId, "42", "member-user"]]);
assert.equal(
  await accessService.canJoinBoard(
    { ...memberContext, userId: "non-member-user" },
    validRoom,
  ),
  false,
);

const queryCountBeforeInvalidBoard = databaseQueries.length;
assert.equal(
  await accessService.canJoinBoard(memberContext, {
    boardId: "9223372036854775808",
    workspaceId: canonicalWorkspaceId,
  }),
  false,
);
assert.equal(databaseQueries.length, queryCountBeforeInvalidBoard);

const roomService = createBoardRoomService({ accessService });
assert.deepEqual(await roomService.joinBoardRoom(memberContext, validRoom), {
  joined: true,
  payload: canonicalRoom,
  roomName: `workspace:${canonicalWorkspaceId}:board:42`,
});
assert.deepEqual(
  await roomService.joinBoardRoom(
    { ...memberContext, userId: "non-member-user" },
    validRoom,
  ),
  { joined: false, reason: "forbidden" },
);

const emitted = [];
const fanOut = createBoardInvalidationFanOut({
  emitToRoom(roomName, event, payload) {
    emitted.push({ event, payload, roomName });
  },
});

assert.equal(
  fanOut.fanOut({
    ...validRoom,
    rawGithubPayload: { private: "must-not-leak" },
    updatedAt: "2026-07-12T00:00:00.000Z",
  }),
  true,
);
assert.deepEqual(emitted, [
  {
    event: "board:invalidated",
    payload: {
      ...canonicalRoom,
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
    roomName: `workspace:${canonicalWorkspaceId}:board:42`,
  },
]);
assert.equal(
  fanOut.fanOut({
    boardId: "9223372036854775808",
    updatedAt: "2026-07-12T00:00:00.000Z",
    workspaceId: canonicalWorkspaceId,
  }),
  false,
);
assert.equal(emitted.length, 1);

function createFakeSocket() {
  const handlers = new Map();
  const emittedEvents = [];
  const joinedRooms = [];
  const leftRooms = [];

  return {
    emit(event, payload) {
      emittedEvents.push({ event, payload });
    },
    emittedEvents,
    handlers,
    async join(roomName) {
      joinedRooms.push(roomName);
    },
    joinedRooms,
    async leave(roomName) {
      leftRooms.push(roomName);
    },
    leftRooms,
    on(event, handler) {
      handlers.set(event, handler);
    },
  };
}

let malformedJoinCalls = 0;
const malformedSocket = createFakeSocket();
await assert.doesNotReject(() =>
  handleBoardJoin({
    context: memberContext,
    roomService: {
      async joinBoardRoom() {
        malformedJoinCalls += 1;
        return { joined: false, reason: "forbidden" };
      },
    },
    socket: malformedSocket,
  }, {
    boardId: "9223372036854775808",
    workspaceId: canonicalWorkspaceId,
  }),
);
assert.equal(malformedJoinCalls, 0);
assert.deepEqual(malformedSocket.joinedRooms, []);
assert.deepEqual(malformedSocket.emittedEvents, [
  {
    event: "board:error",
    payload: {
      code: "invalid_payload",
      message: "board:join payload is invalid",
    },
  },
]);

const failingSocket = createFakeSocket();
await assert.doesNotReject(() =>
  handleBoardJoin({
    context: memberContext,
    roomService: {
      async joinBoardRoom() {
        throw new Error("database connection details must not reach clients");
      },
    },
    socket: failingSocket,
  }, validRoom),
);
assert.deepEqual(failingSocket.joinedRooms, []);
assert.deepEqual(failingSocket.emittedEvents, [
  {
    event: "board:error",
    payload: {
      code: "internal_error",
      message: "board room access failed",
    },
  },
]);

const registeredSocket = createFakeSocket();
registerBoardSocketHandlers({
  context: memberContext,
  roomService,
  socket: registeredSocket,
});

const joinHandler = registeredSocket.handlers.get("board:join");
assert.equal(typeof joinHandler, "function");
await joinHandler(validRoom);
assert.deepEqual(registeredSocket.joinedRooms, [
  `workspace:${canonicalWorkspaceId}:board:42`,
]);
assert.deepEqual(registeredSocket.emittedEvents, [
  {
    event: "board:joined",
    payload: canonicalRoom,
  },
]);

console.log("board realtime behavior tests passed");
