import assert from "node:assert/strict";
import test from "node:test";

import { createBoardMembershipRevocationHandler } from "../../dist/board/board-membership-revocation.js";
import { registerBoardSocketHandlers } from "../../dist/board/board-socket-handlers.js";
import { registerBoardSourceSocketHandlers } from "../../dist/board/board-source-socket-handlers.js";
import { boardClientEvents, boardServerEvents } from "../../dist/board/board-socket-events.js";
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

test("revocation leaves only target board and board source rooms", async () => {
  const boardRoom = `workspace:${workspaceId}:board:17`;
  const sourceRoom = `workspace:${workspaceId}:boards`;
  const otherRoom = `workspace:${otherWorkspaceId}:board:18`;
  const target = createSocket({ rooms: [boardRoom, sourceRoom, otherRoom] });
  const otherUser = createSocket({ id: "socket-2", rooms: [boardRoom], user: otherUserId });
  const handler = createBoardMembershipRevocationHandler({
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
  assert.deepEqual(new Set(target.leaveCalls), new Set([boardRoom, sourceRoom]));
  assert.equal(target.socket.rooms.has(boardRoom), false);
  assert.equal(target.socket.rooms.has(sourceRoom), false);
  assert.equal(target.socket.rooms.has(otherRoom), true);
  assert.equal(otherUser.leaveCalls.length, 0);
});

test("invalid revocation does not mutate rooms and leave failure disconnects", async () => {
  const boardRoom = `workspace:${workspaceId}:board:17`;
  const target = createSocket({ leaveFails: true, rooms: [boardRoom] });
  const handler = createBoardMembershipRevocationHandler({
    io: { sockets: { sockets: new Map([[target.socket.id, target.socket]]) } },
  });
  assert.equal(await handler.handle({ ...event, workspaceId: "invalid" }), false);
  assert.equal(target.leaveCalls.length, 0);
  assert.equal(await handler.handle(event), true);
  assert.deepEqual(target.disconnectCalls, [true]);
});

test("synchronous board room leave throw disconnects fail-closed", async () => {
  const boardRoom = `workspace:${workspaceId}:board:17`;
  const target = createSocket({ rooms: [boardRoom] });
  target.socket.leave = (roomName) => {
    target.leaveCalls.push(roomName);
    throw new Error("synchronous leave failure");
  };
  const handler = createBoardMembershipRevocationHandler({
    io: { sockets: { sockets: new Map([[target.socket.id, target.socket]]) } },
  });

  assert.equal(await handler.handle(event), true);
  assert.deepEqual(target.leaveCalls, [boardRoom]);
  assert.deepEqual(target.disconnectCalls, [true]);
});

function createFenceHarness(socket) {
  const fence = createWorkspaceMembershipRevocationFence();
  const io = {
    sockets: {
      adapter: { rooms: new Map() },
      sockets: new Map([[socket.id, socket]]),
    },
  };
  return { fence, io };
}

test("Board Room join is rejected when revocation wins after access or after join", async () => {
  const access = deferred();
  const duringAccess = createSocket();
  const accessFence = createFenceHarness(duringAccess.socket);
  registerBoardSocketHandlers({
    context: duringAccess.socket.data.auth,
    membershipRevocationFence: accessFence.fence,
    roomService: { joinBoardRoom: () => access.promise },
    socket: duringAccess.socket,
  });
  const accessJoin = duringAccess.handlers.get(boardClientEvents.join)({ boardId: "17", workspaceId });
  await Promise.resolve();
  accessFence.fence.revokeUserWorkspace(accessFence.io, userId, workspaceId);
  access.resolve({ joined: true, payload: { boardId: "17", workspaceId }, roomName: `workspace:${workspaceId}:board:17` });
  await accessJoin;
  assert.equal(duringAccess.joinCalls.length, 0);
  assert.equal(duringAccess.emitted.at(-1)?.payload.code, "forbidden");

  const socketJoin = deferred();
  const duringJoin = createSocket({ socketJoin: () => socketJoin.promise });
  const joinFence = createFenceHarness(duringJoin.socket);
  registerBoardSocketHandlers({
    context: duringJoin.socket.data.auth,
    membershipRevocationFence: joinFence.fence,
    roomService: {
      joinBoardRoom: async () => ({ joined: true, payload: { boardId: "17", workspaceId }, roomName: `workspace:${workspaceId}:board:17` }),
    },
    socket: duringJoin.socket,
  });
  const join = duringJoin.handlers.get(boardClientEvents.join)({ boardId: "17", workspaceId });
  await Promise.resolve();
  await Promise.resolve();
  joinFence.fence.revokeUserWorkspace(joinFence.io, userId, workspaceId);
  socketJoin.resolve();
  await join;
  assert.equal(duringJoin.leaveCalls.length, 1);
  assert.equal(duringJoin.emitted.at(-1)?.payload.code, "forbidden");
  assert.equal(duringJoin.emitted.some(({ event: name }) => name === boardServerEvents.joined), false);
});

test("Board Source subscription is fenced after access and after join", async () => {
  const access = deferred();
  const duringAccess = createSocket();
  const accessFence = createFenceHarness(duringAccess.socket);
  registerBoardSourceSocketHandlers({
    context: duringAccess.socket.data.auth,
    membershipRevocationFence: accessFence.fence,
    roomService: { joinWorkspaceSourceRoom: () => access.promise },
    socket: duringAccess.socket,
  });
  const accessJoin = duringAccess.handlers.get(boardClientEvents.sourceJoin)({ workspaceId });
  await Promise.resolve();
  accessFence.fence.revokeUserWorkspace(accessFence.io, userId, workspaceId);
  access.resolve({ joined: true, payload: { workspaceId }, roomName: `workspace:${workspaceId}:boards` });
  await accessJoin;
  assert.equal(duringAccess.joinCalls.length, 0);
  assert.equal(duringAccess.emitted.at(-1)?.payload.code, "forbidden");

  const socketJoin = deferred();
  const duringJoin = createSocket({ socketJoin: () => socketJoin.promise });
  const joinFence = createFenceHarness(duringJoin.socket);
  registerBoardSourceSocketHandlers({
    context: duringJoin.socket.data.auth,
    membershipRevocationFence: joinFence.fence,
    roomService: {
      joinWorkspaceSourceRoom: async () => ({ joined: true, payload: { workspaceId }, roomName: `workspace:${workspaceId}:boards` }),
    },
    socket: duringJoin.socket,
  });
  const join = duringJoin.handlers.get(boardClientEvents.sourceJoin)({ workspaceId });
  await Promise.resolve();
  await Promise.resolve();
  joinFence.fence.revokeUserWorkspace(joinFence.io, userId, workspaceId);
  socketJoin.resolve();
  await join;
  assert.equal(duringJoin.leaveCalls.length, 1);
  assert.equal(duringJoin.emitted.at(-1)?.payload.code, "forbidden");
  assert.equal(duringJoin.emitted.some(({ event: name }) => name === boardServerEvents.sourceJoined), false);
});
