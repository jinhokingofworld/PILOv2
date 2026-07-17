import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkspaceMembershipRevocationFence,
} from "../../dist/workspace-membership-revocation/workspace-membership-revocation.js";
import {
  meetingClientEvents,
  meetingServerEvents,
} from "../../dist/meeting/meeting-socket-events.js";
import { registerMeetingSocketHandlers } from "../../dist/meeting/meeting-socket-handlers.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createHarness({ canJoinWorkspace, join } = {}) {
  const handlers = new Map();
  const emitted = [];
  const joinCalls = [];
  const leaveCalls = [];
  const fence = createWorkspaceMembershipRevocationFence();
  const socket = {
    data: { auth: { userId } },
    id: "meeting-socket-1",
    async join(roomName) {
      joinCalls.push(roomName);
      if (join) await join(roomName);
    },
    async leave(roomName) {
      leaveCalls.push(roomName);
    },
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
  };
  const io = {
    sockets: {
      adapter: { rooms: new Map() },
      sockets: new Map([[socket.id, socket]]),
    },
  };

  registerMeetingSocketHandlers({
    accessService: {
      canJoinWorkspace: canJoinWorkspace ?? (async () => true),
    },
    membershipRevocationFence: fence,
    socket,
  });

  return { emitted, fence, handlers, io, joinCalls, leaveCalls, socket };
}

test("철회가 access 확인 중 발생하면 Meeting subscribe는 room에 들어가지 않는다", async () => {
  const access = deferred();
  const harness = createHarness({ canJoinWorkspace: () => access.promise });

  const subscribe = harness.handlers.get(meetingClientEvents.subscribe)({ workspaceId });
  await Promise.resolve();
  harness.fence.revokeUserWorkspace(harness.io, userId, workspaceId);
  access.resolve(true);
  await subscribe;

  assert.deepEqual(harness.joinCalls, []);
  assert.deepEqual(harness.emitted.at(-1), {
    event: meetingServerEvents.error,
    payload: { code: "forbidden", message: "meeting room access denied" },
  });
});

test("철회가 socket.join 중 발생하면 Meeting room join을 rollback한다", async () => {
  const joining = deferred();
  const harness = createHarness({ join: () => joining.promise });

  const subscribe = harness.handlers.get(meetingClientEvents.subscribe)({ workspaceId });
  await Promise.resolve();
  harness.fence.revokeUserWorkspace(harness.io, userId, workspaceId);
  joining.resolve();
  await subscribe;

  assert.equal(harness.joinCalls.length, 1);
  assert.deepEqual(harness.leaveCalls, harness.joinCalls);
  assert.equal(
    harness.emitted.some(({ event }) => event === meetingServerEvents.subscribed),
    false,
  );
});
