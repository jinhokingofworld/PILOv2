import assert from "node:assert/strict";
import test from "node:test";

import { createPageCursorMembershipRevocationHandler } from "../../dist/page-cursor/page-cursor-membership-revocation.js";
import { registerPageCursorSocketHandlers } from "../../dist/page-cursor/page-cursor-socket-handlers.js";
import { pageCursorClientEvents, pageCursorServerEvents } from "../../dist/page-cursor/page-cursor-events.js";
import { createWorkspaceMembershipRevocationFence } from "../../dist/workspace-membership-revocation/workspace-membership-revocation.js";

const targetWorkspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const targetUserId = "33333333-3333-4333-8333-333333333333";
const otherUserId = "44444444-4444-4444-8444-444444444444";
const event = {
  occurredAt: "2026-07-17T00:00:00.000Z",
  type: "membership.revoked",
  userId: targetUserId,
  version: 1,
  workspaceId: targetWorkspaceId,
};

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function presence(workspaceId, page = "home") {
  return {
    displayName: "Target",
    fallback: { xRatio: 0.1, yRatio: 0.2 },
    page,
    target: null,
    targetPoint: null,
    updatedAt: "2026-07-17T00:00:00.000Z",
    userId: targetUserId,
    workspaceId,
  };
}

function createSocket({ id, userId, rooms = [], leaveFails = false, roomEmitFails = false }) {
  const emitted = [];
  const leaveCalls = [];
  const disconnectCalls = [];
  const roomEvents = [];
  const socket = {
    data: { auth: { displayName: "Target", userId }, pageCursorPresenceByRoom: {} },
    disconnect(close) {
      disconnectCalls.push(close);
    },
    emit(eventName, payload) {
      emitted.push({ event: eventName, payload });
    },
    id,
    async join(roomName) {
      socket.rooms.add(roomName);
    },
    async leave(roomName) {
      leaveCalls.push(roomName);
      if (leaveFails) throw new Error("leave failed");
      socket.rooms.delete(roomName);
    },
    on() {},
    rooms: new Set([id, ...rooms]),
    to(roomName) {
      return {
        emit(eventName, payload) {
          if (roomEmitFails) throw new Error("emit failed");
          roomEvents.push({ event: eventName, payload, roomName });
        },
      };
    },
  };
  return { disconnectCalls, emitted, leaveCalls, roomEvents, socket };
}

test("revocation removes only the target user's target workspace cursor rooms and presence", async () => {
  const targetHome = `workspace:${targetWorkspaceId}:page:home`;
  const targetBoard = `workspace:${targetWorkspaceId}:page:board:17`;
  const otherHome = `workspace:${otherWorkspaceId}:page:home`;
  const target = createSocket({
    id: "target-socket",
    rooms: [targetHome, targetBoard, otherHome],
    userId: targetUserId,
  });
  target.socket.data.pageCursorPresenceByRoom[targetHome] = presence(targetWorkspaceId);
  target.socket.data.pageCursorPresenceByRoom[otherHome] = presence(otherWorkspaceId);
  const otherUser = createSocket({
    id: "other-user-socket",
    rooms: [targetHome],
    userId: otherUserId,
  });
  const io = {
    sockets: {
      sockets: new Map([
        [target.socket.id, target.socket],
        [otherUser.socket.id, otherUser.socket],
      ]),
    },
  };

  const handled = await createPageCursorMembershipRevocationHandler({ io }).handle(event);

  assert.equal(handled, true);
  assert.deepEqual(new Set(target.leaveCalls), new Set([targetHome, targetBoard]));
  assert.equal(target.socket.rooms.has(targetHome), false);
  assert.equal(target.socket.rooms.has(targetBoard), false);
  assert.equal(target.socket.rooms.has(otherHome), true);
  assert.equal(otherUser.leaveCalls.length, 0);
  assert.equal(target.socket.data.pageCursorPresenceByRoom[targetHome], undefined);
  assert.ok(target.socket.data.pageCursorPresenceByRoom[otherHome]);
  assert.deepEqual(target.roomEvents, [
    {
      event: pageCursorServerEvents.leave,
      payload: {
        page: "home",
        userId: targetUserId,
        workspaceId: targetWorkspaceId,
      },
      roomName: targetHome,
    },
  ]);
});

test("invalid revocation is rejected without mutation and leave failure disconnects fail-closed", async () => {
  const targetHome = `workspace:${targetWorkspaceId}:page:home`;
  const target = createSocket({
    id: "target-socket",
    leaveFails: true,
    rooms: [targetHome],
    userId: targetUserId,
  });
  const handler = createPageCursorMembershipRevocationHandler({
    io: { sockets: { sockets: new Map([[target.socket.id, target.socket]]) } },
  });

  assert.equal(await handler.handle({ ...event, version: 2 }), false);
  assert.equal(target.leaveCalls.length, 0);
  assert.equal(await handler.handle(event), true);
  assert.deepEqual(target.disconnectCalls, [true]);
});

test("synchronous cursor room leave throw disconnects fail-closed", async () => {
  const targetHome = `workspace:${targetWorkspaceId}:page:home`;
  const target = createSocket({
    id: "target-socket",
    rooms: [targetHome],
    userId: targetUserId,
  });
  target.socket.leave = (roomName) => {
    target.leaveCalls.push(roomName);
    throw new Error("synchronous leave failure");
  };
  const handler = createPageCursorMembershipRevocationHandler({
    io: { sockets: { sockets: new Map([[target.socket.id, target.socket]]) } },
  });

  assert.equal(await handler.handle(event), true);
  assert.deepEqual(target.leaveCalls, [targetHome]);
  assert.deepEqual(target.disconnectCalls, [true]);
});

test("presence broadcast failure still removes the revoked cursor room", async () => {
  const targetHome = `workspace:${targetWorkspaceId}:page:home`;
  const target = createSocket({
    id: "target-socket",
    roomEmitFails: true,
    rooms: [targetHome],
    userId: targetUserId,
  });
  target.socket.data.pageCursorPresenceByRoom[targetHome] = presence(targetWorkspaceId);
  const handler = createPageCursorMembershipRevocationHandler({
    io: { sockets: { sockets: new Map([[target.socket.id, target.socket]]) } },
  });

  assert.equal(await handler.handle(event), false);
  assert.deepEqual(target.leaveCalls, [targetHome]);
  assert.equal(target.socket.rooms.has(targetHome), false);
});

function createLifecycleHarness({ canJoinWorkspace, fetchSockets, join } = {}) {
  const handlers = new Map();
  const harness = createSocket({ id: "target-socket", userId: targetUserId });
  harness.socket.on = (eventName, handler) => handlers.set(eventName, handler);
  if (join) {
    harness.socket.join = async (roomName) => {
      harness.socket.rooms.add(roomName);
      await join(roomName);
    };
  }
  const io = {
    in() {
      return { fetchSockets: fetchSockets ?? (async () => [harness.socket]) };
    },
    sockets: {
      adapter: { rooms: new Map() },
      sockets: new Map([[harness.socket.id, harness.socket]]),
    },
  };
  const fence = createWorkspaceMembershipRevocationFence();
  registerPageCursorSocketHandlers({
    accessService: {
      canJoinBoard: async () => true,
      canJoinWorkspace: canJoinWorkspace ?? (async () => true),
    },
    context: harness.socket.data.auth,
    io,
    membershipRevocationFence: fence,
    socket: harness.socket,
  });
  return { ...harness, fence, handlers, io };
}

test("join is fenced when revocation wins during access or socket.join", async () => {
  const access = deferred();
  const duringAccess = createLifecycleHarness({ canJoinWorkspace: () => access.promise });
  const accessJoin = duringAccess.handlers.get(pageCursorClientEvents.join)({
    page: "home",
    workspaceId: targetWorkspaceId,
  });
  await Promise.resolve();
  duringAccess.fence.revokeUserWorkspace(duringAccess.io, targetUserId, targetWorkspaceId);
  access.resolve(true);
  await accessJoin;
  assert.equal(duringAccess.socket.rooms.size, 1);
  assert.equal(duringAccess.emitted.at(-1)?.payload.code, "forbidden");

  const socketJoin = deferred();
  const joinStarted = deferred();
  const duringJoin = createLifecycleHarness({
    join: () => {
      joinStarted.resolve();
      return socketJoin.promise;
    },
  });
  const joined = duringJoin.handlers.get(pageCursorClientEvents.join)({
    page: "home",
    workspaceId: targetWorkspaceId,
  });
  await joinStarted.promise;
  duringJoin.fence.revokeUserWorkspace(duringJoin.io, targetUserId, targetWorkspaceId);
  socketJoin.resolve();
  await joined;
  assert.equal(duringJoin.socket.rooms.size, 1);
  assert.equal(duringJoin.leaveCalls.length, 1);
  assert.equal(duringJoin.emitted.at(-1)?.payload.code, "forbidden");
  assert.equal(
    duringJoin.emitted.some(({ event: eventName }) => eventName === pageCursorServerEvents.joined),
    false,
  );
});

test("post-revocation cursor update is forbidden even with stale room membership", async () => {
  const harness = createLifecycleHarness();
  const roomName = `workspace:${targetWorkspaceId}:page:home`;
  harness.socket.rooms.add(roomName);
  harness.fence.revokeUserWorkspace(harness.io, targetUserId, targetWorkspaceId);

  await harness.handlers.get(pageCursorClientEvents.update)({
    fallback: { xRatio: 0.1, yRatio: 0.2 },
    page: "home",
    target: null,
    targetPoint: null,
    workspaceId: targetWorkspaceId,
  });

  assert.equal(harness.emitted.at(-1)?.payload.code, "forbidden");
  assert.equal(harness.roomEvents.length, 0);
  assert.equal(harness.socket.data.pageCursorPresenceByRoom[roomName], undefined);
});

test("join is fenced when revocation wins while the joined snapshot is loading", async () => {
  const snapshot = deferred();
  const snapshotStarted = deferred();
  const harness = createLifecycleHarness({
    fetchSockets: () => {
      snapshotStarted.resolve();
      return snapshot.promise;
    },
  });
  const join = harness.handlers.get(pageCursorClientEvents.join)({
    page: "home",
    workspaceId: targetWorkspaceId,
  });
  await snapshotStarted.promise;
  harness.fence.revokeUserWorkspace(harness.io, targetUserId, targetWorkspaceId);
  snapshot.resolve([harness.socket]);
  await join;

  assert.equal(harness.socket.rooms.size, 1);
  assert.equal(harness.leaveCalls.length, 1);
  assert.equal(harness.emitted.at(-1)?.payload.code, "forbidden");
  assert.equal(
    harness.emitted.some(({ event: eventName }) => eventName === pageCursorServerEvents.joined),
    false,
  );
});

test("joined snapshot filters malformed remote cursor presence", async () => {
  const roomName = `workspace:${targetWorkspaceId}:page:home`;
  const malformedPresence = {
    displayName: "Remote",
    fallback: { xRatio: "invalid", yRatio: 0.2 },
    page: "home",
    target: null,
    targetPoint: null,
    updatedAt: "2026-07-17T00:00:00.000Z",
    userId: otherUserId,
    workspaceId: targetWorkspaceId,
  };
  const harness = createLifecycleHarness({
    fetchSockets: async () => [
      {
        data: {
          pageCursorPresenceByRoom: { [roomName]: malformedPresence },
        },
      },
    ],
  });

  await harness.handlers.get(pageCursorClientEvents.join)({
    page: "home",
    workspaceId: targetWorkspaceId,
  });

  const joined = harness.emitted.find(
    ({ event: eventName }) => eventName === pageCursorServerEvents.joined,
  );
  assert.deepEqual(joined?.payload.presence, []);
});
