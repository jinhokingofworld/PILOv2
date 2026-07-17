import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createMeetingRoomName } from "../../dist/socket/room-names.js";

let membershipRevocationModule;
try {
  membershipRevocationModule = await import(
    "../../dist/meeting/meeting-membership-revocation.js"
  );
} catch {
  assert.fail("Meeting membership revocation handler is missing");
}

const {
  createMeetingMembershipRevocationHandler,
  isWorkspaceMembershipRevokedEvent,
} = membershipRevocationModule;

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const unrelatedUserId = "33333333-3333-4333-8333-333333333333";

const validEvent = {
  version: 1,
  type: "membership.revoked",
  workspaceId,
  userId,
  occurredAt: "2026-07-17T00:00:00.000Z",
};

const socketServerSource = await readFile(
  new URL("../socket/socket-server.ts", import.meta.url),
  "utf8",
);

let nextSocketId = 1;
function createSocket(
  authUserId,
  { failDisconnect = false, failLeaveRoom } = {},
) {
  const socket = {
    data: { auth: { userId: authUserId } },
    disconnectCalls: [],
    id: `meeting-revocation-socket-${nextSocketId++}`,
    leaveCalls: [],
    disconnect(close) {
      socket.disconnectCalls.push(close);
      if (failDisconnect) throw new Error("adapter disconnect failed");
    },
    async leave(roomName) {
      socket.leaveCalls.push(roomName);
      if (roomName === failLeaveRoom) {
        throw new Error("adapter leave failed");
      }
    },
  };
  return socket;
}

function createLocalIo(roomSockets, { discoveryError = null } = {}) {
  const io = {};
  Object.defineProperty(io, "sockets", {
    get() {
      if (discoveryError) throw discoveryError;
      return {
        adapter: {
          rooms: new Map([
            [
              createMeetingRoomName(workspaceId),
              new Set(roomSockets.map(({ id }) => id)),
            ],
          ]),
        },
        sockets: new Map(roomSockets.map((socket) => [socket.id, socket])),
      };
    },
  });
  return io;
}

test("membership.revoked validator는 exact V1 UUID event만 허용한다", () => {
  assert.equal(isWorkspaceMembershipRevokedEvent(validEvent), true);
  for (const invalidEvent of [
    { ...validEvent, version: 2 },
    { ...validEvent, type: "membership.added" },
    { ...validEvent, workspaceId: "workspace-1" },
    { ...validEvent, userId: "user-1" },
    { ...validEvent, occurredAt: "2026-07-17" },
    { ...validEvent, extra: true },
  ]) {
    assert.equal(isWorkspaceMembershipRevokedEvent(invalidEvent), false);
  }
});

test("membership.revoked는 Meeting target local tab만 room에서 제거한다", async () => {
  const firstTab = createSocket(userId);
  const secondTab = createSocket(userId);
  const mismatchedSocket = createSocket(unrelatedUserId);
  const invalidIdentitySocket = createSocket("invalid-user");
  const handler = createMeetingMembershipRevocationHandler({
    io: createLocalIo([
      firstTab,
      mismatchedSocket,
      invalidIdentitySocket,
      secondTab,
    ]),
  });

  assert.equal(await handler.handle(validEvent), true);
  for (const socket of [firstTab, secondTab]) {
    assert.deepEqual(socket.leaveCalls, [createMeetingRoomName(workspaceId)]);
    assert.deepEqual(socket.disconnectCalls, []);
  }
  for (const socket of [mismatchedSocket, invalidIdentitySocket]) {
    assert.deepEqual(socket.leaveCalls, []);
    assert.deepEqual(socket.disconnectCalls, []);
  }
});

test("Meeting room leave 실패는 socket disconnect로 fail closed 처리한다", async () => {
  const roomName = createMeetingRoomName(workspaceId);
  const socket = createSocket(userId, { failLeaveRoom: roomName });
  const handler = createMeetingMembershipRevocationHandler({
    io: createLocalIo([socket]),
  });

  assert.equal(await handler.handle(validEvent), true);
  assert.deepEqual(socket.leaveCalls, [roomName]);
  assert.deepEqual(socket.disconnectCalls, [true]);
});

test("invalid event 또는 local socket discovery 실패는 fail closed한다", async () => {
  const invalidHandler = createMeetingMembershipRevocationHandler({
    io: createLocalIo([], { discoveryError: new Error("must not discover") }),
  });
  assert.equal(
    await invalidHandler.handle({ ...validEvent, userId: "user-1" }),
    false,
  );

  const discoveryFailureHandler = createMeetingMembershipRevocationHandler({
    io: createLocalIo([], { discoveryError: new Error("adapter unavailable") }),
  });
  assert.equal(await discoveryFailureHandler.handle(validEvent), false);
});

test("socket server는 Meeting membership revocation handler를 공통 subscription에 연결한다", () => {
  assert.match(
    socketServerSource,
    /createMeetingMembershipRevocationHandler\(\{ io \}\)/,
  );
  assert.match(socketServerSource, /meetingMembershipRevocationHandler\s*\.handle\(payload\)/);
  assert.match(socketServerSource, /WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL/);
});
