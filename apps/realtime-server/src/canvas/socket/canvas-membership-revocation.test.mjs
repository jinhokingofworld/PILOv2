import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCanvasRoomName } from "../../../dist/socket/room-names.js";
import { createClassicCanvasMembershipRevocationHandler } from "../../../dist/canvas/socket/canvas-membership-revocation.js";
import { assertCanvasRoomWritable } from "../../../dist/canvas/socket/canvas-socket-handlers.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const otherUserId = "44444444-4444-4444-8444-444444444444";

const revocation = {
  occurredAt: "2026-07-17T00:00:00.000Z",
  type: "membership.revoked",
  userId,
  version: 1,
  workspaceId,
};

const classicAccess = {
  boardType: "freeform",
  engineType: "classic",
  readOnly: false,
};
const reviewAccess = {
  boardType: "review",
  engineType: "classic",
  readOnly: false,
};
const tldrawSyncAccess = {
  boardType: "freeform",
  engineType: "tldraw_sync",
  readOnly: false,
};

function createSocket(id, authenticatedUserId, rooms = []) {
  const roomAccess = new Map();
  const roomsByName = new Map();
  const socket = {
    data: {
      auth: {
        displayName: "Canvas user",
        token: "session-token",
        userId: authenticatedUserId,
      },
      canvasRoomAccess: roomAccess,
      canvasRoomsByName: roomsByName,
      revokedClassicCanvasWorkspaceIds: new Set(),
    },
    disconnectCalls: [],
    emitCalls: [],
    id,
    leaveCalls: [],
    rooms: new Set([id]),
    disconnect(close) {
      socket.disconnectCalls.push(close);
    },
    emit(event, payload) {
      socket.emitCalls.push({ event, payload });
    },
    async leave(roomName) {
      socket.leaveCalls.push(roomName);
      socket.rooms.delete(roomName);
    },
  };

  for (const { access, room } of rooms) {
    const roomName = createCanvasRoomName(room);
    socket.rooms.add(roomName);
    roomAccess.set(roomName, access);
    roomsByName.set(roomName, room);
  }

  return socket;
}

function createHandler(sockets, { failLeaveRoom = null } = {}) {
  const checkpointRevocations = [];
  const clearedLocks = [];
  const clearedPresence = [];
  const clearedPreviews = [];
  const emitted = [];

  for (const socket of sockets) {
    const originalLeave = socket.leave;
    socket.leave = async (roomName) => {
      if (roomName === failLeaveRoom) {
        throw new Error("leave failed");
      }
      await originalLeave(roomName);
    };
  }

  const handler = createClassicCanvasMembershipRevocationHandler({
    emitLockReleases(payload) {
      emitted.push({ event: "lock-release", payload });
    },
    io: {
      sockets: {
        sockets: new Map(sockets.map((socket) => [socket.id, socket])),
      },
      to(roomName) {
        return {
          emit(event, payload) {
            emitted.push({ event, payload, roomName });
          },
        };
      },
    },
    presenceService: {
      clearRoomPresence(socketId, room) {
        clearedPresence.push({ room, socketId });
        return { ...room, userId };
      },
    },
    roomCheckpointService: {
      revokeRoomAuthorization(room, revokedUserId) {
        checkpointRevocations.push({
          room,
          userId: revokedUserId,
        });
      },
    },
    shapeLockService: {
      async clearRoomLocks(socketId, ownerUserId, room) {
        clearedLocks.push({ ownerUserId, room, socketId });
        return null;
      },
    },
    shapePreviewService: {
      async clearRoomPreview(socketId, ownerUserId, room) {
        clearedPreviews.push({ ownerUserId, room, socketId });
        return { ...room, actorUserId: ownerUserId, shapeIds: [] };
      },
    },
  });

  return {
    checkpointRevocations,
    clearedLocks,
    clearedPresence,
    clearedPreviews,
    emitted,
    handler,
  };
}

test("evicts only revoked user's classic Canvas rooms in the target Workspace", async () => {
  const classicRoom = { canvasId: "classic-canvas", workspaceId };
  const reviewRoom = { canvasId: "review-canvas", workspaceId };
  const tldrawSyncRoom = { canvasId: "sync-canvas", workspaceId };
  const otherWorkspaceRoom = {
    canvasId: "other-classic-canvas",
    workspaceId: otherWorkspaceId,
  };
  const revokedSocket = createSocket("revoked-tab", userId, [
    { access: classicAccess, room: classicRoom },
    { access: reviewAccess, room: reviewRoom },
    { access: tldrawSyncAccess, room: tldrawSyncRoom },
    { access: classicAccess, room: otherWorkspaceRoom },
  ]);
  const joiningSocket = createSocket("joining-tab", userId);
  const otherUserSocket = createSocket("other-user-tab", otherUserId, [
    { access: classicAccess, room: classicRoom },
  ]);
  const state = createHandler([
    revokedSocket,
    joiningSocket,
    otherUserSocket,
  ]);

  assert.equal(await state.handler.handle(revocation), true);

  const classicRoomName = createCanvasRoomName(classicRoom);
  assert.deepEqual(revokedSocket.leaveCalls, [classicRoomName]);
  assert.equal(revokedSocket.rooms.has(classicRoomName), false);
  assert.equal(revokedSocket.data.canvasRoomAccess.has(classicRoomName), false);
  assert.equal(revokedSocket.data.canvasRoomsByName.has(classicRoomName), false);
  for (const preservedRoom of [
    reviewRoom,
    tldrawSyncRoom,
    otherWorkspaceRoom,
  ]) {
    const preservedRoomName = createCanvasRoomName(preservedRoom);
    assert.equal(revokedSocket.rooms.has(preservedRoomName), true);
    assert.equal(
      revokedSocket.data.canvasRoomAccess.has(preservedRoomName),
      true,
    );
  }
  assert.equal(
    revokedSocket.data.revokedClassicCanvasWorkspaceIds.has(workspaceId),
    true,
  );
  assert.equal(
    joiningSocket.data.revokedClassicCanvasWorkspaceIds.has(workspaceId),
    true,
  );
  assert.equal(
    otherUserSocket.data.revokedClassicCanvasWorkspaceIds.has(workspaceId),
    false,
  );
  assert.deepEqual(state.checkpointRevocations, [{ room: classicRoom, userId }]);
  assert.deepEqual(
    state.clearedPresence.map(({ room }) => room),
    [classicRoom],
  );
  assert.deepEqual(
    state.clearedPreviews.map(({ room }) => room),
    [classicRoom],
  );
  assert.deepEqual(
    state.clearedLocks.map(({ room }) => room),
    [classicRoom],
  );
});

test("disconnects the revoked socket when Classic Canvas room leave fails", async () => {
  const classicRoom = { canvasId: "classic-canvas", workspaceId };
  const classicRoomName = createCanvasRoomName(classicRoom);
  const socket = createSocket("failing-tab", userId, [
    { access: classicAccess, room: classicRoom },
  ]);
  const state = createHandler([socket], { failLeaveRoom: classicRoomName });

  assert.equal(await state.handler.handle(revocation), true);
  assert.deepEqual(socket.disconnectCalls, [true]);
  assert.equal(socket.data.canvasRoomAccess.has(classicRoomName), false);
});

test("rejects revoked Classic Canvas writes without changing Review or tldraw sync access", () => {
  const classicRoom = { canvasId: "classic-canvas", workspaceId };
  const reviewRoom = { canvasId: "review-canvas", workspaceId };
  const tldrawSyncRoom = { canvasId: "sync-canvas", workspaceId };
  const socket = createSocket("mixed-canvas-tab", userId, [
    { access: classicAccess, room: classicRoom },
    { access: reviewAccess, room: reviewRoom },
    { access: tldrawSyncAccess, room: tldrawSyncRoom },
  ]);
  socket.data.revokedClassicCanvasWorkspaceIds.add(workspaceId);

  assert.equal(
    assertCanvasRoomWritable(socket, createCanvasRoomName(classicRoom)),
    false,
  );
  assert.equal(
    assertCanvasRoomWritable(socket, createCanvasRoomName(reviewRoom)),
    true,
  );
  assert.equal(
    assertCanvasRoomWritable(socket, createCanvasRoomName(tldrawSyncRoom)),
    true,
  );
  assert.equal(socket.emitCalls.length, 1);
});

test("wires the shared revocation event and keeps post-revocation Canvas guards", async () => {
  const socketServer = await readFile(
    new URL("../../../src/socket/socket-server.ts", import.meta.url),
    "utf8",
  );
  const socketHandlers = await readFile(
    new URL("./canvas-socket-handlers.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    socketServer,
    /createClassicCanvasMembershipRevocationHandler/,
  );
  assert.match(
    socketServer,
    /classicCanvasMembershipRevocationHandler\.handle\(payload\)/,
  );
  assert.match(socketHandlers, /revokedClassicCanvasWorkspaceIds/);
  assert.match(socketHandlers, /isClassicCanvasRoomAccess\(result\.access\)/);

  for (const eventName of [
    "canvasClientEvents.presenceUpdate",
    "canvasClientEvents.viewportLoaded",
  ]) {
    const handlerStart = socketHandlers.indexOf(`socket.on(${eventName}`);
    const nextHandlerStart = socketHandlers.indexOf(
      "socket.on(",
      handlerStart + 1,
    );
    const handlerSource = socketHandlers.slice(handlerStart, nextHandlerStart);
    assert.match(handlerSource, /hasCanvasRoomAccess\(socket, roomName\)/);
  }
});
