import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canEmitSqlErdJoined } from "../../dist/sql-erd/sql-erd-join-state.js";
import { createSqlErdMembershipRevocationHandler } from "../../dist/sql-erd/sql-erd-membership-revocation.js";
import { createSqlErdPresenceService } from "../../dist/sql-erd/sql-erd-presence.service.js";
import { sqlErdServerEvents } from "../../dist/sql-erd/sql-erd-socket-events.js";
import { createSqlErdRoomName } from "../../dist/socket/room-names.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const observerUserId = "44444444-4444-4444-8444-444444444444";
const room = {
  sessionId: "55555555-5555-4555-8555-555555555555",
  workspaceId,
};
const otherWorkspaceRoom = {
  sessionId: "66666666-6666-4666-8666-666666666666",
  workspaceId: otherWorkspaceId,
};
const validEvent = {
  version: 1,
  type: "membership.revoked",
  workspaceId,
  userId,
  occurredAt: "2026-07-17T00:00:00.000Z",
};

let nextSocketId = 1;

function createSocket(
  authUserId,
  rooms,
  { failDisconnect = false, failLeaveRoom = null } = {},
) {
  const sqlErdRoomsByName = new Map(
    rooms.map((roomRef) => [createSqlErdRoomName(roomRef), roomRef]),
  );
  const socket = {
    data: {
      auth: { userId: authUserId },
      sqlErdPresenceByRoom: {},
      sqlErdRevokedWorkspaceIds: new Set(),
      sqlErdRoomsByName,
    },
    disconnectCalls: [],
    emittedToRooms: [],
    id: `sql-erd-revocation-socket-${nextSocketId++}`,
    leaveCalls: [],
    rooms: new Set(rooms.map(createSqlErdRoomName)),
    disconnect(close) {
      socket.disconnectCalls.push(close);
      if (failDisconnect) throw new Error("adapter disconnect failed");
      socket.rooms.clear();
    },
    async leave(roomName) {
      socket.leaveCalls.push(roomName);
      if (roomName === failLeaveRoom) {
        throw new Error("adapter leave failed");
      }
      socket.rooms.delete(roomName);
    },
    to(roomName) {
      return {
        emit(event, payload) {
          socket.emittedToRooms.push({ event, payload, roomName });
        },
      };
    },
  };

  return socket;
}

function createDatabase({ failDelete = false } = {}) {
  const executeCalls = [];
  return {
    executeCalls,
    async execute(text, values) {
      executeCalls.push({ text, values });
      if (failDelete) throw new Error("database unavailable");
      return { rows: [] };
    },
  };
}

function createIo(sockets) {
  return {
    sockets: {
      sockets: new Map(sockets.map((socket) => [socket.id, socket])),
    },
  };
}

function updatePresence(presenceService, socket, presenceRoom, cursor) {
  const presence = presenceService.updatePresence(
    socket.id,
    {
      displayName: socket.data.auth.userId,
      userId: socket.data.auth.userId,
    },
    {
      ...presenceRoom,
      cursor,
      editingMode: null,
      selectedObjects: [],
      sentAt: "2026-07-17T00:00:00.000Z",
      tool: "select",
    },
  );
  socket.data.sqlErdPresenceByRoom[createSqlErdRoomName(presenceRoom)] = presence;
}

test("membership.revoked는 대상 사용자의 SQLtoERD room과 presence, source lock을 즉시 정리한다", async () => {
  const firstTab = createSocket(userId, [room, otherWorkspaceRoom]);
  const secondTab = createSocket(userId, [room]);
  const observer = createSocket(observerUserId, [room]);
  const presenceService = createSqlErdPresenceService();
  const database = createDatabase();
  const io = createIo([firstTab, secondTab, observer]);

  updatePresence(presenceService, firstTab, room, { x: 10, y: 20 });
  updatePresence(presenceService, secondTab, room, { x: 30, y: 40 });
  updatePresence(presenceService, observer, room, { x: 50, y: 60 });
  updatePresence(presenceService, firstTab, otherWorkspaceRoom, { x: 70, y: 80 });

  const handler = createSqlErdMembershipRevocationHandler({
    database,
    io,
    presenceService,
  });

  assert.equal(await handler.handle(validEvent), true);

  const roomName = createSqlErdRoomName(room);
  const otherRoomName = createSqlErdRoomName(otherWorkspaceRoom);
  for (const socket of [firstTab, secondTab]) {
    assert.equal(socket.data.sqlErdRevokedWorkspaceIds.has(workspaceId), true);
    assert.equal(socket.rooms.has(roomName), false);
    assert.equal(socket.data.sqlErdRoomsByName.has(roomName), false);
    assert.equal(socket.data.sqlErdPresenceByRoom[roomName], undefined);
  }
  assert.equal(firstTab.rooms.has(otherRoomName), true);
  assert.equal(firstTab.data.sqlErdRoomsByName.has(otherRoomName), true);
  assert.ok(firstTab.data.sqlErdPresenceByRoom[otherRoomName]);
  assert.equal(observer.rooms.has(roomName), true);
  assert.equal(observer.data.sqlErdRevokedWorkspaceIds.has(workspaceId), false);

  assert.deepEqual(
    presenceService.getPresence(room).map(({ userId }) => userId),
    [observerUserId],
  );
  assert.deepEqual(
    presenceService.getPresence(otherWorkspaceRoom).map(({ userId }) => userId),
    [userId],
  );

  const emitted = [...firstTab.emittedToRooms, ...secondTab.emittedToRooms];
  assert.deepEqual(emitted, [
    {
      event: sqlErdServerEvents.presenceLeave,
      payload: { ...room, userId },
      roomName,
    },
  ]);

  const operationRecipients = [...io.sockets.sockets.values()]
    .filter((socket) => socket.rooms.has(roomName))
    .map((socket) => socket.data.auth.userId);
  assert.deepEqual(operationRecipients, [observerUserId]);

  assert.equal(database.executeCalls.length, 1);
  assert.match(
    database.executeCalls[0].text,
    /DELETE FROM sql_erd_session_source_locks/,
  );
  assert.match(database.executeCalls[0].text, /workspace_id = \$1/);
  assert.match(database.executeCalls[0].text, /actor_user_id = \$2/);
  assert.deepEqual(database.executeCalls[0].values, [workspaceId, userId]);
});

test("중복 철회와 local socket이 없는 철회도 source lock 삭제를 포함해 멱등 처리한다", async () => {
  const database = createDatabase();
  const handler = createSqlErdMembershipRevocationHandler({
    database,
    io: createIo([]),
    presenceService: createSqlErdPresenceService(),
  });

  assert.equal(await handler.handle(validEvent), true);
  assert.equal(await handler.handle(validEvent), true);
  assert.equal(database.executeCalls.length, 2);
});

test("다른 사용자와 다른 Workspace의 SQLtoERD room은 철회 정리에서 보존한다", async () => {
  const target = createSocket(userId, [otherWorkspaceRoom]);
  const observer = createSocket(observerUserId, [room]);
  const handler = createSqlErdMembershipRevocationHandler({
    database: createDatabase(),
    io: createIo([target, observer]),
    presenceService: createSqlErdPresenceService(),
  });

  assert.equal(await handler.handle(validEvent), true);
  assert.equal(target.data.sqlErdRevokedWorkspaceIds.has(workspaceId), true);
  assert.deepEqual(target.leaveCalls, []);
  assert.deepEqual(observer.leaveCalls, []);
});

test("room leave 실패는 소켓을 강제 disconnect하고, disconnect까지 실패하면 false를 반환한다", async () => {
  const roomName = createSqlErdRoomName(room);
  const recoverable = createSocket(userId, [room], { failLeaveRoom: roomName });
  const recoverableHandler = createSqlErdMembershipRevocationHandler({
    database: createDatabase(),
    io: createIo([recoverable]),
    presenceService: createSqlErdPresenceService(),
  });

  assert.equal(await recoverableHandler.handle(validEvent), true);
  assert.deepEqual(recoverable.disconnectCalls, [true]);

  const unsafe = createSocket(userId, [room], {
    failDisconnect: true,
    failLeaveRoom: roomName,
  });
  const unsafeHandler = createSqlErdMembershipRevocationHandler({
    database: createDatabase(),
    io: createIo([unsafe]),
    presenceService: createSqlErdPresenceService(),
  });

  assert.equal(await unsafeHandler.handle(validEvent), false);
  assert.deepEqual(unsafe.disconnectCalls, [true]);
});

test("잘못된 event는 조회하지 않고, source lock 삭제 실패는 room을 정리한 뒤 false를 반환한다", async () => {
  const invalidDatabase = createDatabase();
  const invalidHandler = createSqlErdMembershipRevocationHandler({
    database: invalidDatabase,
    io: createIo([]),
    presenceService: createSqlErdPresenceService(),
  });
  assert.equal(
    await invalidHandler.handle({ ...validEvent, workspaceId: "workspace-1" }),
    false,
  );
  assert.equal(invalidDatabase.executeCalls.length, 0);

  const target = createSocket(userId, [room]);
  const failingHandler = createSqlErdMembershipRevocationHandler({
    database: createDatabase({ failDelete: true }),
    io: createIo([target]),
    presenceService: createSqlErdPresenceService(),
  });
  assert.equal(await failingHandler.handle(validEvent), false);
  assert.equal(target.rooms.has(createSqlErdRoomName(room)), false);
});

test("local socket discovery 실패에도 source lock 삭제를 시도하고 안전하지 않은 철회로 기록한다", async () => {
  const database = createDatabase();
  const io = {};
  Object.defineProperty(io, "sockets", {
    get() {
      throw new Error("adapter unavailable");
    },
  });
  const handler = createSqlErdMembershipRevocationHandler({
    database,
    io,
    presenceService: createSqlErdPresenceService(),
  });

  assert.equal(await handler.handle(validEvent), false);
  assert.equal(database.executeCalls.length, 1);
});

test("presence snapshot 대기 중 철회되면 joined 응답을 허용하지 않는다", async () => {
  const roomName = createSqlErdRoomName(room);
  const roomsByName = new Map([[roomName, room]]);
  const revokedWorkspaceIds = new Set();
  let releaseSnapshot;
  const snapshot = new Promise((resolve) => {
    releaseSnapshot = resolve;
  });

  const joinedAllowed = (async () => {
    await snapshot;
    return canEmitSqlErdJoined({
      isRoomJoined: true,
      room,
      roomName,
      roomsByName,
      revokedWorkspaceIds,
    });
  })();

  revokedWorkspaceIds.add(workspaceId);
  roomsByName.delete(roomName);
  releaseSnapshot();

  assert.equal(await joinedAllowed, false);
});

test("joined 응답은 current join과 실제 room membership이 모두 유지될 때만 허용한다", () => {
  const roomName = createSqlErdRoomName(room);
  const roomsByName = new Map([[roomName, room]]);
  const revokedWorkspaceIds = new Set();
  const input = {
    isRoomJoined: true,
    room,
    roomName,
    roomsByName,
    revokedWorkspaceIds,
  };

  assert.equal(canEmitSqlErdJoined(input), true);
  assert.equal(canEmitSqlErdJoined({ ...input, isRoomJoined: false }), false);
  assert.equal(
    canEmitSqlErdJoined({
      ...input,
      roomsByName: new Map([[roomName, { ...room }]]),
    }),
    false,
  );
  assert.equal(
    canEmitSqlErdJoined({
      ...input,
      revokedWorkspaceIds: new Set([workspaceId]),
    }),
    false,
  );
});

test("socket server는 공통 철회 event를 Chat과 SQLtoERD handler에 함께 전달한다", async () => {
  const socketServerSource = await readFile(
    new URL("../socket/socket-server.ts", import.meta.url),
    "utf8",
  );

  assert.match(socketServerSource, /createSqlErdMembershipRevocationHandler/);
  assert.match(
    socketServerSource,
    /sqlErdMembershipRevocationHandler\s*\.handle\(payload\)/,
  );
  assert.match(socketServerSource, /sqlErdRoomsByName/);
  assert.match(socketServerSource, /evictSqlErdSocketFromRooms/);
  const snapshotIndex = socketServerSource.indexOf(
    "const sqlErdPresence = await getSqlErdRoomSocketPresence",
  );
  const currentJoinCheckIndex = socketServerSource.indexOf(
    "canEmitSqlErdJoined",
    snapshotIndex,
  );
  const joinedEmitIndex = socketServerSource.indexOf(
    "socket.emit(sqlErdServerEvents.joined",
    snapshotIndex,
  );
  assert.ok(snapshotIndex >= 0);
  assert.ok(currentJoinCheckIndex > snapshotIndex);
  assert.ok(joinedEmitIndex > currentJoinCheckIndex);
});
