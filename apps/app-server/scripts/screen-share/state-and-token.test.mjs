import assert from "node:assert/strict";
import { badRequest } from "../../dist/common/api-error.js";
import { ScreenShareStateService } from "../../dist/modules/screen-share/screen-share-state.service.js";
import { ScreenShareTokenService } from "../../dist/modules/screen-share/screen-share-token.service.js";
import {
  screenShareAlreadyActive,
  screenShareNotFound
} from "../../dist/modules/screen-share/screen-share.errors.js";

const decodeJwtPayload = token => {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
};

class FakeRedisClient {
  values = new Map();
  sets = new Map();
  sortedSets = new Map();
  deadlines = new Map();
  expiries = new Map();
  streamEntries = [];
  cleanupEntries = [];
  nextStreamId = 1;
  nowSeconds = 0;

  constructor({ failConnect = false, failEval = false, failGet = false } = {}) {
    this.failConnect = failConnect;
    this.failEval = failEval;
    this.failGet = failGet;
  }

  on() {
    return this;
  }

  async connect() {
    if (this.failConnect) throw new Error("Redis connect failed");
  }

  destroy() {}

  advance(seconds) {
    this.nowSeconds += seconds;
    for (const key of this.values.keys()) this.expireIfNeeded(key);
  }

  replaceRoomOwner(roomName, workspaceId) {
    const key = `workspace-screen-share:room:v1:${roomName}`;
    this.values.set(key, workspaceId);
  }

  expireIfNeeded(key) {
    const expiry = this.expiries.get(key);
    if (expiry !== undefined && expiry <= this.nowSeconds) {
      this.values.delete(key);
      this.expiries.delete(key);
    }
  }

  has(key) {
    this.expireIfNeeded(key);
    return this.values.has(key);
  }

  async get(key) {
    if (this.failGet) throw new Error("Redis get failed");
    this.expireIfNeeded(key);
    return this.values.get(key) ?? null;
  }

  async eval(script, options) {
    if (this.failEval) throw new Error("Redis eval failed");
    if (script.includes("RESERVE_WORKSPACE_SCREEN_SHARE")) {
      const [workspaceKey, roomKey, rollbackKey, lifecycleKey, lifecycleWorkspaceKey, lifecycleRoomKey] = options.keys;
      if (this.has(workspaceKey) || this.has(roomKey) || this.has(lifecycleWorkspaceKey)) return 0;
      const ttl = Number(options.arguments[1]);
      this.values.set(workspaceKey, options.arguments[0]);
      this.values.set(roomKey, options.arguments[2]);
      this.values.set(rollbackKey, options.arguments[3]);
      this.values.set(lifecycleKey, options.arguments[0]);
      this.values.set(lifecycleWorkspaceKey, options.arguments[4]);
      this.values.set(lifecycleRoomKey, options.arguments[4]);
      this.expiries.set(workspaceKey, this.nowSeconds + ttl);
      this.expiries.set(roomKey, this.nowSeconds + ttl);
      this.expiries.set(rollbackKey, this.nowSeconds + ttl);
      this.expiries.set(lifecycleKey, this.nowSeconds + ttl);
      this.expiries.set(lifecycleWorkspaceKey, this.nowSeconds + ttl);
      this.expiries.set(lifecycleRoomKey, this.nowSeconds + ttl);
      return 1;
    }

    if (script.includes("ACTIVATE_WORKSPACE_SCREEN_SHARE")) {
      const [workspaceKey, roomKey, rollbackKey, , lifecycleKey, lifecycleWorkspaceKey, lifecycleRoomKey] = options.keys;
      const value = await this.get(workspaceKey);
      if (!value) return null;
      const session = JSON.parse(value);
      if (
        session.sessionId !== options.arguments[0] ||
        session.livekitRoomName !== options.arguments[1]
      ) {
        return null;
      }
      if (this.values.get(roomKey) !== session.workspaceId) return null;
      if (session.status === "active") {
        this.values.delete(rollbackKey);
        this.expiries.delete(rollbackKey);
        return [value, "", ""];
      }
      if (session.status !== "starting") return null;
      const active = {
        ...session,
        status: "active",
        startedAt: options.arguments[2]
      };
      const encoded = JSON.stringify(active);
      this.values.set(workspaceKey, encoded);
      this.values.set(lifecycleKey, encoded);
      this.expiries.delete(workspaceKey);
      this.expiries.delete(roomKey);
      this.expiries.delete(lifecycleKey);
      this.expiries.delete(lifecycleWorkspaceKey);
      this.expiries.delete(lifecycleRoomKey);
      this.deadlines.set(session.sessionId, Number(options.arguments[3]));
      this.values.delete(rollbackKey);
      this.expiries.delete(rollbackKey);
      const outboxId = `${this.nextStreamId++}-0`;
      this.streamEntries.push({
        id: outboxId,
        event: JSON.stringify({
          version: 1,
          event: "workspace-screen-share:started",
          workspaceId: session.workspaceId,
          session: {
            id: session.sessionId,
            sharer: {
              userId: session.sharerUserId,
              displayName: session.sharerDisplayName,
              avatarUrl: session.sharerAvatarUrl
            },
            startedAt: active.startedAt
          }
        })
      });
      return [encoded, outboxId, ""];
    }

    if (script.includes("REGISTER_WORKSPACE_SCREEN_SHARE_VIEWER_IDENTITY")) {
      const [workspaceKey, roomKey, viewerKey, viewerIndexKey] = options.keys;
      const value = await this.get(workspaceKey);
      if (!value) return 0;
      const session = JSON.parse(value);
      if (
        session.sessionId !== options.arguments[0] ||
        session.livekitRoomName !== options.arguments[1] ||
        session.status !== "active" ||
        this.values.get(roomKey) !== session.workspaceId
      ) {
        return 0;
      }
      const identities = this.sets.get(viewerKey) ?? new Set();
      identities.add(options.arguments[2]);
      this.sets.set(viewerKey, identities);
      const viewerKeys = this.sets.get(viewerIndexKey) ?? new Set();
      viewerKeys.add(viewerKey);
      this.sets.set(viewerIndexKey, viewerKeys);
      return 1;
    }

    if (script.includes("ENQUEUE_WORKSPACE_SCREEN_SHARE_VIEWER_REVOCATION")) {
      const [workspaceKey, pendingKey] = options.keys;
      const value = await this.get(workspaceKey);
      if (!value) return 0;
      const session = JSON.parse(value);
      if (
        session.sessionId !== options.arguments[0] ||
        session.livekitRoomName !== options.arguments[1]
      ) {
        return 0;
      }
      const pending = this.sortedSets.get(pendingKey) ?? new Map();
      if (pending.has(options.arguments[2])) return 0;
      pending.set(options.arguments[2], Number(options.arguments[3]));
      this.sortedSets.set(pendingKey, pending);
      return 1;
    }

    if (script.includes("CLAIM_WORKSPACE_SCREEN_SHARE_VIEWER_REVOCATION")) {
      const [pendingKey] = options.keys;
      const now = Number(options.arguments[0]);
      const pending = this.sortedSets.get(pendingKey) ?? new Map();
      const due = [...pending.entries()]
        .filter(([, score]) => score <= now)
        .sort((left, right) => left[1] - right[1]);
      if (due.length === 0) return null;
      pending.set(due[0][0], Number(options.arguments[1]));
      return due[0][0];
    }

    if (script.includes("COMPLETE_WORKSPACE_SCREEN_SHARE_VIEWER_REVOCATION")) {
      const [pendingKey, viewerKey] = options.keys;
      const pending = this.sortedSets.get(pendingKey) ?? new Map();
      if ((this.sets.get(viewerKey)?.size ?? 0) === 0) {
        pending.delete(options.arguments[0]);
        return 1;
      }
      pending.set(options.arguments[0], Number(options.arguments[1]));
      return 0;
    }

    if (script.includes("REMOVE_WORKSPACE_SCREEN_SHARE_VIEWER_IDENTITY")) {
      const [workspaceKey, viewerKey, viewerIndexKey] = options.keys;
      const value = await this.get(workspaceKey);
      if (!value) return 0;
      const session = JSON.parse(value);
      if (
        session.sessionId !== options.arguments[0] ||
        session.livekitRoomName !== options.arguments[1]
      ) {
        return 0;
      }
      const identities = this.sets.get(viewerKey) ?? new Set();
      identities.delete(options.arguments[2]);
      if (identities.size === 0) {
        this.sets.delete(viewerKey);
        this.sets.get(viewerIndexKey)?.delete(viewerKey);
      }
      return 1;
    }

    if (script.includes("LIST_WORKSPACE_SCREEN_SHARE_VIEWER_IDENTITIES")) {
      const [workspaceKey, viewerKey] = options.keys;
      const value = await this.get(workspaceKey);
      if (!value) return null;
      const session = JSON.parse(value);
      if (
        session.sessionId !== options.arguments[0] ||
        session.livekitRoomName !== options.arguments[1]
      ) {
        return null;
      }
      return [...(this.sets.get(viewerKey) ?? [])];
    }

    if (script.includes("DRAIN_WORKSPACE_SCREEN_SHARE_VIEWER_IDENTITIES")) {
      const [workspaceKey, viewerKey, viewerIndexKey] = options.keys;
      const value = await this.get(workspaceKey);
      if (!value) return null;
      const session = JSON.parse(value);
      if (
        session.sessionId !== options.arguments[0] ||
        session.livekitRoomName !== options.arguments[1]
      ) {
        return null;
      }
      const identities = [...(this.sets.get(viewerKey) ?? [])];
      this.sets.delete(viewerKey);
      this.sets.get(viewerIndexKey)?.delete(viewerKey);
      return identities;
    }

    if (script.includes("CLAIM_STARTING_WORKSPACE_SCREEN_SHARE")) {
      const [workspaceKey, roomKey, rollbackKey] = options.keys;
      const value = await this.get(workspaceKey);
      if (!value) return 0;
      const session = JSON.parse(value);
      if (
        session.sessionId !== options.arguments[0] ||
        session.livekitRoomName !== options.arguments[1] ||
        session.status !== "starting" ||
        this.values.get(roomKey) !== session.workspaceId
      ) {
        return 0;
      }
      this.values.set(rollbackKey, options.arguments[2]);
      this.expiries.set(rollbackKey, this.expiries.get(workspaceKey));
      session.createdAt = options.arguments[3];
      const updated = JSON.stringify(session);
      this.values.set(workspaceKey, updated);
      return updated;
    }

    if (script.includes("REPLACE_EXPIRED_STARTING_WORKSPACE_SCREEN_SHARE")) {
      const [
        workspaceKey,
        roomKey,
        rollbackKey,
        candidateRoomKey,
        candidateRollbackKey,
        tombstoneKey,
        lifecycleKey,
        lifecycleWorkspaceKey,
        lifecycleRoomKey,
        candidateLifecycleKey,
        candidateLifecycleWorkspaceKey,
        candidateLifecycleRoomKey
      ] = options.keys;
      const value = await this.get(workspaceKey);
      if (!value) return 0;
      const session = JSON.parse(value);
      const candidate = JSON.parse(options.arguments[4]);
      if (
        session.sessionId !== options.arguments[0] ||
        session.livekitRoomName !== options.arguments[1] ||
        session.status !== "starting" ||
        session.createdAt !== options.arguments[2] ||
        session.createdAt > options.arguments[3] ||
        this.values.get(roomKey) !== session.workspaceId ||
        this.has(candidateRoomKey) ||
        candidate.workspaceId !== session.workspaceId ||
        candidate.status !== "starting"
      ) {
        return 0;
      }
      const ttl = Number(options.arguments[5]);
      this.values.delete(roomKey);
      this.values.delete(rollbackKey);
      this.values.delete(lifecycleKey);
      this.values.delete(lifecycleWorkspaceKey);
      this.values.delete(lifecycleRoomKey);
      this.expiries.delete(roomKey);
      this.expiries.delete(rollbackKey);
      this.expiries.delete(lifecycleKey);
      this.expiries.delete(lifecycleWorkspaceKey);
      this.expiries.delete(lifecycleRoomKey);
      this.values.set(workspaceKey, options.arguments[4]);
      this.values.set(candidateRoomKey, candidate.workspaceId);
      this.values.set(candidateRollbackKey, options.arguments[6]);
      this.values.set(tombstoneKey, session.sessionId);
      this.values.set(candidateLifecycleKey, options.arguments[4]);
      this.values.set(candidateLifecycleWorkspaceKey, candidate.sessionId);
      this.values.set(candidateLifecycleRoomKey, candidate.sessionId);
      this.cleanupEntries.push({
        session: value,
        mode: "revocation"
      });
      this.expiries.set(workspaceKey, this.nowSeconds + ttl);
      this.expiries.set(candidateRoomKey, this.nowSeconds + ttl);
      this.expiries.set(candidateRollbackKey, this.nowSeconds + ttl);
      this.expiries.set(candidateLifecycleKey, this.nowSeconds + ttl);
      this.expiries.set(candidateLifecycleWorkspaceKey, this.nowSeconds + ttl);
      this.expiries.set(candidateLifecycleRoomKey, this.nowSeconds + ttl);
      this.expiries.set(
        tombstoneKey,
        this.nowSeconds + Number(options.arguments[7])
      );
      return 1;
    }

    if (
      script.includes("END_WORKSPACE_SCREEN_SHARE") ||
      script.includes("RELEASE_STARTING_WORKSPACE_SCREEN_SHARE")
    ) {
      const [workspaceKey, roomKey, rollbackKey] = options.keys;
      const lifecycleKey = script.includes("END_WORKSPACE_SCREEN_SHARE")
        ? options.keys[7]
        : options.keys[3];
      const lifecycleWorkspaceKey = script.includes("END_WORKSPACE_SCREEN_SHARE")
        ? options.keys[8]
        : options.keys[4];
      const lifecycleRoomKey = script.includes("END_WORKSPACE_SCREEN_SHARE")
        ? options.keys[9]
        : options.keys[5];
      const authority = this.values.get(workspaceKey);
      const value = authority ?? this.values.get(lifecycleKey);
      if (!value) return null;
      const session = JSON.parse(value);
      if (
        session.sessionId !== options.arguments[0] ||
        session.livekitRoomName !== options.arguments[1] ||
        (script.includes("RELEASE_STARTING_WORKSPACE_SCREEN_SHARE") &&
          (session.status !== "starting" ||
            this.values.get(rollbackKey) !== options.arguments[2])) ||
        (authority && this.values.get(roomKey) !== session.workspaceId) ||
        (script.includes("END_WORKSPACE_SCREEN_SHARE") &&
          (this.values.get(lifecycleWorkspaceKey) !== session.sessionId ||
            this.values.get(lifecycleRoomKey) !== session.sessionId))
      ) {
        return null;
      }
      this.values.delete(workspaceKey);
      this.values.delete(roomKey);
      this.values.delete(rollbackKey);
      this.values.delete(lifecycleKey);
      this.values.delete(lifecycleWorkspaceKey);
      this.values.delete(lifecycleRoomKey);
      this.expiries.delete(workspaceKey);
      this.expiries.delete(roomKey);
      this.expiries.delete(rollbackKey);
      this.expiries.delete(lifecycleKey);
      this.expiries.delete(lifecycleWorkspaceKey);
      this.expiries.delete(lifecycleRoomKey);
      if (script.includes("END_WORKSPACE_SCREEN_SHARE")) {
        const outboxId = `${this.nextStreamId++}-0`;
        this.streamEntries.push({
          id: outboxId,
          event: JSON.stringify({
            version: 1,
            event: "workspace-screen-share:ended",
            workspaceId: session.workspaceId,
            sessionId: session.sessionId
          })
        });
        const tombstoneKey = options.keys[4];
        const tombstoneTtl = Number(options.arguments[2]);
        this.values.set(tombstoneKey, session.sessionId);
        this.expiries.set(tombstoneKey, this.nowSeconds + tombstoneTtl);
        const cleanupId = `cleanup-${this.cleanupEntries.length + 1}`;
        this.cleanupEntries.push({
          id: cleanupId,
          session: value,
          mode: options.arguments[3]
        });
        const viewerIndexKey = options.keys[6];
        this.deadlines.delete(session.sessionId);
        for (const viewerKey of this.sets.get(viewerIndexKey) ?? []) {
          this.sets.delete(viewerKey);
        }
        this.sets.delete(viewerIndexKey);
        return [value, outboxId, cleanupId];
      }
      return value;
    }

    throw new Error("Unexpected Redis script");
  }
}

class TestScreenShareStateService extends ScreenShareStateService {
  constructor(client) {
    super();
    this.fakeClient = client;
  }

  createRedisClient(redisUrl) {
    assert.equal(redisUrl, "redis://screen-share.test:6379");
    return this.fakeClient;
  }
}

const originalEnv = {
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
  LIVEKIT_URL: process.env.LIVEKIT_URL,
  REDIS_URL: process.env.REDIS_URL
};

process.env.LIVEKIT_API_KEY = "screen-share-api-key";
process.env.LIVEKIT_API_SECRET = "screen-share-api-secret-value";
process.env.LIVEKIT_URL = "wss://screen-share.test";
process.env.REDIS_URL = "redis://screen-share.test:6379";

try {
  const redis = new FakeRedisClient();
  const state = new TestScreenShareStateService(redis);
  const tokens = new ScreenShareTokenService();
  const session = {
    sessionId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    sharerUserId: "33333333-3333-4333-8333-333333333333",
    sharerDisplayName: "민준",
    sharerAvatarUrl: null,
    sharerLiveKitIdentity:
      "screen-share:11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333",
    livekitRoomName:
      "pilo-screen-share-11111111-1111-4111-8111-111111111111",
    status: "starting",
    createdAt: "2026-07-18T00:00:00.000Z",
    startedAt: null
  };

  assert.equal(await state.reserve(session, "attempt-1"), true);
  const recoveredSession = { ...session, createdAt: "2026-07-18T00:00:00.500Z" };
  assert.deepEqual(
    await state.reserve(
      {
        ...session,
        sessionId: "44444444-4444-4444-8444-444444444444"
      },
      "attempt-2"
    ),
    false
  );
  assert.deepEqual(await state.getCurrent(session.workspaceId), session);
  assert.deepEqual(await state.getByRoom(session.livekitRoomName), session);
  assert.equal(
    typeof state.claimStartingReservation,
    "function",
    "same-owner recovery must claim rollback ownership"
  );
  assert.deepEqual(
    await state.claimStartingReservation({
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      livekitRoomName: session.livekitRoomName,
      rollbackAttemptId: "attempt-recovery",
      claimedAt: "2026-07-18T00:00:00.500Z"
    }),
    recoveredSession
  );
  assert.equal(
    await state.releaseStartingIfCurrent({
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      livekitRoomName: session.livekitRoomName,
      rollbackAttemptId: "attempt-1"
    }),
    null
  );
  assert.deepEqual(await state.getCurrent(session.workspaceId), recoveredSession);

  const replacement = {
    ...session,
    sessionId: "99999999-9999-4999-8999-999999999999",
    sharerLiveKitIdentity:
      "screen-share:99999999-9999-4999-8999-999999999999:33333333-3333-4333-8333-333333333333",
    livekitRoomName:
      "pilo-screen-share-99999999-9999-4999-8999-999999999999"
  };
  redis.values.set(
    `workspace-screen-share:workspace:v1:${session.workspaceId}`,
    JSON.stringify(replacement)
  );
  assert.equal(await state.getByRoom(session.livekitRoomName), null);
  redis.values.set(
    `workspace-screen-share:workspace:v1:${session.workspaceId}`,
    JSON.stringify(session)
  );
  redis.values.set(
    `workspace-screen-share:workspace:v1:${session.workspaceId}`,
    JSON.stringify({
      ...session,
      workspaceId: "88888888-8888-4888-8888-888888888888"
    })
  );
  assert.equal(await state.getByRoom(session.livekitRoomName), null);
  redis.values.set(
    `workspace-screen-share:workspace:v1:${session.workspaceId}`,
    JSON.stringify(session)
  );

  redis.advance(12 * 60 * 60 - 1);
  const activated = await state.activate({
    workspaceId: session.workspaceId,
    sessionId: session.sessionId,
    livekitRoomName: session.livekitRoomName,
    startedAt: "2026-07-18T00:00:01.000Z"
  });
  assert.equal(activated?.session.status, "active");
  assert.equal(activated?.session.startedAt, "2026-07-18T00:00:01.000Z");
  assert.equal(typeof activated?.outboxId, "string");
  assert.equal(activated?.cleanupId, null);
  const redeliveredActivation = await state.activate({
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      livekitRoomName: session.livekitRoomName,
      startedAt: "2026-07-18T00:00:02.000Z"
    });
  assert.deepEqual(redeliveredActivation?.session, activated?.session);
  assert.equal(
    redeliveredActivation?.outboxId,
    null,
    "redelivered track_published must not enqueue a duplicate event"
  );
  assert.equal(
    (await state.getCurrent(session.workspaceId))?.startedAt,
    "2026-07-18T00:00:01.000Z"
  );
  const expectedDeadlineMs = Date.parse(activated.session.startedAt) + 12 * 60 * 60 * 1000;
  assert.deepEqual(await state.getCurrent(session.workspaceId), activated.session);
  assert.equal(redis.deadlines.get(session.sessionId), expectedDeadlineMs);
  assert.equal(
    redis.expiries.has(`workspace-screen-share:workspace:v1:${session.workspaceId}`),
    false,
    "active authority must not silently expire before its durable deadline"
  );
  redis.values.delete(`workspace-screen-share:workspace:v1:${session.workspaceId}`);
  redis.values.delete(`workspace-screen-share:room:v1:${session.livekitRoomName}`);
  assert.deepEqual(
    await state.getCurrent(session.workspaceId),
    activated.session,
    "lifecycle snapshot must recover an active session after authority loss"
  );
  assert.deepEqual(
    await state.getByRoom(session.livekitRoomName),
    activated.session,
    "room lifecycle index must recover an active session after authority loss"
  );
  redis.values.set(
    `workspace-screen-share:workspace:v1:${session.workspaceId}`,
    JSON.stringify(activated.session)
  );
  redis.values.set(
    `workspace-screen-share:room:v1:${session.livekitRoomName}`,
    session.workspaceId
  );
  const viewerIdentity =
    `screen-share-viewer:${session.sessionId}:viewer-user:viewer-request`;
  const viewerIdentityInput = {
    workspaceId: session.workspaceId,
    sessionId: session.sessionId,
    livekitRoomName: session.livekitRoomName,
    userId: "viewer-user",
    identity: viewerIdentity
  };
  assert.equal(await state.registerViewerIdentity(viewerIdentityInput), true);
  assert.equal(
    await state.enqueueViewerRevocation(viewerIdentityInput, 100),
    true
  );
  assert.deepEqual(
    await state.claimDueViewerRevocation(100, 1_000),
    {
      workspaceId: viewerIdentityInput.workspaceId,
      sessionId: viewerIdentityInput.sessionId,
      livekitRoomName: viewerIdentityInput.livekitRoomName,
      userId: viewerIdentityInput.userId
    }
  );
  assert.equal(
    await state.enqueueViewerRevocation(viewerIdentityInput, 100),
    false,
    "a duplicate event must not shorten an active worker lease"
  );
  assert.equal(
    await state.claimDueViewerRevocation(100, 1_000),
    null,
    "a claimed revocation lease must exclude a concurrent worker"
  );
  assert.equal(
    await state.completeViewerRevocation(viewerIdentityInput, 1_100),
    false,
    "a pending task must remain while an identity is registered"
  );
  assert.equal(await state.claimDueViewerRevocation(1_099, 2_000), null);
  assert.deepEqual(
    await state.listViewerIdentities(viewerIdentityInput),
    [viewerIdentity]
  );
  assert.equal(
    await state.removeViewerIdentityIfCurrent(viewerIdentityInput),
    true
  );
  assert.equal(
    await state.completeViewerRevocation(viewerIdentityInput, 2_000),
    true
  );
  assert.equal(await state.claimDueViewerRevocation(2_000, 3_000), null);
  assert.deepEqual(await state.drainViewerIdentities(viewerIdentityInput), []);
  assert.equal(await state.registerViewerIdentity(viewerIdentityInput), true);
  assert.deepEqual(
    await state.drainViewerIdentities(viewerIdentityInput),
    [viewerIdentity]
  );
  assert.deepEqual(await state.drainViewerIdentities(viewerIdentityInput), []);
  assert.equal(await state.registerViewerIdentity(viewerIdentityInput), true);
  assert.equal(
    typeof state.releaseStartingIfCurrent,
    "function",
    "state must expose a starting-only reservation rollback"
  );
  assert.equal(
    await state.releaseStartingIfCurrent({
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      livekitRoomName: session.livekitRoomName,
      rollbackAttemptId: "attempt-recovery"
    }),
    null
  );
  assert.deepEqual(await state.getCurrent(session.workspaceId), activated?.session);
  redis.advance(2);
  assert.equal(
    await state.reserve(
      {
        ...session,
        sessionId: "77777777-7777-4777-8777-777777777777",
        workspaceId: "88888888-8888-4888-8888-888888888888"
      },
      "attempt-other"
    ),
    false
  );

  assert.equal(
    await state.terminateIfCurrent({
      workspaceId: session.workspaceId,
      sessionId: "55555555-5555-4555-8555-555555555555",
      livekitRoomName: session.livekitRoomName
    }),
    null
  );

  redis.replaceRoomOwner(
    session.livekitRoomName,
    "88888888-8888-4888-8888-888888888888"
  );
  assert.equal(
    await state.terminateIfCurrent({
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      livekitRoomName: session.livekitRoomName
    }),
    null
  );
  assert.equal(
    (await state.getCurrent(session.workspaceId))?.sessionId,
    session.sessionId
  );
  redis.replaceRoomOwner(session.livekitRoomName, session.workspaceId);
  assert.equal(
    (
      await state.terminateIfCurrent({
        workspaceId: session.workspaceId,
        sessionId: session.sessionId,
        livekitRoomName: session.livekitRoomName
      })
    )?.session.sessionId,
    session.sessionId
  );
  assert.equal(await state.getCurrent(session.workspaceId), null);
  assert.equal(
    redis.sets.has(
      `workspace-screen-share:viewers:v1:${session.workspaceId}:${session.sessionId}:viewer-user`
    ),
    false,
    "ending a session must purge every registered viewer identity"
  );
  assert.equal(await state.isKnownScreenShareRoom(session.livekitRoomName), true);
  assert.deepEqual(redis.cleanupEntries.at(-1), {
    id: "cleanup-1",
    session: JSON.stringify(activated?.session),
    mode: "revocation"
  });
  assert.deepEqual(
    JSON.parse(redis.streamEntries.at(-1).event),
    {
      version: 1,
      event: "workspace-screen-share:ended",
      workspaceId: session.workspaceId,
      sessionId: session.sessionId
    }
  );

  {
    const reclaimRedis = new FakeRedisClient();
    const reclaimState = new TestScreenShareStateService(reclaimRedis);
    const expired = {
      ...session,
      createdAt: "2026-07-18T00:00:00.000Z"
    };
    const candidate = {
      ...session,
      sessionId: "66666666-6666-4666-8666-666666666666",
      sharerUserId: "44444444-4444-4444-8444-444444444444",
      sharerLiveKitIdentity:
        "screen-share:66666666-6666-4666-8666-666666666666:44444444-4444-4444-8444-444444444444",
      livekitRoomName:
        "pilo-screen-share-66666666-6666-4666-8666-666666666666",
      createdAt: "2026-07-18T00:02:00.000Z"
    };
    assert.equal(await reclaimState.reserve(expired, "old-attempt"), true);
    assert.equal(
      await reclaimState.replaceExpiredStartingIfCurrent(
        {
          workspaceId: expired.workspaceId,
          sessionId: expired.sessionId,
          livekitRoomName: expired.livekitRoomName,
          createdAt: expired.createdAt,
          expiredBefore: "2026-07-18T00:01:00.000Z"
        },
        candidate,
        "new-attempt"
      ),
      true
    );
    assert.deepEqual(await reclaimState.getCurrent(candidate.workspaceId), candidate);
    assert.equal(await reclaimState.getByRoom(expired.livekitRoomName), null);
    assert.equal(
      await reclaimState.isKnownScreenShareRoom(expired.livekitRoomName),
      true
    );
    assert.deepEqual(await reclaimState.getByRoom(candidate.livekitRoomName), candidate);
  }

  assert.equal(await state.reserve(session, "attempt-3"), true);
  assert.equal(
    await state.releaseStartingIfCurrent({
      workspaceId: session.workspaceId,
      sessionId: "55555555-5555-4555-8555-555555555555",
      livekitRoomName: session.livekitRoomName,
      rollbackAttemptId: "attempt-3"
    }),
    null
  );
  assert.equal(
    await state.releaseStartingIfCurrent({
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      livekitRoomName: "pilo-screen-share-wrong-room",
      rollbackAttemptId: "attempt-3"
    }),
    null
  );
  assert.deepEqual(await state.getCurrent(session.workspaceId), session);
  assert.equal(
    (
      await state.releaseStartingIfCurrent({
        workspaceId: session.workspaceId,
        sessionId: session.sessionId,
        livekitRoomName: session.livekitRoomName,
        rollbackAttemptId: "attempt-3"
      })
    )?.status,
    "starting"
  );
  assert.equal(await state.getCurrent(session.workspaceId), null);

  const publisher = decodeJwtPayload(
    (
      await tokens.createPublisherToken({
        identity: session.sharerLiveKitIdentity,
        roomName: session.livekitRoomName,
        participantName: "민준"
      })
    ).livekitToken
  );
  assert.deepEqual(publisher.video?.canPublishSources, ["screen_share"]);
  assert.equal(publisher.video?.canSubscribe, false);
  assert.equal(publisher.video?.canPublishData, false);
  assert.equal(
    publisher.exp - publisher.nbf,
    45,
    "publisher token must expire no later than the starting lease"
  );

  const viewer = decodeJwtPayload(
    (
      await tokens.createViewerToken({
        identity: "screen-viewer:66666666-6666-4666-8666-666666666666",
        roomName: session.livekitRoomName,
        participantName: "서연"
      })
    ).livekitToken
  );
  assert.equal(viewer.video?.canPublish, false);
  assert.equal(viewer.video?.canSubscribe, true);
  assert.equal(viewer.video?.canPublishData, false);
  assert.equal(viewer.exp - viewer.nbf, 45);

  const publicSession = {
    id: session.sessionId,
    sharer: {
      userId: session.sharerUserId,
      displayName: session.sharerDisplayName,
      avatarUrl: session.sharerAvatarUrl
    },
    startedAt: "2026-07-18T00:00:01.000Z"
  };
  assert.deepEqual(screenShareAlreadyActive(publicSession).getResponse(), {
    success: false,
    error: {
      code: "SCREEN_SHARE_ALREADY_ACTIVE",
      message: "Screen share is already active",
      details: { session: publicSession }
    }
  });
  assert.deepEqual(screenShareAlreadyActive().getResponse(), {
    success: false,
    error: {
      code: "SCREEN_SHARE_ALREADY_ACTIVE",
      message: "Screen share is already active"
    }
  });
  assert.deepEqual(screenShareNotFound().getResponse(), {
    success: false,
    error: {
      code: "SCREEN_SHARE_NOT_FOUND",
      message: "Screen share not found"
    }
  });
  assert.deepEqual(badRequest("Invalid request").getResponse(), {
    success: false,
    error: { code: "BAD_REQUEST", message: "Invalid request" }
  });

  const isServiceUnavailable = error =>
    error?.getStatus?.() === 503 &&
    error?.getResponse?.().error.code === "SERVICE_UNAVAILABLE";

  delete process.env.REDIS_URL;
  await assert.rejects(
    new TestScreenShareStateService(new FakeRedisClient()).getCurrent(
      session.workspaceId
    ),
    isServiceUnavailable
  );
  process.env.REDIS_URL = "redis://screen-share.test:6379";
  await assert.rejects(
    new TestScreenShareStateService(
      new FakeRedisClient({ failConnect: true })
    ).getCurrent(session.workspaceId),
    isServiceUnavailable
  );
  await assert.rejects(
    new TestScreenShareStateService(
      new FakeRedisClient({ failGet: true })
    ).getCurrent(session.workspaceId),
    isServiceUnavailable
  );
  await assert.rejects(
    new TestScreenShareStateService(
      new FakeRedisClient({ failEval: true })
    ).reserve(session),
    isServiceUnavailable
  );
} finally {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

console.log("screen share state and token tests passed");
