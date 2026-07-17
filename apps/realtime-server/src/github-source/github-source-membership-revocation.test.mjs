import assert from "node:assert/strict";
import test from "node:test";

import { createGithubSourceMembershipRevocationHandler } from "../../dist/github-source/github-source-membership-revocation.js";
import { registerGithubSourceSocketHandlers } from "../../dist/github-source/github-source-socket-handlers.js";
import { githubSourceClientEvents, githubSourceServerEvents } from "../../dist/github-source/github-source-socket-events.js";
import { createWorkspaceMembershipRevocationFence } from "../../dist/workspace-membership-revocation/workspace-membership-revocation.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const otherUserId = "44444444-4444-4444-8444-444444444444";
const event = {
  occurredAt: "2026-07-17T00:00:00.000Z",
  type: "membership.revoked",
  userId,
  version: 1,
  workspaceId,
};

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createSocket({ id = "socket-1", rooms = [], socketJoin, user = userId, leaveFails = false } = {}) {
  const disconnectCalls = [];
  const emitted = [];
  const handlers = new Map();
  const joinCalls = [];
  const leaveCalls = [];
  const socket = {
    data: { auth: { userId: user } },
    disconnect(close) {
      disconnectCalls.push(close);
    },
    emit(eventName, payload) {
      emitted.push({ event: eventName, payload });
    },
    id,
    async join(roomName) {
      joinCalls.push(roomName);
      socket.rooms.add(roomName);
      if (socketJoin) await socketJoin(roomName);
    },
    async leave(roomName) {
      leaveCalls.push(roomName);
      if (leaveFails) throw new Error("leave failed");
      socket.rooms.delete(roomName);
    },
    on(eventName, handler) {
      handlers.set(eventName, handler);
    },
    rooms: new Set([id, ...rooms]),
  };
  return { disconnectCalls, emitted, handlers, joinCalls, leaveCalls, socket };
}

test("revocation removes only the target GitHub Source room", async () => {
  const roomName = `workspace:${workspaceId}:github-source`;
  const otherRoomName = `workspace:${otherWorkspaceId}:github-source`;
  const target = createSocket({ rooms: [roomName, otherRoomName] });
  const otherUser = createSocket({ id: "socket-2", rooms: [roomName], user: otherUserId });
  const handler = createGithubSourceMembershipRevocationHandler({
    io: {
      sockets: {
        sockets: new Map([
          [target.socket.id, target.socket],
          [otherUser.socket.id, otherUser.socket],
        ]),
      },
    },
  });

  assert.equal(await handler.handle(event), true);
  assert.deepEqual(target.leaveCalls, [roomName]);
  assert.equal(target.socket.rooms.has(roomName), false);
  assert.equal(target.socket.rooms.has(otherRoomName), true);
  assert.equal(otherUser.leaveCalls.length, 0);
});

test("invalid revocation is mutation-free and leave failure disconnects", async () => {
  const target = createSocket({
    leaveFails: true,
    rooms: [`workspace:${workspaceId}:github-source`],
  });
  const handler = createGithubSourceMembershipRevocationHandler({
    io: { sockets: { sockets: new Map([[target.socket.id, target.socket]]) } },
  });
  assert.equal(await handler.handle({ ...event, extra: true }), false);
  assert.equal(target.leaveCalls.length, 0);
  assert.equal(await handler.handle(event), true);
  assert.deepEqual(target.disconnectCalls, [true]);
});

test("synchronous GitHub Source leave throw disconnects fail-closed", async () => {
  const roomName = `workspace:${workspaceId}:github-source`;
  const target = createSocket({ rooms: [roomName] });
  target.socket.leave = (targetRoomName) => {
    target.leaveCalls.push(targetRoomName);
    throw new Error("synchronous leave failure");
  };
  const handler = createGithubSourceMembershipRevocationHandler({
    io: { sockets: { sockets: new Map([[target.socket.id, target.socket]]) } },
  });

  assert.equal(await handler.handle(event), true);
  assert.deepEqual(target.leaveCalls, [roomName]);
  assert.deepEqual(target.disconnectCalls, [true]);
});

function createHarness({ socketJoin, subscribe } = {}) {
  const harness = createSocket({ socketJoin });
  const fence = createWorkspaceMembershipRevocationFence();
  const io = {
    sockets: {
      adapter: { rooms: new Map() },
      sockets: new Map([[harness.socket.id, harness.socket]]),
    },
  };
  registerGithubSourceSocketHandlers({
    context: harness.socket.data.auth,
    membershipRevocationFence: fence,
    roomService: {
      subscribe: subscribe ?? (async () => ({ joined: true, payload: { workspaceId }, roomName: `workspace:${workspaceId}:github-source` })),
    },
    socket: harness.socket,
  });
  return { ...harness, fence, io };
}

test("GitHub Source resubscribe is rejected when revocation wins after access or join", async () => {
  const access = deferred();
  const duringAccess = createHarness({ subscribe: () => access.promise });
  const accessSubscribe = duringAccess.handlers.get(githubSourceClientEvents.subscribe)({ workspaceId });
  await Promise.resolve();
  duringAccess.fence.revokeUserWorkspace(duringAccess.io, userId, workspaceId);
  access.resolve({ joined: true, payload: { workspaceId }, roomName: `workspace:${workspaceId}:github-source` });
  await accessSubscribe;
  assert.equal(duringAccess.joinCalls.length, 0);
  assert.equal(duringAccess.emitted.at(-1)?.payload.code, "forbidden");

  const socketJoin = deferred();
  const duringJoin = createHarness({ socketJoin: () => socketJoin.promise });
  const subscribe = duringJoin.handlers.get(githubSourceClientEvents.subscribe)({ workspaceId });
  await Promise.resolve();
  await Promise.resolve();
  duringJoin.fence.revokeUserWorkspace(duringJoin.io, userId, workspaceId);
  socketJoin.resolve();
  await subscribe;
  assert.equal(duringJoin.leaveCalls.length, 1);
  assert.equal(duringJoin.emitted.at(-1)?.payload.code, "forbidden");
  assert.equal(
    duringJoin.emitted.some(({ event: name }) => name === githubSourceServerEvents.subscribed),
    false,
  );
});
