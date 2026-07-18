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
  expiries = new Map();
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
      const [workspaceKey, roomKey] = options.keys;
      if (this.has(workspaceKey) || this.has(roomKey)) return 0;
      const ttl = Number(options.arguments[1]);
      this.values.set(workspaceKey, options.arguments[0]);
      this.values.set(roomKey, options.arguments[2]);
      this.expiries.set(workspaceKey, this.nowSeconds + ttl);
      this.expiries.set(roomKey, this.nowSeconds + ttl);
      return 1;
    }

    if (script.includes("ACTIVATE_WORKSPACE_SCREEN_SHARE")) {
      const [workspaceKey, roomKey] = options.keys;
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
      if (session.status === "active") return value;
      if (session.status !== "starting") return null;
      const active = {
        ...session,
        status: "active",
        startedAt: options.arguments[2]
      };
      const encoded = JSON.stringify(active);
      const ttl = Number(options.arguments[3]);
      this.values.set(workspaceKey, encoded);
      this.expiries.set(workspaceKey, this.nowSeconds + ttl);
      if (roomKey && this.values.get(roomKey) === session.workspaceId) {
        this.expiries.set(roomKey, this.nowSeconds + ttl);
      }
      return encoded;
    }

    if (script.includes("END_WORKSPACE_SCREEN_SHARE")) {
      const [workspaceKey, roomKey] = options.keys;
      const value = this.values.get(workspaceKey);
      if (!value) return null;
      const session = JSON.parse(value);
      if (
        session.sessionId !== options.arguments[0] ||
        session.livekitRoomName !== options.arguments[1] ||
        this.values.get(roomKey) !== session.workspaceId
      ) {
        return null;
      }
      this.values.delete(workspaceKey);
      this.values.delete(roomKey);
      this.expiries.delete(workspaceKey);
      this.expiries.delete(roomKey);
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

  assert.equal(await state.reserve(session), true);
  assert.equal(
    await state.reserve({
      ...session,
      sessionId: "44444444-4444-4444-8444-444444444444"
    }),
    false
  );
  assert.deepEqual(await state.getCurrent(session.workspaceId), session);
  assert.deepEqual(await state.getByRoom(session.livekitRoomName), session);

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
  assert.equal(activated?.status, "active");
  assert.equal(activated?.startedAt, "2026-07-18T00:00:01.000Z");
  assert.deepEqual(
    await state.activate({
      workspaceId: session.workspaceId,
      sessionId: session.sessionId,
      livekitRoomName: session.livekitRoomName,
      startedAt: "2026-07-18T00:00:02.000Z"
    }),
    activated,
    "redelivered track_published must recover the same active session"
  );
  assert.equal(
    (await state.getCurrent(session.workspaceId))?.startedAt,
    "2026-07-18T00:00:01.000Z"
  );
  redis.advance(2);
  assert.equal(
    await state.reserve({
      ...session,
      sessionId: "77777777-7777-4777-8777-777777777777",
      workspaceId: "88888888-8888-4888-8888-888888888888"
    }),
    false
  );

  assert.equal(
    await state.endIfCurrent({
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
    await state.endIfCurrent({
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
      await state.endIfCurrent({
        workspaceId: session.workspaceId,
        sessionId: session.sessionId,
        livekitRoomName: session.livekitRoomName
      })
    )?.sessionId,
    session.sessionId
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
