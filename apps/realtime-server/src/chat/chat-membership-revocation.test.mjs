import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createChatRoomName,
  createChatUserRoomName,
} from "../../dist/chat/chat-room.service.js";

let membershipRevocationModule;
try {
  membershipRevocationModule = await import(
    "../../dist/chat/chat-membership-revocation.js"
  );
} catch {
  assert.fail("Chat membership revocation handler is missing");
}
const {
  createChatMembershipRevocationHandler,
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
  occurredAt: "2026-07-16T00:00:00.000Z",
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
    id: `local-revocation-socket-${nextSocketId++}`,
    leaveCalls: [],
    disconnect(close) {
      socket.disconnectCalls.push(close);
      if (failDisconnect) throw new Error("adapter disconnect failed");
    },
    emit() {},
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
              createChatUserRoomName(workspaceId, userId),
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
    { ...validEvent, occurredAt: "2026-07-16" },
    { ...validEvent, extra: true },
  ]) {
    assert.equal(isWorkspaceMembershipRevokedEvent(invalidEvent), false);
  }
});

test("membership.revoked는 target local tab을 퇴출하고 identity mismatch는 disconnect한다", async () => {
  const firstTab = createSocket(userId);
  const secondTab = createSocket(userId);
  const mismatchedSocket = createSocket(unrelatedUserId);
  const invalidIdentitySocket = createSocket("invalid-user");
  const handler = createChatMembershipRevocationHandler({
    io: createLocalIo([
      firstTab,
      mismatchedSocket,
      invalidIdentitySocket,
      secondTab,
    ]),
  });

  assert.equal(await handler.handle(validEvent), true);
  for (const socket of [firstTab, secondTab]) {
    assert.deepEqual(socket.leaveCalls, [
      createChatRoomName(workspaceId),
      createChatUserRoomName(workspaceId, userId),
    ]);
  }
  for (const socket of [mismatchedSocket, invalidIdentitySocket]) {
    assert.deepEqual(socket.leaveCalls, []);
    assert.deepEqual(socket.disconnectCalls, [true]);
  }
});

test("membership.revoked leave 실패 후 disconnect 성공은 안전하게 처리한다", async () => {
  const generalRoom = createChatRoomName(workspaceId);
  const socket = createSocket(userId, { failLeaveRoom: generalRoom });
  const handler = createChatMembershipRevocationHandler({
    io: createLocalIo([socket]),
  });

  assert.equal(await handler.handle(validEvent), true);
  assert.deepEqual(socket.leaveCalls, [
    generalRoom,
    createChatUserRoomName(workspaceId, userId),
  ]);
  assert.deepEqual(socket.disconnectCalls, [true]);
});

test("membership.revoked leave와 disconnect가 모두 실패하면 false를 반환한다", async () => {
  const socket = createSocket(userId, {
    failDisconnect: true,
    failLeaveRoom: createChatRoomName(workspaceId),
  });
  const handler = createChatMembershipRevocationHandler({
    io: createLocalIo([socket]),
  });

  assert.equal(await handler.handle(validEvent), false);
  assert.deepEqual(socket.disconnectCalls, [true]);
});

test("identity mismatch disconnect 실패도 unsafe revocation으로 처리한다", async () => {
  const mismatchedSocket = createSocket(unrelatedUserId, {
    failDisconnect: true,
  });
  const handler = createChatMembershipRevocationHandler({
    io: createLocalIo([mismatchedSocket]),
  });

  assert.equal(await handler.handle(validEvent), false);
});

test("invalid event 또는 local socket discovery 실패는 fail closed한다", async () => {
  const invalidHandler = createChatMembershipRevocationHandler({
    io: createLocalIo([], { discoveryError: new Error("must not discover") }),
  });
  assert.equal(
    await invalidHandler.handle({ ...validEvent, userId: "user-1" }),
    false,
  );

  const discoveryFailureHandler = createChatMembershipRevocationHandler({
    io: createLocalIo([], { discoveryError: new Error("adapter unavailable") }),
  });
  assert.equal(await discoveryFailureHandler.handle(validEvent), false);
});

test("socket server는 membership revocation 구독 work를 추적하고 종료 시 drain한다", () => {
  assert.match(
    socketServerSource,
    /WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL/,
  );
  assert.match(
    socketServerSource,
    /createChatMembershipRevocationHandler\(\{ io \}\)/,
  );
  assert.match(
    socketServerSource,
    /chatSubscriptionWork\.trackRevocation/,
  );
  assert.match(
    socketServerSource,
    /chatMembershipRevocationHandler\s*\.handle\(payload\)/,
  );
  const unsubscribeIndex = socketServerSource.indexOf(
    "await unsubscribeWorkspaceMembershipRevocations?.();",
  );
  const drainIndex = socketServerSource.indexOf(
    "await chatSubscriptionWork.drain();",
  );
  const ioCloseIndex = socketServerSource.indexOf("await io.close();");
  const databaseCloseIndex = socketServerSource.indexOf("await database.close();");
  assert.ok(unsubscribeIndex >= 0 && unsubscribeIndex < drainIndex);
  assert.ok(drainIndex < ioCloseIndex);
  assert.ok(drainIndex < databaseCloseIndex);
});
