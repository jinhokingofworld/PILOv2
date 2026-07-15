import assert from "node:assert/strict";
import test from "node:test";

import { workspacePresenceClientEvents, workspacePresenceServerEvents } from "../../dist/workspace-presence/workspace-presence-events.js";
import { createWorkspacePresenceService } from "../../dist/workspace-presence/workspace-presence.service.js";
import { registerWorkspacePresenceSocketHandlers } from "../../dist/workspace-presence/workspace-presence-socket-handlers.js";

const workspaceId = "00000000-0000-0000-0000-000000000001";

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createHarness({ allowed = true, canJoinWorkspace, join } = {}) {
  const handlers = new Map();
  const emitted = [];
  const joinCalls = [];
  const leaveCalls = [];
  const roomEvents = [];
  const socket = {
    connected: true,
    data: { auth: { displayName: "세인", userId: "user-1" } },
    id: "socket-1",
    join: async (roomName) => {
      joinCalls.push(roomName);
      if (join) await join(roomName);
    },
    leave: async (roomName) => {
      leaveCalls.push(roomName);
    },
    rooms: new Set(),
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    to(roomName) {
      return io.to(roomName);
    },
  };
  const io = {
    to(roomName) {
      return {
        emit(event, payload) {
          roomEvents.push({ event, payload, roomName });
        },
      };
    },
  };
  const service = createWorkspacePresenceService();

  registerWorkspacePresenceSocketHandlers({
    accessService: {
      canJoinWorkspace: canJoinWorkspace ?? (async () => allowed),
    },
    io,
    service,
    socket,
  });

  return {
    emitted,
    handlers,
    joinCalls,
    leaveCalls,
    roomEvents,
    service,
    socket,
  };
}

test("authorized join은 roster를 반환하고 forbidden join은 거부한다", async () => {
  const allowed = createHarness();
  await allowed.handlers.get(workspacePresenceClientEvents.join)({ workspaceId });
  assert.equal(allowed.emitted.at(-1)?.event, workspacePresenceServerEvents.joined);
  assert.equal(allowed.emitted.at(-1)?.payload.presence.length, 1);

  const forbidden = createHarness({ allowed: false });
  await forbidden.handlers.get(workspacePresenceClientEvents.join)({ workspaceId });
  assert.deepEqual(forbidden.emitted.at(-1), {
    event: workspacePresenceServerEvents.error,
    payload: {
      code: "forbidden",
      message: "workspace presence access denied",
    },
  });
});

test("disconnect는 다른 탭이 남으면 update, 마지막 탭이면 leave를 보낸다", async () => {
  const harness = createHarness();
  await harness.handlers.get(workspacePresenceClientEvents.join)({ workspaceId });
  harness.service.joinSocket(
    "socket-2",
    { displayName: "세인", userId: "user-1" },
    workspaceId,
  );

  await harness.handlers.get("disconnect")();
  assert.equal(harness.roomEvents.at(-1)?.event, workspacePresenceServerEvents.update);

  const lastTab = createHarness();
  await lastTab.handlers.get(workspacePresenceClientEvents.join)({ workspaceId });
  await lastTab.handlers.get("disconnect")();
  assert.equal(lastTab.roomEvents.at(-1)?.event, workspacePresenceServerEvents.leave);
});

test("membership 확인 중 leave되면 stale join이 room과 service를 다시 만들지 않는다", async () => {
  const access = deferred();
  const harness = createHarness({
    canJoinWorkspace: () => access.promise,
  });

  const joinPromise = harness.handlers.get(workspacePresenceClientEvents.join)({
    workspaceId,
  });
  await Promise.resolve();
  await harness.handlers.get(workspacePresenceClientEvents.leave)({ workspaceId });
  access.resolve(true);
  await joinPromise;

  assert.equal(harness.joinCalls.length, 0);
  assert.equal(harness.service.getWorkspacePresence(workspaceId).length, 0);
  assert.equal(
    harness.emitted.some(
      ({ event }) => event === workspacePresenceServerEvents.joined,
    ),
    false,
  );
});

test("socket.join 대기 중 disconnect되면 stale join을 정리한다", async () => {
  const socketJoin = deferred();
  const harness = createHarness({ join: () => socketJoin.promise });

  const joinPromise = harness.handlers.get(workspacePresenceClientEvents.join)({
    workspaceId,
  });
  await Promise.resolve();
  await Promise.resolve();
  harness.handlers.get("disconnect")();
  socketJoin.resolve();
  await joinPromise;

  assert.equal(harness.service.getWorkspacePresence(workspaceId).length, 0);
  assert.equal(
    harness.emitted.some(
      ({ event }) => event === workspacePresenceServerEvents.joined,
    ),
    false,
  );
  assert.equal(harness.leaveCalls.length, 1);
});

test("background 새 탭 join은 기존 foreground 대표 상태를 broadcast한다", async () => {
  const harness = createHarness();
  harness.service.joinSocket(
    "socket-2",
    { displayName: "세인", userId: "user-1" },
    workspaceId,
  );
  harness.service.updateSocket("socket-2", {
    focused: true,
    location: {
      context: {},
      page: "home",
      route: { pathname: "/home", search: "" },
      viewport: { kind: "document", xRatio: 0.2, yRatio: 0.4 },
    },
    visible: true,
    workspaceId,
  });

  await harness.handlers.get(workspacePresenceClientEvents.join)({ workspaceId });

  const update = harness.roomEvents.find(
    ({ event }) => event === workspacePresenceServerEvents.update,
  );
  assert.equal(update?.payload.focused, true);
  assert.equal(update?.payload.location?.page, "home");
});
