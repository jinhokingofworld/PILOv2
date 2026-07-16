import assert from "node:assert/strict";
import test from "node:test";

import { createChatAccessService } from "../../dist/chat/chat-access.service.js";
import {
  chatClientEvents,
  chatServerEvents,
} from "../../dist/chat/chat-events.js";
import {
  createChatRoomName,
  createChatUserRoomName,
} from "../../dist/chat/chat-room.service.js";
import { registerChatSocketHandlers } from "../../dist/chat/chat-socket-handlers.js";

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createHarness({
  allowed = true,
  auth = { token: "secret-token", userId: "user-1" },
  canJoinWorkspace,
  join,
  leave,
} = {}) {
  const accessCalls = [];
  const emitted = [];
  const handlers = new Map();
  const joinCalls = [];
  const leaveCalls = [];
  const socket = {
    connected: true,
    data: { auth },
    id: "socket-1",
    rooms: new Set(),
    async join(roomName) {
      joinCalls.push(roomName);
      if (join) await join(roomName);
      socket.rooms.add(roomName);
    },
    async leave(roomName) {
      leaveCalls.push(roomName);
      if (leave) await leave(roomName);
      socket.rooms.delete(roomName);
    },
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
  };

  registerChatSocketHandlers({
    accessService: {
      async canJoinWorkspace(context, workspaceId) {
        accessCalls.push({ context, workspaceId });
        return canJoinWorkspace
          ? canJoinWorkspace(context, workspaceId)
          : allowed;
      },
    },
    socket,
  });

  return {
    accessCalls,
    emitted,
    handlers,
    joinCalls,
    leaveCalls,
    socket,
  };
}

test("Chat access는 authenticated user와 Workspace id를 모두 조회한다", async () => {
  const queries = [];
  const service = createChatAccessService({
    async queryOne(text, values) {
      queries.push({ text, values });
      return { id: "membership-1" };
    },
  });

  assert.equal(
    await service.canJoinWorkspace({ userId: "user-1" }, "workspace-1"),
    true,
  );
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /FROM workspace_members/);
  assert.match(queries[0].text, /workspace_id = \$1/);
  assert.match(queries[0].text, /user_id = \$2/);
  assert.deepEqual(queries[0].values, ["workspace-1", "user-1"]);

  assert.equal(await service.canJoinWorkspace({}, "workspace-1"), false);
  assert.equal(queries.length, 1);
});

test("invalid, unauthenticated, forbidden join은 safe Chat error를 보낸다", async () => {
  const invalid = createHarness();
  await invalid.handlers.get(chatClientEvents.join)({
    workspaceId: "workspace-1",
    userId: "attacker",
  });
  assert.deepEqual(invalid.emitted.at(-1), {
    event: chatServerEvents.error,
    payload: {
      code: "invalid_payload",
      message: "chat:join payload is invalid",
    },
  });

  const unauthenticated = createHarness({ auth: {} });
  await unauthenticated.handlers.get(chatClientEvents.join)({
    workspaceId: "workspace-1",
  });
  assert.deepEqual(unauthenticated.emitted.at(-1), {
    event: chatServerEvents.error,
    payload: {
      code: "unauthenticated",
      message: "authenticated Chat user is required",
    },
  });

  const forbidden = createHarness({ allowed: false });
  await forbidden.handlers.get(chatClientEvents.join)({ workspaceId: "workspace-1" });
  assert.deepEqual(forbidden.emitted.at(-1), {
    event: chatServerEvents.error,
    payload: {
      code: "forbidden",
      message: "workspace Chat access denied",
    },
  });
});

test("authorized join은 socket auth user로 membership을 확인하고 두 Chat room에 join한다", async () => {
  const harness = createHarness();

  await harness.handlers.get(chatClientEvents.join)({ workspaceId: "workspace-1" });

  assert.deepEqual(harness.accessCalls, [
    { context: { userId: "user-1" }, workspaceId: "workspace-1" },
  ]);
  assert.deepEqual(harness.joinCalls, [
    createChatRoomName("workspace-1"),
    createChatUserRoomName("workspace-1", "user-1"),
  ]);
  assert.deepEqual(harness.emitted.at(-1), {
    event: chatServerEvents.joined,
    payload: { workspaceId: "workspace-1" },
  });
});

test("membership 확인 중 leave된 stale join은 room을 다시 만들지 않는다", async () => {
  const access = deferred();
  const harness = createHarness({ canJoinWorkspace: () => access.promise });

  const joinPromise = harness.handlers.get(chatClientEvents.join)({
    workspaceId: "workspace-1",
  });
  await Promise.resolve();
  await harness.handlers.get(chatClientEvents.leave)({ workspaceId: "workspace-1" });
  access.resolve(true);
  await joinPromise;

  assert.deepEqual(harness.joinCalls, []);
  assert.equal(
    harness.emitted.some(({ event }) => event === chatServerEvents.joined),
    false,
  );
  assert.deepEqual([...harness.socket.rooms], []);
});

test("explicit leave는 두 Chat room을 모두 제거한다", async () => {
  const harness = createHarness();
  await harness.handlers.get(chatClientEvents.join)({ workspaceId: "workspace-1" });

  await harness.handlers.get(chatClientEvents.leave)({ workspaceId: "workspace-1" });

  assert.deepEqual(harness.leaveCalls.slice(-2), [
    createChatRoomName("workspace-1"),
    createChatUserRoomName("workspace-1", "user-1"),
  ]);
  assert.deepEqual([...harness.socket.rooms], []);
});

test("socket.join 대기 중 disconnect되면 stale dual-room join을 정리한다", async () => {
  const socketJoin = deferred();
  const harness = createHarness({ join: () => socketJoin.promise });

  const joinPromise = harness.handlers.get(chatClientEvents.join)({
    workspaceId: "workspace-1",
  });
  await Promise.resolve();
  await Promise.resolve();
  harness.socket.connected = false;
  const disconnectPromise = harness.handlers.get("disconnect")();
  socketJoin.resolve();
  await Promise.all([joinPromise, disconnectPromise]);

  assert.deepEqual([...harness.socket.rooms], []);
  assert.equal(
    harness.emitted.some(({ event }) => event === chatServerEvents.joined),
    false,
  );
  assert.ok(
    harness.leaveCalls.includes(createChatUserRoomName("workspace-1", "user-1")),
  );
});

test("이전 leave와 재join은 직렬화되어 최신 dual-room membership을 보존한다", async () => {
  const socketLeave = deferred();
  let shouldWaitForLeave = false;
  const harness = createHarness({
    leave: async () => {
      if (shouldWaitForLeave) {
        shouldWaitForLeave = false;
        await socketLeave.promise;
      }
    },
  });
  await harness.handlers.get(chatClientEvents.join)({ workspaceId: "workspace-1" });

  shouldWaitForLeave = true;
  const leavePromise = harness.handlers.get(chatClientEvents.leave)({
    workspaceId: "workspace-1",
  });
  await Promise.resolve();
  const rejoinPromise = harness.handlers.get(chatClientEvents.join)({
    workspaceId: "workspace-1",
  });
  socketLeave.resolve();
  await Promise.all([leavePromise, rejoinPromise]);

  assert.deepEqual(new Set(harness.socket.rooms), new Set([
    createChatRoomName("workspace-1"),
    createChatUserRoomName("workspace-1", "user-1"),
  ]));
});

test("한 Workspace leave는 다른 Workspace Chat room을 건드리지 않는다", async () => {
  const harness = createHarness();
  await harness.handlers.get(chatClientEvents.join)({ workspaceId: "workspace-1" });
  await harness.handlers.get(chatClientEvents.join)({ workspaceId: "workspace-2" });

  await harness.handlers.get(chatClientEvents.leave)({ workspaceId: "workspace-1" });

  assert.equal(harness.socket.rooms.has(createChatRoomName("workspace-2")), true);
  assert.equal(
    harness.socket.rooms.has(createChatUserRoomName("workspace-2", "user-1")),
    true,
  );
  assert.equal(harness.leaveCalls.includes(createChatRoomName("workspace-2")), false);
});
