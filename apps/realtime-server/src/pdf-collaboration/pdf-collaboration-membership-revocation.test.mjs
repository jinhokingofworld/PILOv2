import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createPdfCollaborationRoomName } from "../../dist/pdf-collaboration/pdf-collaboration-room.js";
import { createPdfCollaborationRoomState } from "../../dist/pdf-collaboration/pdf-collaboration-room-state.js";

let membershipRevocationModule;
try {
  membershipRevocationModule = await import(
    "../../dist/pdf-collaboration/pdf-collaboration-membership-revocation.js"
  );
} catch {
  assert.fail("PDF membership revocation handler is missing");
}

const { createPdfCollaborationMembershipRevocationHandler } =
  membershipRevocationModule;

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const otherUserId = "44444444-4444-4444-8444-444444444444";
const firstFileId = "55555555-5555-4555-8555-555555555555";
const secondFileId = "66666666-6666-4666-8666-666666666666";
const otherWorkspaceFileId = "77777777-7777-4777-8777-777777777777";

const revocation = {
  occurredAt: "2026-07-17T00:00:00.000Z",
  type: "membership.revoked",
  userId,
  version: 1,
  workspaceId,
};

function createSocket(id, authenticatedUserId) {
  const socket = {
    data: { auth: { userId: authenticatedUserId } },
    id,
    leaveCalls: [],
    rooms: new Set([id]),
    async leave(roomName) {
      socket.leaveCalls.push(roomName);
      socket.rooms.delete(roomName);
    },
  };
  return socket;
}

test("evicts only revoked Workspace PDF rooms and clears their presence", async () => {
  const firstRoom = { fileId: firstFileId, workspaceId };
  const secondRoom = { fileId: secondFileId, workspaceId };
  const otherWorkspaceRoom = {
    fileId: otherWorkspaceFileId,
    workspaceId: otherWorkspaceId,
  };
  const state = createPdfCollaborationRoomState();
  const firstTab = createSocket("pdf-tab-1", userId);
  const secondTab = createSocket("pdf-tab-2", userId);
  const otherWorkspaceTab = createSocket("pdf-tab-3", userId);
  const otherUserTab = createSocket("pdf-tab-4", otherUserId);
  const emitted = [];

  for (const [socket, room, displayName] of [
    [firstTab, firstRoom, "EJ"],
    [secondTab, secondRoom, "EJ"],
    [otherWorkspaceTab, otherWorkspaceRoom, "EJ"],
    [otherUserTab, firstRoom, "JH"],
  ]) {
    const roomName = createPdfCollaborationRoomName(room);
    socket.rooms.add(roomName);
    state.join(room, socket.id, {
      displayName,
      pageNumber: 1,
      userId: socket.data.auth.userId,
    });
  }

  const handler = createPdfCollaborationMembershipRevocationHandler({
    io: {
      sockets: {
        sockets: new Map([
          [firstTab.id, firstTab],
          [secondTab.id, secondTab],
          [otherWorkspaceTab.id, otherWorkspaceTab],
          [otherUserTab.id, otherUserTab],
        ]),
      },
      to(roomName) {
        return {
          emit(event, payload) {
            emitted.push({ event, payload, roomName });
          },
        };
      },
    },
    roomState: state,
  });

  assert.equal(await handler.handle(revocation), true);
  assert.deepEqual(firstTab.leaveCalls, [createPdfCollaborationRoomName(firstRoom)]);
  assert.deepEqual(secondTab.leaveCalls, [createPdfCollaborationRoomName(secondRoom)]);
  assert.deepEqual(otherWorkspaceTab.leaveCalls, []);
  assert.deepEqual(otherUserTab.leaveCalls, []);
  assert.equal(firstTab.rooms.has(createPdfCollaborationRoomName(firstRoom)), false);
  assert.equal(secondTab.rooms.has(createPdfCollaborationRoomName(secondRoom)), false);
  assert.equal(state.getSnapshot(firstRoom)?.presence.length, 1);
  assert.equal(state.getSnapshot(secondRoom), null);
  assert.equal(state.getSnapshot(otherWorkspaceRoom)?.presence.length, 1);
  assert.deepEqual(
    emitted.map(({ event, roomName }) => ({ event, roomName })),
    [
      { event: "pdf-collaboration:leave", roomName: createPdfCollaborationRoomName(firstRoom) },
      { event: "pdf-collaboration:leave", roomName: createPdfCollaborationRoomName(secondRoom) },
    ],
  );
});

test("keeps the existing room guard as the post-revocation event rejection boundary", async () => {
  const socketServer = await readFile(
    new URL("../socket/socket-server.ts", import.meta.url),
    "utf8",
  );

  for (const eventName of [
    "pdfCollaborationClientEvents.pageUpdate",
    "pdfCollaborationClientEvents.pointerUpdate",
    "pdfCollaborationClientEvents.strokeCommit",
  ]) {
    const handlerStart = socketServer.indexOf(`socket.on(${eventName}`);
    const nextHandlerStart = socketServer.indexOf("socket.on(", handlerStart + 1);
    const handlerSource = socketServer.slice(
      handlerStart,
      nextHandlerStart === -1 ? undefined : nextHandlerStart,
    );
    assert.match(handlerSource, /!socket\.rooms\.has\(roomName\)/);
    assert.match(handlerSource, /room_not_joined/);
  }
});
