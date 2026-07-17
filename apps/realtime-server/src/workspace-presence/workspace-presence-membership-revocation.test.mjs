import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkspacePresenceMembershipRevocationHandler,
} from "../../dist/workspace-presence/workspace-presence-membership-revocation.js";
import {
  createWorkspacePresenceRoomName,
} from "../../dist/workspace-presence/workspace-presence-socket-handlers.js";
import {
  workspacePresenceServerEvents,
} from "../../dist/workspace-presence/workspace-presence-events.js";
import {
  createWorkspacePresenceService,
} from "../../dist/workspace-presence/workspace-presence.service.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "33333333-3333-4333-8333-333333333333";
const userId = "22222222-2222-4222-8222-222222222222";
const otherUserId = "44444444-4444-4444-8444-444444444444";

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
  { failDisconnect = false, failLeaveRoom } = {},
) {
  const socket = {
    data: { auth: { userId: authUserId } },
    disconnectCalls: [],
    id: `presence-revocation-socket-${nextSocketId++}`,
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
  const roomEvents = [];
  const io = {
    to(roomName) {
      return {
        emit(event, payload) {
          roomEvents.push({ event, payload, roomName });
        },
      };
    },
  };
  Object.defineProperty(io, "sockets", {
    get() {
      if (discoveryError) throw discoveryError;
      return {
        adapter: {
          rooms: new Map([
            [
              createWorkspacePresenceRoomName(workspaceId),
              new Set(roomSockets.map(({ id }) => id)),
            ],
          ]),
        },
        sockets: new Map(roomSockets.map((socket) => [socket.id, socket])),
      };
    },
  });
  return { io, roomEvents };
}

test("membership.revoked는 target presence state와 room만 정리한다", async () => {
  const target = createSocket(userId);
  const unrelated = createSocket(otherUserId);
  const service = createWorkspacePresenceService();
  service.joinSocket(target.id, { displayName: "진호", userId }, workspaceId);
  service.joinSocket(target.id, { displayName: "진호", userId }, otherWorkspaceId);
  service.joinSocket(
    unrelated.id,
    { displayName: "동료", userId: otherUserId },
    workspaceId,
  );
  const { io, roomEvents } = createLocalIo([target]);
  const handler = createWorkspacePresenceMembershipRevocationHandler({ io, service });

  assert.equal(await handler.handle(validEvent), true);
  assert.deepEqual(target.leaveCalls, [createWorkspacePresenceRoomName(workspaceId)]);
  const remainingPresence = service.getWorkspacePresence(workspaceId);
  assert.equal(remainingPresence.length, 1);
  assert.equal(remainingPresence[0]?.userId, otherUserId);
  assert.equal(remainingPresence[0]?.workspaceId, workspaceId);
  const otherWorkspacePresence = service.getWorkspacePresence(otherWorkspaceId);
  assert.equal(otherWorkspacePresence.length, 1);
  assert.equal(otherWorkspacePresence[0]?.userId, userId);
  assert.equal(otherWorkspacePresence[0]?.workspaceId, otherWorkspaceId);
  assert.deepEqual(roomEvents.at(-1), {
    event: workspacePresenceServerEvents.leave,
    payload: { userId, workspaceId },
    roomName: createWorkspacePresenceRoomName(workspaceId),
  });
  assert.equal(
    service.updateSocket(target.id, {
      focused: true,
      location: null,
      visible: true,
      workspaceId,
    }),
    null,
  );
});

test("presence room leave 실패도 state를 clear하고 disconnect로 fail closed 처리한다", async () => {
  const roomName = createWorkspacePresenceRoomName(workspaceId);
  const target = createSocket(userId, { failLeaveRoom: roomName });
  const service = createWorkspacePresenceService();
  service.joinSocket(target.id, { displayName: "진호", userId }, workspaceId);
  const { io, roomEvents } = createLocalIo([target]);
  const handler = createWorkspacePresenceMembershipRevocationHandler({ io, service });

  assert.equal(await handler.handle(validEvent), true);
  assert.deepEqual(target.disconnectCalls, [true]);
  assert.deepEqual(service.getWorkspacePresence(workspaceId), []);
  assert.deepEqual(roomEvents.at(-1), {
    event: workspacePresenceServerEvents.leave,
    payload: { userId, workspaceId },
    roomName,
  });
});

test("presence room의 다른 사용자는 유지하고 registry 오류는 fail closed 처리한다", async () => {
  const mismatchedSocket = createSocket(otherUserId);
  const service = createWorkspacePresenceService();
  const handler = createWorkspacePresenceMembershipRevocationHandler({
    io: createLocalIo([mismatchedSocket]).io,
    service,
  });

  assert.equal(await handler.handle(validEvent), true);
  assert.deepEqual(mismatchedSocket.disconnectCalls, []);

  const failedHandler = createWorkspacePresenceMembershipRevocationHandler({
    io: createLocalIo([], { discoveryError: new Error("adapter unavailable") }).io,
    service,
  });
  assert.equal(await failedHandler.handle(validEvent), false);
});
