import assert from "node:assert/strict";
import "reflect-metadata";
import { AppModule } from "../../dist/app.module.js";
import { TrackSource } from "livekit-server-sdk";
import { forbidden } from "../../dist/common/api-error.js";
import { ScreenShareController } from "../../dist/modules/screen-share/screen-share.controller.js";
import { ScreenShareModule } from "../../dist/modules/screen-share/screen-share.module.js";
import { ScreenShareRealtimePublisherService } from "../../dist/modules/screen-share/screen-share-realtime-publisher.service.js";
import { ScreenShareRoomService } from "../../dist/modules/screen-share/screen-share-room.service.js";
import { ScreenShareService } from "../../dist/modules/screen-share/screen-share.service.js";
import {
  WORKSPACE_SCREEN_SHARE_OUTBOX_STREAM,
  WORKSPACE_SCREEN_SHARE_REDIS_CHANNEL
} from "../../dist/modules/screen-share/screen-share.types.js";

const workspaceId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const otherUserId = "44444444-4444-4444-8444-444444444444";
const sessionId = "11111111-1111-4111-8111-111111111111";
const nextSessionId = "55555555-5555-4555-8555-555555555555";
const nowIso = "2026-07-18T00:00:00.000Z";
const startedAt = "2026-07-18T00:00:01.000Z";

const member = (memberUserId, overrides = {}) => ({
  id: `membership-${memberUserId}`,
  workspaceId,
  userId: memberUserId,
  role: "member",
  invitedByUserId: null,
  joinedAt: "2026-07-01T00:00:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  user: {
    id: memberUserId,
    name: memberUserId === userId ? "  민준  " : "다른 사용자",
    email: `${memberUserId}@example.com`,
    jobTitle: null,
    bio: null,
    avatarUrl: null,
    activeWorkspaceId: workspaceId,
    lastSeenAt: "2026-07-18T00:00:00.000Z",
    ...overrides
  }
});

const startingSession = (overrides = {}) => ({
  sessionId,
  workspaceId,
  sharerUserId: userId,
  sharerDisplayName: "민준",
  sharerAvatarUrl: null,
  sharerLiveKitIdentity: `screen-share:${sessionId}:${userId}`,
  livekitRoomName: `pilo-screen-share-${sessionId}`,
  status: "starting",
  createdAt: nowIso,
  startedAt: null,
  ...overrides
});

const activeSession = (overrides = {}) =>
  startingSession({ status: "active", startedAt, ...overrides });

class FakeWorkspaceService {
  constructor(members = [member(userId), member(otherUserId)]) {
    this.members = members;
  }

  accessCalls = [];
  listCalls = [];

  async assertWorkspaceAccess(currentUserId, requestedWorkspaceId) {
    this.accessCalls.push({ currentUserId, workspaceId: requestedWorkspaceId });
    const found = this.members.find(
      item =>
        item.workspaceId === requestedWorkspaceId &&
        item.userId === currentUserId
    );
    if (!found) throw forbidden("Workspace access denied");
    return {
      id: requestedWorkspaceId,
      name: "PILO",
      icon: null,
      ownerUserId: null,
      role: found.role,
      isOwner: found.role === "owner",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    };
  }

  async listMembers(currentUserId, requestedWorkspaceId) {
    this.listCalls.push({ currentUserId, workspaceId: requestedWorkspaceId });
    await this.assertWorkspaceAccess(currentUserId, requestedWorkspaceId);
    return this.members.filter(item => item.workspaceId === requestedWorkspaceId);
  }
}

class FakeStateService {
  constructor(current = null) {
    this.current = current;
  }

  getCalls = [];
  reserveCalls = [];
  endCalls = [];
  cleanupModes = [];
  pendingEvents = [];
  releaseStartingCalls = [];
  replaceExpiredStartingCalls = [];
  rollbackAttemptId = null;
  failReserve = false;
  beforeTerminate = null;

  async getCurrent(requestedWorkspaceId) {
    this.getCalls.push(requestedWorkspaceId);
    return this.current;
  }

  async reserve(session, rollbackAttemptId) {
    this.reserveCalls.push(session);
    if (this.failReserve) throw new Error("Redis unavailable");
    if (this.current) return false;
    this.current = session;
    this.rollbackAttemptId = rollbackAttemptId;
    return true;
  }

  async terminateIfCurrent(input, cleanupMode = "revocation") {
    this.endCalls.push(input);
    this.cleanupModes.push(cleanupMode);
    this.beforeTerminate?.(input);
    if (
      this.current?.workspaceId !== input.workspaceId ||
      this.current?.sessionId !== input.sessionId ||
      this.current?.livekitRoomName !== input.livekitRoomName
    ) {
      return null;
    }
    const ended = this.current;
    this.current = null;
    this.rollbackAttemptId = null;
    const outboxId = `outbox-${this.pendingEvents.length + 1}`;
    this.pendingEvents.push({
      id: outboxId,
      event: {
        version: 1,
        event: "workspace-screen-share:ended",
        workspaceId: ended.workspaceId,
        sessionId: ended.sessionId
      }
    });
    return { session: ended, outboxId };
  }

  async releaseStartingIfCurrent(input) {
    this.releaseStartingCalls.push(input);
    if (
      this.current?.workspaceId !== input.workspaceId ||
      this.current.sessionId !== input.sessionId ||
      this.current.livekitRoomName !== input.livekitRoomName ||
      this.current.status !== "starting" ||
      this.rollbackAttemptId !== input.rollbackAttemptId
    ) {
      return null;
    }
    const released = this.current;
    this.current = null;
    this.rollbackAttemptId = null;
    return released;
  }

  async claimStartingReservation(input) {
    if (
      this.current?.workspaceId !== input.workspaceId ||
      this.current.sessionId !== input.sessionId ||
      this.current.livekitRoomName !== input.livekitRoomName ||
      this.current.status !== "starting"
    ) {
      return null;
    }
    this.rollbackAttemptId = input.rollbackAttemptId;
    this.current = { ...this.current, createdAt: input.claimedAt };
    return this.current;
  }

  async replaceExpiredStartingIfCurrent(input, candidate, rollbackAttemptId) {
    this.replaceExpiredStartingCalls.push({ input, candidate, rollbackAttemptId });
    if (
      this.current?.workspaceId !== input.workspaceId ||
      this.current.sessionId !== input.sessionId ||
      this.current.livekitRoomName !== input.livekitRoomName ||
      this.current.status !== "starting" ||
      this.current.createdAt !== input.createdAt ||
      this.current.createdAt > input.expiredBefore
    ) {
      return false;
    }
    this.current = candidate;
    this.rollbackAttemptId = rollbackAttemptId;
    return true;
  }
}

class FakeTokenService {
  publisherCalls = [];
  viewerCalls = [];
  publisherFailures = 0;
  beforePublisherFailure = null;
  publisherError = new Error("publisher token failed");

  async createPublisherToken(input) {
    this.publisherCalls.push(input);
    if (this.publisherFailures > 0) {
      this.publisherFailures -= 1;
      await this.beforePublisherFailure?.();
      throw this.publisherError;
    }
    return {
      livekitUrl: "wss://screen-share.test",
      livekitToken: `publisher-token-${this.publisherCalls.length}`,
      expiresAt: "2026-07-18T00:01:00.000Z"
    };
  }

  async createViewerToken(input) {
    this.viewerCalls.push(input);
    return {
      livekitUrl: "wss://screen-share.test",
      livekitToken: `viewer-token-${this.viewerCalls.length}`,
      expiresAt: "2026-07-18T01:00:00.000Z"
    };
  }
}

class FakeRoomService {
  active = true;
  activeCalls = [];
  removeCalls = [];
  deleteCalls = [];
  revocationCalls = [];
  revocationFailures = 0;
  beforeActiveResult = null;
  removeFailures = 0;
  deleteFailures = 0;

  async hasActiveScreenTrack(session) {
    this.activeCalls.push(session);
    this.beforeActiveResult?.();
    return this.active;
  }

  async removeParticipant(session) {
    this.removeCalls.push(session);
    if (this.removeFailures > 0) {
      this.removeFailures -= 1;
      throw new Error("LiveKit cleanup failed");
    }
  }

  async deleteRoom(session) {
    this.deleteCalls.push(session);
    if (this.deleteFailures > 0) {
      this.deleteFailures -= 1;
      throw new Error("LiveKit cleanup failed");
    }
  }

  async removeParticipantForRevocation(session) {
    this.revocationCalls.push(session);
    if (this.revocationFailures > 0) {
      this.revocationFailures -= 1;
      throw new Error("LiveKit cleanup failed");
    }
  }
}

class FakeRealtimePublisher {
  constructor(state) {
    this.state = state;
  }

  attempts = [];
  events = [];
  failures = 0;
  beforePublish = null;

  async publish(event) {
    this.attempts.push(event);
    this.beforePublish?.(event);
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("screen-share publish failed");
    }
    this.events.push(event);
  }

  async flushPendingEvents() {
    let delivered = 0;
    while (this.state.pendingEvents.length > 0) {
      const pending = this.state.pendingEvents[0];
      this.attempts.push(pending.event);
      this.beforePublish?.(pending.event);
      if (this.failures > 0) {
        this.failures -= 1;
        throw new Error("screen-share publish failed");
      }
      this.events.push(pending.event);
      this.state.pendingEvents.shift();
      delivered += 1;
    }
    return delivered;
  }
}

class TestScreenShareService extends ScreenShareService {
  constructor(
    state,
    tokens,
    rooms,
    realtime,
    workspaces,
    { uuids = [sessionId], currentTime = nowIso } = {}
  ) {
    super(state, tokens, rooms, realtime, workspaces);
    this.uuids = [...uuids];
    this.currentTime = currentTime;
  }

  createUuid() {
    const value = this.uuids.shift();
    assert.ok(value, "test UUID queue must not be empty");
    return value;
  }

  now() {
    return new Date(this.currentTime);
  }
}

const createHarness = ({
  current = null,
  members,
  uuids,
  currentTime
} = {}) => {
  const state = new FakeStateService(current);
  const tokens = new FakeTokenService();
  const rooms = new FakeRoomService();
  const realtime = new FakeRealtimePublisher(state);
  const workspaces = new FakeWorkspaceService(members);
  const service = new TestScreenShareService(
    state,
    tokens,
    rooms,
    realtime,
    workspaces,
    { uuids, currentTime }
  );
  return { service, state, tokens, rooms, realtime, workspaces };
};

{
  const harness = createHarness({ current: activeSession() });
  assert.deepEqual(await harness.service.getCurrent(userId, workspaceId), {
    session: {
      id: sessionId,
      sharer: {
        userId,
        displayName: "민준",
        avatarUrl: null
      },
      startedAt
    }
  });
  assert.equal(harness.rooms.activeCalls.length, 1);
  assert.deepEqual(harness.workspaces.accessCalls, [
    { currentUserId: userId, workspaceId }
  ]);
}

{
  const harness = createHarness({ members: [member(userId)] });
  await assert.rejects(
    () => harness.service.getCurrent(otherUserId, workspaceId),
    error => error.getStatus() === 403
  );
  assert.equal(harness.state.getCalls.length, 0);
}

const startHarness = createHarness({ uuids: [sessionId, nextSessionId] });
const started = await startHarness.service.start(userId, workspaceId);
assert.deepEqual(started, {
  id: sessionId,
  status: "starting",
  sharer: {
    userId,
    displayName: "민준",
    avatarUrl: null
  },
  startedAt: null,
  livekitUrl: "wss://screen-share.test",
  livekitToken: "publisher-token-1",
  expiresAt: "2026-07-18T00:01:00.000Z"
});
assert.equal(started.status, "starting");
assert.equal(started.startedAt, null);
assert.equal(started.livekitRoomName, undefined);
assert.deepEqual(startHarness.state.current, startingSession());
assert.deepEqual(startHarness.tokens.publisherCalls, [
  {
    identity: `screen-share:${sessionId}:${userId}`,
    roomName: `pilo-screen-share-${sessionId}`,
    participantName: "민준"
  }
]);
assert.equal(startHarness.service.getStartHttpStatus(started), 201);

{
  const recovered = await startHarness.service.start(userId, workspaceId);
  assert.equal(recovered.id, sessionId);
  assert.equal(recovered.livekitToken, "publisher-token-2");
  assert.equal(startHarness.state.reserveCalls.length, 2);
  assert.equal(startHarness.service.getStartHttpStatus(recovered), 200);
}

{
  const harness = createHarness({
    current: startingSession(),
    currentTime: "2026-07-18T00:02:00.000Z",
    uuids: [nextSessionId]
  });
  const recovered = await harness.service.start(userId, workspaceId);
  assert.equal(recovered.id, sessionId);
  assert.equal(
    harness.state.current?.createdAt,
    "2026-07-18T00:02:00.000Z",
    "same-owner recovery must refresh the protected starting lease"
  );
  assert.equal(harness.rooms.activeCalls.length, 0);
}

{
  const harness = createHarness({ uuids: [sessionId, nextSessionId] });
  harness.tokens.publisherFailures = 1;
  await assert.rejects(
    () => harness.service.start(userId, workspaceId),
    error => error === harness.tokens.publisherError
  );
  assert.equal(
    harness.state.current,
    null,
    "a newly reserved session must not retain the 12-hour starting lock"
  );

  const next = await harness.service.start(otherUserId, workspaceId);
  assert.equal(next.id, nextSessionId);
  assert.equal(next.sharer.userId, otherUserId);
}

{
  const existing = startingSession();
  const harness = createHarness({ current: existing });
  harness.tokens.publisherFailures = 1;
  await assert.rejects(
    () => harness.service.start(userId, workspaceId),
    error => error === harness.tokens.publisherError
  );
  assert.deepEqual(harness.state.current, existing);
  assert.equal(
    harness.state.endCalls.length,
    0,
    "same-owner recovery reservations must not be rolled back"
  );
}

{
  const replacement = startingSession({
    sessionId: nextSessionId,
    sharerLiveKitIdentity: `screen-share:${nextSessionId}:${otherUserId}`,
    livekitRoomName: `pilo-screen-share-${nextSessionId}`,
    sharerUserId: otherUserId
  });
  const harness = createHarness({ uuids: [sessionId] });
  harness.tokens.publisherFailures = 1;
  harness.tokens.beforePublisherFailure = () => {
    harness.state.current = replacement;
  };
  await assert.rejects(() => harness.service.start(userId, workspaceId));
  assert.deepEqual(harness.state.current, replacement);
  assert.equal(harness.state.releaseStartingCalls.length, 1);
}

{
  const activated = activeSession();
  const harness = createHarness({ uuids: [sessionId] });
  harness.tokens.publisherFailures = 1;
  harness.tokens.beforePublisherFailure = () => {
    harness.state.current = activated;
  };
  await assert.rejects(
    () => harness.service.start(userId, workspaceId),
    error => error === harness.tokens.publisherError
  );
  assert.deepEqual(
    harness.state.current,
    activated,
    "an older token failure must not roll back the same session after activation"
  );
}

{
  const harness = createHarness({ uuids: [sessionId, nextSessionId] });
  let recovered = null;
  harness.tokens.publisherFailures = 1;
  harness.tokens.beforePublisherFailure = async () => {
    recovered = await harness.service.start(userId, workspaceId);
  };
  await assert.rejects(
    () => harness.service.start(userId, workspaceId),
    error => error === harness.tokens.publisherError
  );
  assert.equal(recovered?.id, sessionId);
  assert.equal(recovered?.livekitToken, "publisher-token-2");
  assert.deepEqual(
    harness.state.current,
    startingSession(),
    "an older token failure must preserve a concurrently recovered token"
  );
}

{
  const harness = createHarness({
    members: [member(userId, { name: "  ", email: "  member@example.com  " })],
    uuids: [sessionId]
  });
  const result = await harness.service.start(userId, workspaceId);
  assert.equal(result.sharer.displayName, "member@example.com");
}

{
  const harness = createHarness({
    members: [member(userId, { name: null, email: null })],
    uuids: [sessionId]
  });
  const result = await harness.service.start(userId, workspaceId);
  assert.equal(result.sharer.displayName, "PILO");
}

{
  const harness = createHarness({
    current: startingSession({
      sharerUserId: otherUserId,
      sharerDisplayName: "다른 사용자",
      sharerLiveKitIdentity: `screen-share:${sessionId}:${otherUserId}`
    })
  });
  await assert.rejects(
    () => harness.service.start(userId, workspaceId),
    error => {
      assert.equal(error.getStatus(), 409);
      assert.equal(
        error.getResponse().error.code,
        "SCREEN_SHARE_ALREADY_ACTIVE"
      );
      assert.equal(error.getResponse().error.details, undefined);
      return true;
    }
  );
  assert.equal(harness.tokens.publisherCalls.length, 0);
  assert.equal(
    harness.rooms.activeCalls.length,
    0,
    "a fresh starting lease must be protected without LiveKit reclamation"
  );
}

{
  const expired = startingSession({
    sharerUserId: otherUserId,
    sharerDisplayName: "Other member",
    sharerLiveKitIdentity: `screen-share:${sessionId}:${otherUserId}`
  });
  const harness = createHarness({
    current: expired,
    currentTime: "2026-07-18T00:02:00.000Z",
    uuids: [nextSessionId]
  });
  harness.rooms.active = false;

  const result = await harness.service.start(userId, workspaceId);

  assert.equal(result.id, nextSessionId);
  assert.equal(result.sharer.userId, userId);
  assert.equal(harness.rooms.activeCalls.length, 1);
  assert.equal(harness.state.replaceExpiredStartingCalls.length, 1);
  assert.equal(harness.state.current?.sessionId, nextSessionId);
  assert.deepEqual(harness.rooms.revocationCalls, [expired]);
  assert.deepEqual(harness.rooms.removeCalls, []);
  assert.deepEqual(harness.rooms.deleteCalls, [expired]);
}

{
  const expired = startingSession({
    sharerUserId: otherUserId,
    sharerDisplayName: "Other member",
    sharerLiveKitIdentity: `screen-share:${sessionId}:${otherUserId}`
  });
  const harness = createHarness({
    current: expired,
    currentTime: "2026-07-18T00:02:00.000Z",
    uuids: [nextSessionId]
  });
  harness.rooms.active = false;
  harness.rooms.revocationFailures = 1;

  await assert.rejects(() => harness.service.start(userId, workspaceId));
  assert.equal(
    harness.state.current,
    null,
    "a failed old-room cleanup must roll back the unissued replacement"
  );
  assert.equal(harness.tokens.publisherCalls.length, 0);
}

{
  const expired = startingSession({
    sharerUserId: otherUserId,
    sharerDisplayName: "Other member",
    sharerLiveKitIdentity: `screen-share:${sessionId}:${otherUserId}`
  });
  const harness = createHarness({
    current: expired,
    currentTime: "2026-07-18T00:02:00.000Z",
    uuids: [nextSessionId]
  });

  await assert.rejects(
    () => harness.service.start(userId, workspaceId),
    error => error.getStatus() === 409
  );
  assert.deepEqual(harness.state.current, expired);
  assert.equal(harness.state.replaceExpiredStartingCalls.length, 0);
}

{
  const expired = startingSession({
    sharerUserId: otherUserId,
    sharerDisplayName: "Other member",
    sharerLiveKitIdentity: `screen-share:${sessionId}:${otherUserId}`
  });
  const replacement = startingSession({
    sessionId: "66666666-6666-4666-8666-666666666666",
    sharerUserId: otherUserId,
    sharerDisplayName: "Other member",
    sharerLiveKitIdentity:
      "screen-share:66666666-6666-4666-8666-666666666666:44444444-4444-4444-8444-444444444444",
    livekitRoomName:
      "pilo-screen-share-66666666-6666-4666-8666-666666666666",
    createdAt: "2026-07-18T00:02:00.000Z"
  });
  const harness = createHarness({
    current: expired,
    currentTime: "2026-07-18T00:02:00.000Z",
    uuids: [nextSessionId]
  });
  harness.rooms.active = false;
  harness.rooms.beforeActiveResult = () => {
    harness.state.current = replacement;
  };

  await assert.rejects(
    () => harness.service.start(userId, workspaceId),
    error => error.getStatus() === 409
  );
  assert.deepEqual(harness.state.current, replacement);
}

{
  const harness = createHarness({
    current: activeSession(),
    uuids: [nextSessionId]
  });
  harness.rooms.active = false;
  const result = await harness.service.start(userId, workspaceId);
  assert.equal(result.id, nextSessionId);
  assert.equal(harness.state.reserveCalls.length, 2);
  assert.equal(harness.state.endCalls.length, 1);
  assert.equal(harness.tokens.publisherCalls.length, 1);
}

{
  const starting = createHarness({ current: startingSession() });
  await assert.rejects(
    () =>
      starting.service.createViewerToken(userId, workspaceId, sessionId),
    error => error.getStatus() === 404
  );
  assert.equal(starting.tokens.viewerCalls.length, 0);

  const active = createHarness({
    current: activeSession(),
    uuids: [nextSessionId]
  });
  assert.deepEqual(
    await active.service.createViewerToken(otherUserId, workspaceId, sessionId),
    {
      livekitUrl: "wss://screen-share.test",
      livekitToken: "viewer-token-1",
      expiresAt: "2026-07-18T01:00:00.000Z"
    }
  );
  assert.deepEqual(active.tokens.viewerCalls, [
    {
      identity: `screen-share-viewer:${sessionId}:${otherUserId}:${nextSessionId}`,
      roomName: `pilo-screen-share-${sessionId}`,
      participantName: otherUserId
    }
  ]);

  await assert.rejects(
    () => active.service.createViewerToken(userId, workspaceId, sessionId),
    error =>
      error.getStatus() === 403 &&
      error.getResponse().error.message ===
        "The screen sharer cannot request a viewer token"
  );
  assert.equal(active.tokens.viewerCalls.length, 1);
}

{
  const harness = createHarness({ current: activeSession() });
  await assert.rejects(
    () => harness.service.end(otherUserId, workspaceId, sessionId),
    error => error.getStatus() === 403
  );
  assert.equal(harness.state.endCalls.length, 0);
}

{
  const harness = createHarness({ current: activeSession() });
  assert.notEqual(
    (await harness.service.getCurrent(userId, workspaceId)).session,
    null
  );
  assert.equal(harness.state.endCalls.length, 0);

  harness.rooms.active = false;
  assert.equal(
    (await harness.service.getCurrent(userId, workspaceId)).session,
    null,
    "stale Redis state is reconciled before returning current"
  );
  assert.deepEqual(harness.state.endCalls, [
    {
      workspaceId,
      sessionId,
      livekitRoomName: `pilo-screen-share-${sessionId}`
    }
  ]);
  assert.deepEqual(harness.realtime.events, [
    {
      version: 1,
      event: "workspace-screen-share:ended",
      workspaceId,
      sessionId
    }
  ]);
}

{
  const oldSession = activeSession();
  const replacement = activeSession({
    sessionId: nextSessionId,
    sharerLiveKitIdentity: `screen-share:${nextSessionId}:${userId}`,
    livekitRoomName: `pilo-screen-share-${nextSessionId}`
  });
  const harness = createHarness({ current: oldSession });
  harness.rooms.active = false;
  harness.rooms.beforeActiveResult = () => {
    harness.state.current = replacement;
  };
  assert.equal(
    (await harness.service.getCurrent(userId, workspaceId)).session,
    null
  );
  assert.deepEqual(harness.state.current, replacement);
  assert.deepEqual(
    harness.realtime.events,
    [],
    "a failed current-session CAS must not enqueue an ended event"
  );
}

{
  const harness = createHarness({ uuids: [sessionId] });
  harness.state.failReserve = true;
  await assert.rejects(() => harness.service.start(userId, workspaceId));
  assert.equal(
    harness.tokens.publisherCalls.length,
    0,
    "a publisher token must not be issued after Redis failure"
  );
}

{
  const harness = createHarness({ current: activeSession() });
  assert.deepEqual(
    await harness.service.end(userId, workspaceId, "stale-session-id"),
    { sessionId: "stale-session-id", ended: true }
  );
  assert.deepEqual(harness.state.current, activeSession());
  assert.equal(harness.rooms.removeCalls.length, 0);
  assert.equal(harness.rooms.deleteCalls.length, 0);

  assert.deepEqual(await harness.service.end(userId, workspaceId, sessionId), {
    sessionId,
    ended: true
  });
  assert.equal(harness.rooms.revocationCalls.length, 1);
  assert.equal(harness.rooms.deleteCalls.length, 1);
}

{
  const harness = createHarness({ current: activeSession() });
  harness.realtime.failures = 1;
  assert.deepEqual(await harness.service.end(userId, workspaceId, sessionId), {
    sessionId,
    ended: true
  });
  assert.equal(harness.state.current, null);
  assert.equal(harness.state.pendingEvents.length, 1);
  assert.equal(harness.rooms.revocationCalls.length, 1);
  assert.equal(harness.rooms.deleteCalls.length, 1);

  assert.deepEqual(await harness.service.end(userId, workspaceId, sessionId), {
    sessionId,
    ended: true
  });
  assert.equal(harness.state.current, null);
  assert.equal(harness.realtime.attempts.length, 2);
  assert.equal(harness.rooms.revocationCalls.length, 1);
  assert.equal(harness.rooms.deleteCalls.length, 1);
}

{
  const replacement = activeSession({
    sessionId: nextSessionId,
    sharerLiveKitIdentity: `screen-share:${nextSessionId}:${otherUserId}`,
    livekitRoomName: `pilo-screen-share-${nextSessionId}`,
    sharerUserId: otherUserId
  });
  const harness = createHarness({ current: activeSession() });
  harness.state.beforeTerminate = () => {
    harness.state.current = replacement;
  };
  await harness.service.end(userId, workspaceId, sessionId);
  assert.deepEqual(harness.state.current, replacement);
  assert.equal(harness.rooms.removeCalls.length, 0);
  assert.equal(harness.rooms.deleteCalls.length, 0);
  assert.equal(harness.realtime.events.length, 0);
}

{
  const harness = createHarness({ current: activeSession() });
  assert.equal(
    await harness.service.endForRevocation(workspaceId, otherUserId),
    false
  );
  assert.equal(harness.state.current?.sessionId, sessionId);
  assert.equal(harness.state.endCalls.length, 0);

  assert.equal(
    await harness.service.endForRevocation(workspaceId, userId),
    true
  );
  assert.equal(harness.state.current, null);
  assert.deepEqual(harness.rooms.revocationCalls, [activeSession()]);
  assert.equal(harness.state.cleanupModes.at(-1), "revocation");
  assert.deepEqual(harness.realtime.events, [
    {
      version: 1,
      event: "workspace-screen-share:ended",
      workspaceId,
      sessionId
    }
  ]);
}

{
  const replacement = activeSession({
    sessionId: nextSessionId,
    sharerLiveKitIdentity: `screen-share:${nextSessionId}:${otherUserId}`,
    livekitRoomName: `pilo-screen-share-${nextSessionId}`,
    sharerUserId: otherUserId
  });
  const harness = createHarness({ current: activeSession() });
  harness.state.beforeTerminate = () => {
    harness.state.current = replacement;
  };
  assert.equal(
    await harness.service.endForRevocation(workspaceId, userId),
    false
  );
  assert.deepEqual(harness.state.current, replacement);
  assert.equal(harness.rooms.revocationCalls.length, 0);
  assert.equal(harness.rooms.deleteCalls.length, 0);
  assert.equal(harness.realtime.events.length, 0);
}

class TestScreenShareRoomService extends ScreenShareRoomService {
  constructor(client) {
    super();
    this.client = client;
  }

  createRoomServiceClient(config) {
    assert.deepEqual(config, {
      livekitApiUrl: "https://screen-share.test",
      apiKey: "screen-share-api-key",
      apiSecret: "screen-share-api-secret"
    });
    return this.client;
  }
}

class FakeLiveKitRoomClient {
  participants = [];
  listCalls = [];
  removeCalls = [];
  deleteCalls = [];

  async listParticipants(roomName) {
    this.listCalls.push(roomName);
    return this.participants;
  }

  async removeParticipant(roomName, identity) {
    this.removeCalls.push({ roomName, identity });
  }

  async deleteRoom(roomName) {
    this.deleteCalls.push(roomName);
  }
}

const originalEnv = {
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
  LIVEKIT_URL: process.env.LIVEKIT_URL,
  REDIS_URL: process.env.REDIS_URL
};

process.env.LIVEKIT_API_KEY = "screen-share-api-key";
process.env.LIVEKIT_API_SECRET = "screen-share-api-secret";
process.env.LIVEKIT_URL = "wss://screen-share.test";
process.env.REDIS_URL = "redis://screen-share.test:6379";

try {
  const client = new FakeLiveKitRoomClient();
  const rooms = new TestScreenShareRoomService(client);
  const session = activeSession();

  client.participants = [
    {
      identity: session.sharerLiveKitIdentity,
      tracks: [{ source: TrackSource.SCREEN_SHARE, muted: true }]
    }
  ];
  assert.equal(await rooms.hasActiveScreenTrack(session), false);

  client.participants[0].tracks[0].muted = false;
  assert.equal(await rooms.hasActiveScreenTrack(session), true);

  client.participants[0].identity = "unexpected-participant";
  assert.equal(await rooms.hasActiveScreenTrack(session), false);

  await rooms.removeParticipant(session);
  await rooms.deleteRoom(session);
  assert.deepEqual(client.removeCalls, [
    {
      roomName: session.livekitRoomName,
      identity: session.sharerLiveKitIdentity
    }
  ]);
  assert.deepEqual(client.deleteCalls, [session.livekitRoomName]);

  class FakeRedisPublisherClient {
    publishCalls = [];
    outboxEntries = [];
    outboxPublishAttempts = [];
    receiverCount = 0;

    on() {
      return this;
    }

    async connect() {}

    async publish(channel, message) {
      this.publishCalls.push({ channel, message });
      return 1;
    }

    async xRange(key) {
      assert.equal(key, WORKSPACE_SCREEN_SHARE_OUTBOX_STREAM);
      return this.outboxEntries.map(entry => ({
        id: entry.id,
        message: { event: entry.event }
      }));
    }

    async eval(script, options) {
      assert.match(script, /DELIVER_WORKSPACE_SCREEN_SHARE_OUTBOX_EVENT/);
      const entry = this.outboxEntries.find(item => item.id === options.arguments[0]);
      if (!entry) return 0;
      this.outboxPublishAttempts.push(entry.event);
      if (this.receiverCount < 1) return 0;
      this.outboxEntries = this.outboxEntries.filter(item => item.id !== entry.id);
      this.publishCalls.push({
        channel: options.arguments[1],
        message: entry.event
      });
      return 1;
    }

    async quit() {}

    destroy() {}
  }

  class TestRealtimePublisher extends ScreenShareRealtimePublisherService {
    constructor(redisClient) {
      super();
      this.redisClient = redisClient;
    }

    createRedisClient(redisUrl) {
      assert.equal(redisUrl, "redis://screen-share.test:6379");
      return this.redisClient;
    }
  }

  const redisClient = new FakeRedisPublisherClient();
  const publisher = new TestRealtimePublisher(redisClient);
  const event = {
    version: 1,
    event: "workspace-screen-share:ended",
    workspaceId,
    sessionId
  };
  await publisher.publish(event);
  assert.deepEqual(redisClient.publishCalls, [
    {
      channel: WORKSPACE_SCREEN_SHARE_REDIS_CHANNEL,
      message: JSON.stringify(event)
    }
  ]);

  redisClient.outboxEntries.push({ id: "1-0", event: JSON.stringify(event) });
  assert.equal(await publisher.flushPendingEvents(), 0);
  assert.equal(redisClient.outboxEntries.length, 1);
  redisClient.receiverCount = 1;
  assert.equal(await publisher.flushPendingEvents(), 1);
  assert.equal(redisClient.outboxEntries.length, 0);
  assert.equal(await publisher.flushPendingEvents(), 0);
  assert.equal(
    redisClient.publishCalls.filter(call => call.message === JSON.stringify(event)).length,
    2,
    "one direct publish and one outbox handoff must not be duplicated by retries"
  );
  await publisher.onModuleDestroy();
} finally {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

{
  const controllerTokenPayload = {
    livekitUrl: "wss://screen-share.test",
    livekitToken: "publisher-token",
    expiresAt: "2026-07-18T01:00:00.000Z"
  };
  const controllerPayload = {
    id: sessionId,
    status: "starting",
    sharer: { userId, displayName: "민준", avatarUrl: null },
    startedAt: null,
    ...controllerTokenPayload
  };
  const fakeService = {
    async getCurrent() {
      return { session: null };
    },
    async start() {
      return controllerPayload;
    },
    async createViewerToken() {
      return controllerTokenPayload;
    },
    async end() {
      return { sessionId, ended: true };
    },
    getStartHttpStatus() {
      return 200;
    }
  };
  const controller = new ScreenShareController(fakeService);
  const response = {
    statusCode: null,
    status(value) {
      this.statusCode = value;
      return this;
    }
  };

  assert.deepEqual(await controller.getCurrent(userId, workspaceId), {
    success: true,
    data: { session: null }
  });
  assert.deepEqual(
    await controller.start(userId, workspaceId, response),
    { success: true, data: controllerPayload }
  );
  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    await controller.viewerToken(userId, workspaceId, sessionId),
    { success: true, data: controllerTokenPayload }
  );
  assert.deepEqual(await controller.end(userId, workspaceId, sessionId), {
    success: true,
    data: { sessionId, ended: true }
  });

  assert.equal(
    Reflect.getMetadata("path", ScreenShareController),
    "workspaces/:workspaceId/screen-share-sessions"
  );
  assert.ok(
    Reflect.getMetadata("imports", AppModule).includes(ScreenShareModule),
    "AppModule registers ScreenShareModule"
  );
}

console.log("screen-share API lifecycle tests passed");
