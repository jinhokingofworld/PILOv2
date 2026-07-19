import assert from "node:assert/strict";
import test from "node:test";

import {
  createScreenShareFanOut,
} from "../../dist/screen-share/screen-share-fan-out.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

const validStartedEvent = {
  version: 1,
  event: "workspace-screen-share:started",
  workspaceId,
  session: {
    id: sessionId,
    sharer: {
      userId,
      displayName: "Screen sharer",
      avatarUrl: null,
    },
    startedAt: "2026-07-18T00:00:01.000Z",
  },
};

const validEndedEvent = {
  version: 1,
  event: "workspace-screen-share:ended",
  workspaceId,
  sessionId,
};

function createHarness() {
  const emitted = [];
  const fanOut = createScreenShareFanOut({
    emit(room, event, payload) {
      emitted.push({ room, event, payload });
    },
  });
  return { emitted, fanOut };
}

test("started event is relayed only to the authorized Workspace Presence room", () => {
  const { emitted, fanOut } = createHarness();

  assert.equal(fanOut.fanOut(validStartedEvent), true);
  assert.deepEqual(emitted, [
    {
      room: `workspace:${workspaceId}:presence`,
      event: "workspace-screen-share:started",
      payload: {
        event: "workspace-screen-share:started",
        session: validStartedEvent.session,
      },
    },
  ]);
  assert.equal("workspaceId" in emitted[0].payload, false);
  assert.equal("version" in emitted[0].payload, false);
});

test("ended event is relayed without its workspace routing identifier", () => {
  const { emitted, fanOut } = createHarness();

  assert.equal(fanOut.fanOut(validEndedEvent), true);
  assert.deepEqual(emitted, [
    {
      room: `workspace:${workspaceId}:presence`,
      event: "workspace-screen-share:ended",
      payload: {
        event: "workspace-screen-share:ended",
        sessionId,
      },
    },
  ]);
});

test("non-V1, malformed, and secret-bearing events are rejected", () => {
  const { emitted, fanOut } = createHarness();
  const invalidEvents = [
    { ...validStartedEvent, version: 2 },
    { ...validStartedEvent, workspaceId: "not-a-uuid" },
    {
      ...validStartedEvent,
      session: { ...validStartedEvent.session, startedAt: "2026-07-18" },
    },
    {
      ...validStartedEvent,
      session: { ...validStartedEvent.session, livekitToken: "secret" },
    },
    {
      ...validStartedEvent,
      session: {
        ...validStartedEvent.session,
        sharer: { ...validStartedEvent.session.sharer, extra: true },
      },
    },
    { ...validStartedEvent, livekitRoomName: "secret-room" },
    { ...validEndedEvent, sessionId: "not-a-uuid" },
  ];

  for (const invalidEvent of invalidEvents) {
    assert.equal(fanOut.fanOut(invalidEvent), false);
  }
  assert.deepEqual(emitted, []);
});
