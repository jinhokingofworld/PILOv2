import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import "reflect-metadata";
import { TrackSource } from "livekit-server-sdk";
import { MeetingModule } from "../../dist/modules/meeting/meeting.module.js";
import { LiveKitWebhookService } from "../../dist/modules/meeting/livekit-webhook.service.js";
import { ScreenShareCleanupService } from "../../dist/modules/screen-share/screen-share-cleanup.service.js";
import { ScreenShareDeadlineService } from "../../dist/modules/screen-share/screen-share-deadline.service.js";
import { ScreenShareMembershipRevocationService } from "../../dist/modules/screen-share/screen-share-membership-revocation.service.js";
import { ScreenShareModule } from "../../dist/modules/screen-share/screen-share.module.js";
import { ScreenShareRoomService } from "../../dist/modules/screen-share/screen-share-room.service.js";
import { ScreenShareWebhookService } from "../../dist/modules/screen-share/screen-share-webhook.service.js";

const require = createRequire(import.meta.url);
const { AccessToken } = require("livekit-server-sdk");

const workspaceId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const otherUserId = "44444444-4444-4444-8444-444444444444";
const sessionId = "11111111-1111-4111-8111-111111111111";
const nextSessionId = "55555555-5555-4555-8555-555555555555";
const eventSeconds = 1784332801n;
const eventIso = "2026-07-18T00:00:01.000Z";

const startingSession = (overrides = {}) => ({
  sessionId,
  workspaceId,
  sharerUserId: userId,
  sharerDisplayName: "민준",
  sharerAvatarUrl: null,
  sharerLiveKitIdentity: `screen-share:${sessionId}:${userId}`,
  livekitRoomName: `pilo-screen-share-${sessionId}`,
  status: "starting",
  createdAt: "2026-07-18T00:00:00.000Z",
  startedAt: null,
  ...overrides
});

const activeSession = (overrides = {}) =>
  startingSession({ status: "active", startedAt: eventIso, ...overrides });

const webhookEvent = (event, overrides = {}) => ({
  id: `event-${event}`,
  event,
  room: { name: `pilo-screen-share-${sessionId}` },
  participant: { identity: `screen-share:${sessionId}:${userId}` },
  track: { source: TrackSource.SCREEN_SHARE },
  createdAt: eventSeconds,
  ...overrides
});

class FakeStateService {
  constructor(current, order = []) {
    this.current = current;
    this.order = order;
  }

  getByRoomCalls = [];
  activateCalls = [];
  endCalls = [];
  pendingEvents = [];
  endedRooms = new Set();
  viewerIdentities = new Map();
  drainViewerCalls = [];
  listViewerCalls = [];
  removeViewerCalls = [];
  enqueueViewerCalls = [];
  claimViewerCalls = [];
  completeViewerCalls = [];
  pendingViewerRevocations = new Map();
  beforeTerminate = null;

  async isKnownScreenShareRoom(roomName) {
    return (
      this.current?.livekitRoomName === roomName || this.endedRooms.has(roomName)
    );
  }

  async getByRoom(roomName) {
    this.getByRoomCalls.push(roomName);
    return this.current?.livekitRoomName === roomName ? this.current : null;
  }

  async getCurrent(requestedWorkspaceId) {
    return this.current?.workspaceId === requestedWorkspaceId
      ? this.current
      : null;
  }

  async activate(input) {
    this.activateCalls.push(input);
    if (
      this.current.workspaceId !== input.workspaceId ||
      this.current.sessionId !== input.sessionId ||
      this.current.livekitRoomName !== input.livekitRoomName
    ) {
      return null;
    }
    if (this.current.status === "active") {
      return { session: this.current, outboxId: null };
    }
    if (this.current.status !== "starting") return null;
    this.current = {
      ...this.current,
      status: "active",
      startedAt: input.startedAt
    };
    const outboxId = `outbox-${this.pendingEvents.length + 1}`;
    this.pendingEvents.push({
      id: outboxId,
      event: {
        version: 1,
        event: "workspace-screen-share:started",
        workspaceId: this.current.workspaceId,
        session: {
          id: this.current.sessionId,
          sharer: {
            userId: this.current.sharerUserId,
            displayName: this.current.sharerDisplayName,
            avatarUrl: this.current.sharerAvatarUrl
          },
          startedAt: this.current.startedAt
        }
      }
    });
    return { session: this.current, outboxId };
  }

  async terminateIfCurrent(input, cleanupMode = "revocation") {
    this.order.push("end");
    this.endCalls.push(input);
    this.beforeTerminate?.(input);
    if (
      this.current?.workspaceId !== input.workspaceId ||
      this.current.sessionId !== input.sessionId ||
      this.current.livekitRoomName !== input.livekitRoomName
    ) {
      return null;
    }
    const ended = this.current;
    this.current = null;
    this.endedRooms.add(ended.livekitRoomName);
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

  async drainViewerIdentities(input) {
    this.drainViewerCalls.push(input);
    const identities = [...(this.viewerIdentities.get(input.userId) ?? [])];
    this.viewerIdentities.delete(input.userId);
    return identities;
  }

  async listViewerIdentities(input) {
    this.listViewerCalls.push(input);
    return [...(this.viewerIdentities.get(input.userId) ?? [])];
  }

  async removeViewerIdentityIfCurrent(input) {
    this.removeViewerCalls.push(input);
    const identities = this.viewerIdentities.get(input.userId);
    identities?.delete(input.identity);
    if (identities?.size === 0) this.viewerIdentities.delete(input.userId);
    return true;
  }

  async enqueueViewerRevocation(input, dueAtMs) {
    this.order.push("enqueue-viewer-revocation");
    this.enqueueViewerCalls.push({ input, dueAtMs });
    if (
      this.current?.workspaceId !== input.workspaceId ||
      this.current.sessionId !== input.sessionId ||
      this.current.livekitRoomName !== input.livekitRoomName
    ) {
      return false;
    }
    const key = JSON.stringify(input);
    this.pendingViewerRevocations.set(key, { task: input, dueAtMs });
    return true;
  }

  async claimDueViewerRevocation(nowMs, leaseUntilMs) {
    this.claimViewerCalls.push({ nowMs, leaseUntilMs });
    const due = [...this.pendingViewerRevocations.values()]
      .filter(item => item.dueAtMs <= nowMs)
      .sort((left, right) => left.dueAtMs - right.dueAtMs)[0];
    if (!due) return null;
    due.dueAtMs = leaseUntilMs;
    return due.task;
  }

  async completeViewerRevocation(input, retryAtMs) {
    this.completeViewerCalls.push({ input, retryAtMs });
    const key = JSON.stringify(input);
    if ((this.viewerIdentities.get(input.userId)?.size ?? 0) === 0) {
      this.pendingViewerRevocations.delete(key);
      return true;
    }
    const pending = this.pendingViewerRevocations.get(key);
    if (pending) pending.dueAtMs = retryAtMs;
    return false;
  }
}

class FakeRealtimePublisher {
  constructor(state, order = []) {
    this.state = state;
    this.order = order;
  }

  attempts = [];
  events = [];
  failures = 0;
  beforePublish = null;

  async publish(event) {
    this.order.push("publish");
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
      this.order.push("publish");
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

const createWebhookHarness = current => {
  const order = [];
  const state = new FakeStateService(current, order);
  const publisher = new FakeRealtimePublisher(state, order);
  const handler = new ScreenShareWebhookService(state, publisher);
  return { handler, order, publisher, state };
};

{
  const harness = createWebhookHarness(startingSession());
  const event = webhookEvent("track_published");
  assert.equal(await harness.handler.canHandle(event), true);
  assert.equal((await harness.handler.handleVerifiedEvent(event)).status, "received");
  assert.deepEqual(harness.state.activateCalls, [
    {
      workspaceId,
      sessionId,
      livekitRoomName: `pilo-screen-share-${sessionId}`,
      startedAt: eventIso
    }
  ]);
  assert.deepEqual(harness.publisher.events, [
    {
      version: 1,
      event: "workspace-screen-share:started",
      workspaceId,
      session: {
        id: sessionId,
        sharer: { userId, displayName: "민준", avatarUrl: null },
        startedAt: eventIso
      }
    }
  ]);

  await harness.handler.handleVerifiedEvent(event);
  assert.equal(
    harness.publisher.events.length,
    1,
    "redelivered activation must not enqueue a duplicate started event"
  );
}

{
  const harness = createWebhookHarness(startingSession());
  const event = webhookEvent("track_published");
  harness.publisher.failures = 1;
  assert.equal(
    (await harness.handler.handleVerifiedEvent(event)).status,
    "received"
  );
  assert.equal(harness.state.current?.status, "active");
  assert.equal(harness.publisher.events.length, 0);
  assert.equal(harness.state.pendingEvents.length, 1);

  assert.equal(
    (await harness.handler.handleVerifiedEvent(event)).status,
    "received"
  );
  assert.equal(harness.publisher.attempts.length, 2);
  assert.equal(harness.publisher.events.length, 1);
}

for (const source of [TrackSource.MICROPHONE, TrackSource.CAMERA]) {
  const harness = createWebhookHarness(startingSession());
  const result = await harness.handler.handleVerifiedEvent(
    webhookEvent("track_published", { track: { source } })
  );
  assert.equal(result.status, "ignored");
  assert.equal(harness.state.activateCalls.length, 0);
  assert.equal(harness.publisher.events.length, 0);
}

for (const eventName of [
  "track_unpublished",
  "participant_left",
  "participant_connection_aborted",
  "room_finished"
]) {
  const harness = createWebhookHarness(activeSession());
  const event = webhookEvent(
    eventName,
    eventName === "track_unpublished"
      ? {}
      : eventName === "room_finished"
        ? { participant: undefined, track: undefined }
        : { track: undefined }
  );
  assert.equal((await harness.handler.handleVerifiedEvent(event)).status, "received");
  assert.equal(harness.state.current, null);
  assert.equal(harness.publisher.events.length, 1);
  assert.equal(harness.publisher.events[0].event, "workspace-screen-share:ended");
  assert.deepEqual(harness.order.slice(0, 2), ["end", "publish"]);

  await harness.handler.handleVerifiedEvent(event);
  assert.equal(harness.publisher.events.length, 1);
}

{
  const recovered = activeSession();
  const harness = createWebhookHarness(recovered);
  harness.state.isKnownScreenShareRoom = async roomName =>
    roomName === recovered.livekitRoomName;
  harness.state.getByRoom = async roomName =>
    roomName === recovered.livekitRoomName ? recovered : null;
  const event = webhookEvent("track_unpublished");
  assert.equal(
    await harness.handler.canHandle(event),
    true,
    "lifecycle-room ownership must route terminal webhooks without authority keys"
  );
  assert.equal((await harness.handler.handleVerifiedEvent(event)).status, "received");
  assert.equal(harness.state.current, null);
  assert.equal(harness.publisher.events.at(-1)?.event, "workspace-screen-share:ended");
}

{
  const harness = createWebhookHarness(activeSession());
  const event = webhookEvent("track_unpublished");
  harness.publisher.failures = 1;
  assert.equal(
    (await harness.handler.handleVerifiedEvent(event)).status,
    "received"
  );
  assert.equal(harness.state.current, null);
  assert.equal(harness.state.pendingEvents.length, 1);

  assert.equal(
    (await harness.handler.handleVerifiedEvent(event)).status,
    "ignored"
  );
  assert.equal(harness.state.current, null);
  assert.equal(harness.publisher.attempts.length, 2);
}

{
  const replacement = activeSession({
    sessionId: nextSessionId,
    sharerLiveKitIdentity: `screen-share:${nextSessionId}:${otherUserId}`,
    livekitRoomName: `pilo-screen-share-${nextSessionId}`,
    sharerUserId: otherUserId
  });
  const harness = createWebhookHarness(activeSession());
  harness.state.beforeTerminate = () => {
    harness.state.current = replacement;
  };
  await harness.handler.handleVerifiedEvent(webhookEvent("track_unpublished"));
  assert.deepEqual(harness.state.current, replacement);
  assert.deepEqual(harness.order, ["end"]);
  assert.equal(harness.publisher.events.length, 0);
}

{
  const harness = createWebhookHarness(activeSession());
  const result = await harness.handler.handleVerifiedEvent(
    webhookEvent("participant_left", {
      participant: { identity: `screen-share:${sessionId}:${otherUserId}` },
      track: undefined
    })
  );
  assert.equal(result.status, "ignored");
  assert.equal(harness.state.current?.sessionId, sessionId);
}

{
  const current = activeSession({
    sessionId: nextSessionId,
    sharerLiveKitIdentity: `screen-share:${nextSessionId}:${userId}`,
    livekitRoomName: `pilo-screen-share-${nextSessionId}`
  });
  const harness = createWebhookHarness(current);
  const oldRoomParticipantLeft = webhookEvent("participant_left", {
    track: undefined
  });
  assert.equal(await harness.handler.canHandle(oldRoomParticipantLeft), false);
  assert.equal(
    (await harness.handler.handleVerifiedEvent(oldRoomParticipantLeft)).status,
    "ignored"
  );
  assert.equal(harness.state.current?.sessionId, nextSessionId);
  assert.equal(harness.publisher.events.length, 0);
}

class FakeDatabase {
  transactionCalls = 0;

  async transaction() {
    this.transactionCalls += 1;
    throw new Error("screen-share webhook must not open a Meeting transaction");
  }
}

class FakeCleanupRedisClient {
  entries = [];
  locks = new Map();

  on() {
    return this;
  }

  async connect() {}

  destroy() {}

  async quit() {}

  async xRange() {
    return this.entries.map(entry => ({
      id: entry.id,
      message: { session: entry.session, mode: entry.mode }
    }));
  }

  async eval(script, options) {
    if (script.includes("CLAIM_WORKSPACE_SCREEN_SHARE_CLEANUP")) {
      const entry = this.entries.find(item => item.id === options.arguments[0]);
      if (!entry || this.locks.has(options.keys[1])) return null;
      this.locks.set(options.keys[1], options.arguments[1]);
      return [entry.session, entry.mode];
    }
    if (script.includes("RELEASE_WORKSPACE_SCREEN_SHARE_CLEANUP")) {
      if (this.locks.get(options.keys[0]) !== options.arguments[0]) return 0;
      this.locks.delete(options.keys[0]);
      return 1;
    }
    if (script.includes("ACK_WORKSPACE_SCREEN_SHARE_CLEANUP")) {
      if (this.locks.get(options.keys[1]) !== options.arguments[1]) return 0;
      const before = this.entries.length;
      this.entries = this.entries.filter(item => item.id !== options.arguments[0]);
      this.locks.delete(options.keys[1]);
      return before === this.entries.length ? 0 : 1;
    }
    throw new Error("Unexpected cleanup Redis script");
  }
}

class FakeCleanupRoomService {
  removeCalls = [];
  revocationCalls = [];
  deleteCalls = [];
  removeFailures = 0;
  revocationFailures = 0;

  async removeParticipant(session) {
    this.removeCalls.push(session);
    if (this.removeFailures > 0) {
      this.removeFailures -= 1;
      throw new Error("LiveKit unavailable");
    }
  }

  async removeParticipantForRevocation(session) {
    this.revocationCalls.push(session);
    if (this.revocationFailures > 0) {
      this.revocationFailures -= 1;
      throw new Error("LiveKit unavailable");
    }
  }

  async deleteRoom(session) {
    this.deleteCalls.push(session);
  }
}

class TestScreenShareCleanupService extends ScreenShareCleanupService {
  constructor(rooms, redis) {
    super(rooms);
    this.redis = redis;
  }

  createRedisClient(redisUrl) {
    assert.equal(redisUrl, "redis://screen-share-cleanup.test:6379");
    return this.redis;
  }
}

{
  const priorRedisUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://screen-share-cleanup.test:6379";
  try {
    const redis = new FakeCleanupRedisClient();
    const rooms = new FakeCleanupRoomService();
    const session = activeSession();
    redis.entries.push({
      id: "1-0",
      session: JSON.stringify(session),
      mode: "revocation"
    });
    rooms.revocationFailures = 1;
    const cleanup = new TestScreenShareCleanupService(rooms, redis);

    assert.equal(await cleanup.flushPendingCleanups(), 0);
    assert.equal(redis.entries.length, 1);
    assert.equal(await cleanup.flushPendingCleanups(), 1);
    assert.equal(redis.entries.length, 0);
    assert.equal(await cleanup.flushPendingCleanups(), 0);
    assert.deepEqual(rooms.revocationCalls, [session, session]);
    assert.deepEqual(rooms.removeCalls, []);
    assert.deepEqual(rooms.deleteCalls, [session]);
    await cleanup.onModuleDestroy();
  } finally {
    if (priorRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = priorRedisUrl;
  }
}

class FakeMeetingService {
  reconciliationCalls = [];
}

async function signWebhookBody(body, apiKey, apiSecret) {
  const token = new AccessToken(apiKey, apiSecret);
  token.sha256 = createHash("sha256").update(body).digest("base64");
  return token.toJwt();
}

const originalEnv = {
  APP_SERVER_RUNTIME: process.env.APP_SERVER_RUNTIME,
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
  LIVEKIT_URL: process.env.LIVEKIT_URL,
  REDIS_URL: process.env.REDIS_URL
};

try {
  process.env.LIVEKIT_API_KEY = "screen-share-webhook-key";
  process.env.LIVEKIT_API_SECRET = "screen-share-webhook-secret";
  process.env.LIVEKIT_URL = "wss://screen-share.test";

  const body = JSON.stringify({
    id: "screen-event-1",
    event: "track_published",
    room: { name: `pilo-screen-share-${sessionId}` },
    participant: { identity: `screen-share:${sessionId}:${userId}` },
    track: { source: "SCREEN_SHARE" },
    createdAt: String(eventSeconds)
  });
  const database = new FakeDatabase();
  const meetingService = new FakeMeetingService();
  const screenHandler = createWebhookHarness(startingSession()).handler;
  const service = new LiveKitWebhookService(
    database,
    meetingService,
    screenHandler
  );
  const result = await service.receiveWebhook(
    Buffer.from(body),
    await signWebhookBody(
      body,
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET
    )
  );
  assert.equal(result.status, "received");
  assert.equal(database.transactionCalls, 0);
  assert.equal(meetingService.reconciliationCalls.length, 0);

  const endedBody = JSON.stringify({
    id: "screen-event-ended",
    event: "track_unpublished",
    room: { name: `pilo-screen-share-${sessionId}` },
    participant: { identity: `screen-share:${sessionId}:${userId}` },
    track: { source: "SCREEN_SHARE" },
    createdAt: String(eventSeconds)
  });
  const endedDatabase = new FakeDatabase();
  const endedHarness = createWebhookHarness(activeSession());
  const endedService = new LiveKitWebhookService(
    endedDatabase,
    new FakeMeetingService(),
    endedHarness.handler
  );
  const endedAuthorization = await signWebhookBody(
    endedBody,
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET
  );
  assert.equal(
    (await endedService.receiveWebhook(Buffer.from(endedBody), endedAuthorization))
      .status,
    "received"
  );
  assert.equal(
    (await endedService.receiveWebhook(Buffer.from(endedBody), endedAuthorization))
      .status,
    "ignored"
  );
  assert.equal(
    endedDatabase.transactionCalls,
    0,
    "an ended-room tombstone must keep duplicate webhooks out of Meeting routing"
  );

  const invalidBody = JSON.stringify({
    id: "",
    event: "track_published",
    room: { name: `pilo-screen-share-${sessionId}` },
    participant: { identity: `screen-share:${sessionId}:${userId}` },
    track: { source: "SCREEN_SHARE" },
    createdAt: String(eventSeconds)
  });
  const invalidService = new LiveKitWebhookService(
    new FakeDatabase(),
    new FakeMeetingService(),
    createWebhookHarness(startingSession()).handler
  );
  await assert.rejects(
    async () =>
      invalidService.receiveWebhook(
        Buffer.from(invalidBody),
        await signWebhookBody(
          invalidBody,
          process.env.LIVEKIT_API_KEY,
          process.env.LIVEKIT_API_SECRET
        )
      ),
    error => error.getStatus() === 400
  );
} finally {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

class FakeScreenShareService {
  calls = [];

  async endForRevocation(requestedWorkspaceId, requestedUserId) {
    this.calls.push({
      workspaceId: requestedWorkspaceId,
      userId: requestedUserId
    });
    return true;
  }
}

class FakeRoomService {
  viewerCalls = [];
  identityRevocationCalls = [];
  failingIdentities = new Set();
  identityFailureCounts = new Map();

  async removeViewerParticipants(session, requestedUserId) {
    this.viewerCalls.push({ session, userId: requestedUserId });
  }

  async revokeParticipantIdentity(roomName, identity) {
    this.order?.push("revoke-viewer-identity");
    this.identityRevocationCalls.push({ roomName, identity });
    const failuresRemaining = this.identityFailureCounts.get(identity) ?? 0;
    if (failuresRemaining > 0) {
      this.identityFailureCounts.set(identity, failuresRemaining - 1);
      throw new Error("LiveKit revocation failed");
    }
    if (this.failingIdentities.has(identity)) {
      throw new Error("LiveKit revocation failed");
    }
  }
}

class TestRetryMembershipRevocationService extends ScreenShareMembershipRevocationService {
  retryDelays = [];
  currentTimeMs = 100;

  viewerRevocationRetryDelaysMs() {
    return this.retryDelays;
  }

  async waitBeforeViewerRevocationRetry() {}

  nowMs() {
    return this.currentTimeMs;
  }
}

const validRevocation = {
  version: 1,
  type: "membership.revoked",
  workspaceId,
  userId,
  occurredAt: "2026-07-18T00:00:00.000Z"
};

{
  const state = new FakeStateService(activeSession());
  const shares = new FakeScreenShareService();
  const rooms = new FakeRoomService();
  rooms.order = state.order;
  const service = new TestRetryMembershipRevocationService(
    state,
    shares,
    rooms
  );
  service.logger = { error() {}, warn() {} };
  assert.equal(await service.handleMembershipRevocation(validRevocation), true);
  assert.deepEqual(shares.calls, [{ workspaceId, userId }]);
  assert.equal(rooms.viewerCalls.length, 0);
}

{
  const session = activeSession();
  const retryIdentity =
    `screen-share-viewer:${sessionId}:${otherUserId}:automatic-retry`;
  const state = new FakeStateService(session);
  state.viewerIdentities.set(otherUserId, new Set([retryIdentity]));
  const shares = new FakeScreenShareService();
  const rooms = new FakeRoomService();
  rooms.identityFailureCounts.set(retryIdentity, 1);
  const service = new TestRetryMembershipRevocationService(
    state,
    shares,
    rooms
  );
  service.retryDelays = [1];
  service.logger = { error() {}, warn() {} };

  assert.equal(
    await service.handleMembershipRevocation({
      ...validRevocation,
      userId: otherUserId
    }),
    true
  );
  assert.equal(state.viewerIdentities.has(otherUserId), false);
  assert.deepEqual(
    rooms.identityRevocationCalls.map(call => call.identity),
    [retryIdentity, retryIdentity],
    "a transient subscriber failure must retry automatically before ack"
  );
}

{
  const session = activeSession();
  const state = new FakeStateService(session);
  const issuedIdentity =
    `screen-share-viewer:${sessionId}:${otherUserId}:issued-not-joined`;
  state.viewerIdentities.set(otherUserId, new Set([issuedIdentity]));
  const shares = new FakeScreenShareService();
  const rooms = new FakeRoomService();
  rooms.order = state.order;
  const service = new ScreenShareMembershipRevocationService(
    state,
    shares,
    rooms
  );
  service.logger = { error() {}, warn() {} };
  assert.equal(
    await service.handleMembershipRevocation({
      ...validRevocation,
      userId: otherUserId
    }),
    true
  );
  assert.equal(shares.calls.length, 0);
  assert.deepEqual(state.listViewerCalls, [
    {
      workspaceId,
      sessionId,
      livekitRoomName: session.livekitRoomName,
      userId: otherUserId
    }
  ]);
  assert.ok(
    state.order.indexOf("enqueue-viewer-revocation") <
      state.order.indexOf("revoke-viewer-identity"),
    "the durable retry task must be enqueued before LiveKit revocation"
  );
  assert.deepEqual(rooms.identityRevocationCalls, [
    {
      roomName: session.livekitRoomName,
      identity: issuedIdentity
    }
  ]);
  assert.deepEqual(state.removeViewerCalls, [
    {
      workspaceId,
      sessionId,
      livekitRoomName: session.livekitRoomName,
      userId: otherUserId,
      identity: issuedIdentity
    }
  ]);
  assert.equal(
    await service.handleMembershipRevocation({
      ...validRevocation,
      userId: "not-a-uuid"
    }),
    false
  );
}

{
  const session = activeSession();
  const firstIdentity =
    `screen-share-viewer:${sessionId}:${otherUserId}:first`;
  const retryIdentity =
    `screen-share-viewer:${sessionId}:${otherUserId}:retry`;
  const state = new FakeStateService(session);
  state.viewerIdentities.set(
    otherUserId,
    new Set([firstIdentity, retryIdentity])
  );
  const shares = new FakeScreenShareService();
  const rooms = new FakeRoomService();
  rooms.failingIdentities.add(retryIdentity);
  const service = new TestRetryMembershipRevocationService(
    state,
    shares,
    rooms
  );
  service.logger = { error() {}, warn() {} };

  assert.equal(
    await service.handleMembershipRevocation({
      ...validRevocation,
      userId: otherUserId
    }),
    false
  );
  assert.deepEqual(
    [...(state.viewerIdentities.get(otherUserId) ?? [])],
    [retryIdentity],
    "a failed explicit revocation must remain registered for redelivery"
  );
  assert.deepEqual(
    state.removeViewerCalls.map(call => call.identity),
    [firstIdentity]
  );

  rooms.failingIdentities.clear();
  const restartedService = new TestRetryMembershipRevocationService(
    state,
    shares,
    rooms
  );
  restartedService.currentTimeMs = 1_100;
  restartedService.logger = { error() {}, warn() {} };
  assert.equal(
    await restartedService.processViewerRevocationTasks(),
    1
  );
  assert.equal(state.viewerIdentities.has(otherUserId), false);
  assert.equal(state.pendingViewerRevocations.size, 0);
  assert.deepEqual(
    rooms.identityRevocationCalls.map(call => call.identity),
    [firstIdentity, retryIdentity, retryIdentity],
    "redelivery must retry only the identity that was not acknowledged"
  );
}

{
  process.env.REDIS_URL = "redis://screen-share-membership.test:6379";
  delete process.env.APP_SERVER_RUNTIME;
  const subscriptions = [];
  const client = {
    connectCalls: 0,
    quitCalls: 0,
    destroyCalls: 0,
    on() {
      return client;
    },
    async connect() {
      client.connectCalls += 1;
    },
    async subscribe(channel, handler) {
      subscriptions.push({ channel, handler });
    },
    async quit() {
      client.quitCalls += 1;
    },
    destroy() {
      client.destroyCalls += 1;
    }
  };
  class TestMembershipRevocationService extends ScreenShareMembershipRevocationService {
    createRedisClient(redisUrl) {
      assert.equal(redisUrl, process.env.REDIS_URL);
      return client;
    }
  }
  const service = new TestMembershipRevocationService(
    new FakeStateService(null),
    new FakeScreenShareService(),
    new FakeRoomService()
  );
  service.logger = { error() {}, warn() {} };
  await service.onModuleInit();
  assert.equal(client.connectCalls, 1);
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].channel, "workspace:membership-revocations");
  await service.onModuleDestroy();
  assert.equal(client.quitCalls, 1);
}

class FakeLiveKitRoomClient {
  participants = [];
  removeCalls = [];
  absentIdentities = new Set();

  async listParticipants() {
    return this.participants;
  }

  async removeParticipant(roomName, identity, options) {
    this.removeCalls.push({ roomName, identity, options });
    if (this.absentIdentities.has(identity)) throw { code: "not_found" };
  }

  async deleteRoom() {}
}

class TestScreenShareRoomService extends ScreenShareRoomService {
  constructor(client) {
    super();
    this.testClient = client;
  }

  createRoomServiceClient() {
    return this.testClient;
  }

  now() {
    return new Date("2026-07-18T00:00:00.000Z");
  }
}

try {
  process.env.LIVEKIT_API_KEY = "screen-share-room-key";
  process.env.LIVEKIT_API_SECRET = "screen-share-room-secret";
  process.env.LIVEKIT_URL = "wss://screen-share.test";
  const session = activeSession();
  const prefix = `screen-share-viewer:${sessionId}:${userId}:`;
  const client = new FakeLiveKitRoomClient();
  client.participants = [
    { identity: `${prefix}tab-one` },
    { identity: `${prefix}tab-two` },
    { identity: `screen-share-viewer:${sessionId}:${otherUserId}:tab-three` },
    { identity: `screen-share-viewer:${sessionId}:${userId}-suffix:tab-four` },
    { identity: session.sharerLiveKitIdentity }
  ];
  client.absentIdentities.add(`${prefix}tab-two`);
  const rooms = new TestScreenShareRoomService(client);
  await rooms.removeViewerParticipants(session, userId);
  assert.deepEqual(client.removeCalls, [
    {
      roomName: session.livekitRoomName,
      identity: `${prefix}tab-one`,
      options: { revokeTokenTs: 1784332801n }
    },
    {
      roomName: session.livekitRoomName,
      identity: `${prefix}tab-two`,
      options: { revokeTokenTs: 1784332801n }
    }
  ]);

  client.absentIdentities.add(session.sharerLiveKitIdentity);
  await rooms.removeParticipantForRevocation(session);
  assert.deepEqual(client.removeCalls.at(-1), {
    roomName: session.livekitRoomName,
    identity: session.sharerLiveKitIdentity,
    options: { revokeTokenTs: 1784332801n }
  });

  const absentViewerIdentity = `${prefix}issued-but-not-joined`;
  client.absentIdentities.add(absentViewerIdentity);
  await rooms.revokeParticipantIdentity(
    session.livekitRoomName,
    absentViewerIdentity
  );
  assert.deepEqual(client.removeCalls.at(-1), {
    roomName: session.livekitRoomName,
    identity: absentViewerIdentity,
    options: { revokeTokenTs: 1784332801n }
  });
} finally {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const screenShareProviders = Reflect.getMetadata("providers", ScreenShareModule);
{
  const session = activeSession();
  const state = new FakeStateService(session);
  state.deadline = session;
  state.leaseUntilMs = 0;
  state.claimDueDeadline = async (nowMs, leaseUntilMs) => {
    if (!state.deadline || state.leaseUntilMs > nowMs) return null;
    state.leaseUntilMs = leaseUntilMs;
    return state.deadline;
  };
  const originalTerminate = state.terminateIfCurrent.bind(state);
  state.terminateIfCurrent = async (...args) => {
    const transition = await originalTerminate(...args);
    if (transition) state.deadline = null;
    return transition;
  };
  const realtime = { events: [], async flushPendingEvents() { this.events.push("flushed"); } };
  const cleanup = { entries: [], async flushPendingCleanups() { this.entries.push("flushed"); } };
  class TestScreenShareDeadlineService extends ScreenShareDeadlineService {
    currentTimeMs = Date.parse(eventIso) + 12 * 60 * 60 * 1000;
    nowMs() { return this.currentTimeMs; }
  }
  const deadline = new TestScreenShareDeadlineService(state, realtime, cleanup);
  assert.equal(await deadline.flushDueDeadlines(), 1);
  assert.equal(state.current, null);
  assert.deepEqual(realtime.events, ["flushed"]);
  assert.deepEqual(cleanup.entries, ["flushed"]);
}
{
  const session = activeSession();
  const state = new FakeStateService(session);
  let leaseUntilMs = 0;
  let terminateFailures = 1;
  state.claimDueDeadline = async (nowMs, nextLeaseUntilMs) => {
    if (!state.current || leaseUntilMs > nowMs) return null;
    leaseUntilMs = nextLeaseUntilMs;
    return session;
  };
  const originalTerminate = state.terminateIfCurrent.bind(state);
  state.terminateIfCurrent = async (...args) => {
    if (terminateFailures > 0) {
      terminateFailures -= 1;
      throw new Error("transient deadline failure");
    }
    return originalTerminate(...args);
  };
  const realtime = { async flushPendingEvents() {} };
  const cleanup = { async flushPendingCleanups() {} };
  class RetryingDeadlineService extends ScreenShareDeadlineService {
    currentTimeMs = Date.parse(eventIso) + 12 * 60 * 60 * 1000;
    nowMs() { return this.currentTimeMs; }
  }
  const deadline = new RetryingDeadlineService(state, realtime, cleanup);
  await assert.rejects(deadline.flushDueDeadlines());
  deadline.currentTimeMs += 30 * 1000 + 1;
  assert.equal(await deadline.flushDueDeadlines(), 1);
  assert.equal(state.current, null, "an expired lease must make a failed task retryable");
}
{
  const session = activeSession();
  const state = new FakeStateService(session);
  let claimed = false;
  state.claimDueDeadline = async () => {
    if (claimed) return null;
    claimed = true;
    return session;
  };
  state.beforeTerminate = () => { state.current = null; };
  const realtime = { calls: 0, async flushPendingEvents() { this.calls += 1; } };
  const cleanup = { calls: 0, async flushPendingCleanups() { this.calls += 1; } };
  const deadline = new ScreenShareDeadlineService(state, realtime, cleanup);
  assert.equal(await deadline.flushDueDeadlines(), 1);
  assert.equal(realtime.calls, 0, "an explicit end winning the race must not emit a second event");
  assert.equal(cleanup.calls, 0, "an explicit end winning the race must not add cleanup work");
}
{
  const priorRedisUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://screen-share-deadline.test:6379";
  try {
    const state = new FakeStateService(null);
    state.claimDueDeadline = async () => null;
    const deadline = new ScreenShareDeadlineService(
      state,
      { async flushPendingEvents() {} },
      { async flushPendingCleanups() {} }
    );
    deadline.onModuleInit();
    assert.ok(deadline.deadlineInterval, "startup must schedule deadline sweeps");
    await deadline.onModuleDestroy();
    assert.equal(deadline.deadlineInterval, null, "worker teardown must clear its interval");
  } finally {
    if (priorRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = priorRedisUrl;
  }
}
assert.ok(screenShareProviders.includes(ScreenShareWebhookService));
assert.ok(screenShareProviders.includes(ScreenShareDeadlineService));
assert.ok(screenShareProviders.includes(ScreenShareMembershipRevocationService));
assert.ok(screenShareProviders.includes(ScreenShareCleanupService));
assert.ok(
  Reflect.getMetadata("exports", ScreenShareModule).includes(
    ScreenShareWebhookService
  )
);
assert.ok(
  Reflect.getMetadata("imports", MeetingModule).includes(ScreenShareModule)
);

console.log("screen-share webhook and membership revocation tests passed");
