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

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
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
  const disconnectCalls = [];
  const socket = {
    connected: true,
    data: { auth },
    id: "socket-1",
    rooms: new Set(),
    disconnect(close) {
      disconnectCalls.push(close);
      socket.connected = false;
    },
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
    disconnectCalls,
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
    await service.canJoinWorkspace({ userId: "user-1" }, workspaceId),
    true,
  );
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /FROM workspace_members/);
  assert.match(queries[0].text, /workspace_id = \$1/);
  assert.match(queries[0].text, /user_id = \$2/);
  assert.deepEqual(queries[0].values, [workspaceId, "user-1"]);

  assert.equal(await service.canJoinWorkspace({}, workspaceId), false);
  assert.equal(
    await service.canJoinWorkspace({ userId: "user-1" }, "workspace-1"),
    false,
  );
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

  const malformedWorkspace = createHarness();
  await malformedWorkspace.handlers.get(chatClientEvents.join)({
    workspaceId: "workspace-1",
  });
  assert.deepEqual(malformedWorkspace.emitted.at(-1), {
    event: chatServerEvents.error,
    payload: {
      code: "invalid_payload",
      message: "chat:join payload is invalid",
    },
  });
  assert.deepEqual(malformedWorkspace.accessCalls, []);

  const unauthenticated = createHarness({ auth: {} });
  await unauthenticated.handlers.get(chatClientEvents.join)({
    workspaceId,
  });
  assert.deepEqual(unauthenticated.emitted.at(-1), {
    event: chatServerEvents.error,
    payload: {
      code: "unauthenticated",
      message: "authenticated Chat user is required",
    },
  });

  const forbidden = createHarness({ allowed: false });
  await forbidden.handlers.get(chatClientEvents.join)({ workspaceId });
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

  await harness.handlers.get(chatClientEvents.join)({ workspaceId });

  assert.deepEqual(harness.accessCalls, [
    { context: { userId: "user-1" }, workspaceId },
  ]);
  assert.deepEqual(harness.joinCalls, [
    createChatRoomName(workspaceId),
    createChatUserRoomName(workspaceId, "user-1"),
  ]);
  assert.deepEqual(harness.emitted.at(-1), {
    event: chatServerEvents.joined,
    payload: { workspaceId },
  });
});

test("membership 확인 중 leave된 stale join은 room을 다시 만들지 않는다", async () => {
  const access = deferred();
  const harness = createHarness({ canJoinWorkspace: () => access.promise });

  const joinPromise = harness.handlers.get(chatClientEvents.join)({
    workspaceId,
  });
  await Promise.resolve();
  await harness.handlers.get(chatClientEvents.leave)({ workspaceId });
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
  await harness.handlers.get(chatClientEvents.join)({ workspaceId });

  await harness.handlers.get(chatClientEvents.leave)({ workspaceId });

  assert.deepEqual(harness.leaveCalls.slice(-2), [
    createChatRoomName(workspaceId),
    createChatUserRoomName(workspaceId, "user-1"),
  ]);
  assert.deepEqual([...harness.socket.rooms], []);
});

test("socket.join 대기 중 disconnect되면 stale dual-room join을 정리한다", async () => {
  const socketJoin = deferred();
  const harness = createHarness({ join: () => socketJoin.promise });

  const joinPromise = harness.handlers.get(chatClientEvents.join)({
    workspaceId,
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
    harness.leaveCalls.includes(createChatUserRoomName(workspaceId, "user-1")),
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
  await harness.handlers.get(chatClientEvents.join)({ workspaceId });

  shouldWaitForLeave = true;
  const leavePromise = harness.handlers.get(chatClientEvents.leave)({
    workspaceId,
  });
  await Promise.resolve();
  const rejoinPromise = harness.handlers.get(chatClientEvents.join)({
    workspaceId,
  });
  socketLeave.resolve();
  await Promise.all([leavePromise, rejoinPromise]);

  assert.deepEqual(new Set(harness.socket.rooms), new Set([
    createChatRoomName(workspaceId),
    createChatUserRoomName(workspaceId, "user-1"),
  ]));
});

test("한 Workspace leave는 다른 Workspace Chat room을 건드리지 않는다", async () => {
  const harness = createHarness();
  await harness.handlers.get(chatClientEvents.join)({ workspaceId });
  await harness.handlers.get(chatClientEvents.join)({ workspaceId: otherWorkspaceId });

  await harness.handlers.get(chatClientEvents.leave)({ workspaceId });

  assert.equal(harness.socket.rooms.has(createChatRoomName(otherWorkspaceId)), true);
  assert.equal(
    harness.socket.rooms.has(createChatUserRoomName(otherWorkspaceId, "user-1")),
    true,
  );
  assert.equal(
    harness.leaveCalls.includes(createChatRoomName(otherWorkspaceId)),
    false,
  );
});

test("membership이 철회된 재join은 기존 두 Chat room을 정리한 뒤 forbidden을 보낸다", async () => {
  let accessCount = 0;
  const harness = createHarness({
    canJoinWorkspace: async () => {
      accessCount += 1;
      return accessCount === 1;
    },
  });
  await harness.handlers.get(chatClientEvents.join)({ workspaceId });

  await harness.handlers.get(chatClientEvents.join)({ workspaceId });

  assert.deepEqual(harness.leaveCalls.slice(-2), [
    createChatRoomName(workspaceId),
    createChatUserRoomName(workspaceId, "user-1"),
  ]);
  assert.deepEqual([...harness.socket.rooms], []);
  assert.equal(harness.emitted.at(-1)?.payload.code, "forbidden");
});

test("stale forbidden cleanup은 이후 성공한 재join을 제거하거나 error를 emit하지 않는다", async () => {
  const cleanupRelease = deferred();
  let accessCount = 0;
  let blockCleanup = false;
  let cleanupStarted = false;
  const harness = createHarness({
    canJoinWorkspace: async () => {
      accessCount += 1;
      return accessCount !== 2;
    },
    leave: async (roomName) => {
      if (blockCleanup && roomName === createChatRoomName(workspaceId)) {
        blockCleanup = false;
        cleanupStarted = true;
        await cleanupRelease.promise;
      }
    },
  });
  await harness.handlers.get(chatClientEvents.join)({ workspaceId });

  blockCleanup = true;
  const forbiddenJoin = harness.handlers.get(chatClientEvents.join)({ workspaceId });
  for (let attempt = 0; attempt < 10 && !cleanupStarted; attempt += 1) {
    await Promise.resolve();
  }
  assert.equal(cleanupStarted, true);
  const successfulRejoin = harness.handlers.get(chatClientEvents.join)({ workspaceId });
  cleanupRelease.resolve();
  await Promise.all([forbiddenJoin, successfulRejoin]);

  assert.deepEqual(new Set(harness.socket.rooms), new Set([
    createChatRoomName(workspaceId),
    createChatUserRoomName(workspaceId, "user-1"),
  ]));
  assert.equal(
    harness.emitted.some(({ payload }) => payload?.code === "forbidden"),
    false,
  );
});

test("두 번째 room join 실패는 양쪽 room을 rollback하고 internal_error를 보낸다", async () => {
  const userRoom = createChatUserRoomName(workspaceId, "user-1");
  const harness = createHarness({
    join: async (roomName) => {
      if (roomName === userRoom) throw new Error("adapter join failed");
    },
  });

  await assert.doesNotReject(() =>
    harness.handlers.get(chatClientEvents.join)({ workspaceId }),
  );

  assert.deepEqual(harness.leaveCalls, [
    createChatRoomName(workspaceId),
    userRoom,
  ]);
  assert.deepEqual([...harness.socket.rooms], []);
  assert.equal(
    harness.emitted.some(({ event }) => event === chatServerEvents.joined),
    false,
  );
  assert.equal(harness.emitted.at(-1)?.payload.code, "internal_error");
});

test("첫 번째 room join 실패도 양쪽 room cleanup을 시도하고 internal_error를 보낸다", async () => {
  const generalRoom = createChatRoomName(workspaceId);
  const userRoom = createChatUserRoomName(workspaceId, "user-1");
  const harness = createHarness({
    join: async (roomName) => {
      if (roomName === generalRoom) throw new Error("adapter join failed");
    },
  });

  await assert.doesNotReject(() =>
    harness.handlers.get(chatClientEvents.join)({ workspaceId }),
  );

  assert.deepEqual(harness.leaveCalls, [generalRoom, userRoom]);
  assert.deepEqual([...harness.socket.rooms], []);
  assert.equal(harness.emitted.at(-1)?.payload.code, "internal_error");
});

test("explicit leave는 첫 leave 실패 후에도 두 번째 room을 시도하고 internal_error를 보낸다", async () => {
  const generalRoom = createChatRoomName(workspaceId);
  const userRoom = createChatUserRoomName(workspaceId, "user-1");
  let failLeave = false;
  const harness = createHarness({
    leave: async (roomName) => {
      if (failLeave && roomName === generalRoom) {
        throw new Error("adapter leave failed");
      }
    },
  });
  await harness.handlers.get(chatClientEvents.join)({ workspaceId });
  failLeave = true;

  await assert.doesNotReject(() =>
    harness.handlers.get(chatClientEvents.leave)({ workspaceId }),
  );

  assert.deepEqual(harness.leaveCalls.slice(-2), [generalRoom, userRoom]);
  assert.equal(harness.socket.rooms.has(userRoom), false);
  assert.equal(harness.emitted.at(-1)?.payload.code, "internal_error");
});

test("disconnect cleanup은 첫 leave 실패 후에도 두 번째 room을 시도한다", async () => {
  const generalRoom = createChatRoomName(workspaceId);
  const userRoom = createChatUserRoomName(workspaceId, "user-1");
  let failLeave = false;
  const harness = createHarness({
    leave: async (roomName) => {
      if (failLeave && roomName === generalRoom) {
        throw new Error("adapter leave failed");
      }
    },
  });
  await harness.handlers.get(chatClientEvents.join)({ workspaceId });
  failLeave = true;
  harness.socket.connected = false;

  await assert.doesNotReject(() => harness.handlers.get("disconnect")());

  assert.deepEqual(harness.leaveCalls.slice(-2), [generalRoom, userRoom]);
  assert.equal(harness.socket.rooms.has(userRoom), false);
});

test("forbidden cleanup adapter 실패는 양쪽 leave 뒤 강제 disconnect한다", async () => {
  const generalRoom = createChatRoomName(workspaceId);
  const userRoom = createChatUserRoomName(workspaceId, "user-1");
  let accessCount = 0;
  let failLeave = false;
  const harness = createHarness({
    canJoinWorkspace: async () => {
      accessCount += 1;
      return accessCount === 1;
    },
    leave: async (roomName) => {
      if (failLeave && roomName === generalRoom) {
        throw new Error("adapter leave failed");
      }
    },
  });
  await harness.handlers.get(chatClientEvents.join)({ workspaceId });
  failLeave = true;

  await assert.doesNotReject(() =>
    harness.handlers.get(chatClientEvents.join)({ workspaceId }),
  );

  assert.deepEqual(harness.leaveCalls.slice(-2), [generalRoom, userRoom]);
  assert.equal(harness.emitted.at(-1)?.payload.code, "internal_error");
  assert.deepEqual(harness.disconnectCalls, [true]);
});

test("current access failure는 cleanup 뒤 internal_error를 보내고 reject하지 않는다", async () => {
  const harness = createHarness({
    canJoinWorkspace: async () => {
      throw new Error("database unavailable");
    },
  });

  await assert.doesNotReject(() =>
    harness.handlers.get(chatClientEvents.join)({ workspaceId }),
  );

  assert.deepEqual(harness.leaveCalls, [
    createChatRoomName(workspaceId),
    createChatUserRoomName(workspaceId, "user-1"),
  ]);
  assert.equal(harness.emitted.at(-1)?.payload.code, "internal_error");
});

test("stale access failure는 이후 성공한 membership을 정리하거나 error를 emit하지 않는다", async () => {
  const staleAccess = deferred();
  let accessCount = 0;
  const harness = createHarness({
    canJoinWorkspace: async () => {
      accessCount += 1;
      return accessCount === 2 ? staleAccess.promise : true;
    },
  });
  await harness.handlers.get(chatClientEvents.join)({ workspaceId });
  const staleJoin = harness.handlers.get(chatClientEvents.join)({ workspaceId });
  await Promise.resolve();

  await harness.handlers.get(chatClientEvents.join)({ workspaceId });
  staleAccess.reject(new Error("stale database failure"));
  await assert.doesNotReject(() => staleJoin);

  assert.deepEqual(new Set(harness.socket.rooms), new Set([
    createChatRoomName(workspaceId),
    createChatUserRoomName(workspaceId, "user-1"),
  ]));
  assert.equal(
    harness.emitted.some(({ payload }) => payload?.code === "internal_error"),
    false,
  );
});

test("stale adapter failure cleanup은 queue 뒤 성공한 rejoin을 보존한다", async () => {
  const staleAdapter = deferred();
  const userRoom = createChatUserRoomName(workspaceId, "user-1");
  let userJoinCount = 0;
  const harness = createHarness({
    join: async (roomName) => {
      if (roomName !== userRoom) return;
      userJoinCount += 1;
      if (userJoinCount === 2) {
        await staleAdapter.promise;
        throw new Error("stale adapter failure");
      }
    },
  });
  await harness.handlers.get(chatClientEvents.join)({ workspaceId });
  const staleJoin = harness.handlers.get(chatClientEvents.join)({ workspaceId });
  for (let attempt = 0; attempt < 10 && userJoinCount < 2; attempt += 1) {
    await Promise.resolve();
  }
  assert.equal(userJoinCount, 2);

  const successfulRejoin = harness.handlers.get(chatClientEvents.join)({ workspaceId });
  staleAdapter.resolve();
  await assert.doesNotReject(() => staleJoin);
  await successfulRejoin;

  assert.deepEqual(new Set(harness.socket.rooms), new Set([
    createChatRoomName(workspaceId),
    userRoom,
  ]));
  assert.equal(
    harness.emitted.some(({ payload }) => payload?.code === "internal_error"),
    false,
  );
});
