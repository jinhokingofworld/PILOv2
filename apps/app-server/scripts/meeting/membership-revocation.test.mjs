import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const redis = require("redis");
const originalCreateClient = redis.createClient;
const originalEnv = {
  APP_SERVER_RUNTIME: process.env.APP_SERVER_RUNTIME,
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
  LIVEKIT_URL: process.env.LIVEKIT_URL,
  LIVEKIT_WS_URL: process.env.LIVEKIT_WS_URL,
  REDIS_URL: process.env.REDIS_URL,
};

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const livekitRoomName = "meeting-33333333-3333-4333-8333-333333333333";
const livekitIdentity = `meeting-33333333-3333-4333-8333-333333333333-user-${userId}`;

let membershipRevocationModule;
try {
  membershipRevocationModule = require(
    "../../dist/modules/meeting/meeting-membership-revocation.service.js",
  );
} catch {
  assert.fail("Meeting membership revocation service is missing");
}
const {
  MeetingMembershipRevocationService,
  WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL,
} = membershipRevocationModule;

class FakeDatabase {
  constructor(rows = []) {
    this.rows = rows;
    this.calls = [];
  }

  async query(text, values = []) {
    this.calls.push({ text, values });
    return this.rows;
  }
}

class FakeLiveKitRoomServiceClient {
  constructor({ error = null } = {}) {
    this.error = error;
    this.calls = [];
  }

  async removeParticipant(roomName, identity, options) {
    this.calls.push({ identity, options, roomName });
    if (this.error) throw this.error;
  }
}

class TestMeetingMembershipRevocationService extends MeetingMembershipRevocationService {
  constructor(database, client) {
    super(database);
    this.client = client;
    this.configs = [];
  }

  createRoomServiceClient(config) {
    this.configs.push(config);
    return this.client;
  }

  now() {
    return new Date("2026-07-17T00:00:00.000Z");
  }
}

const validEvent = {
  version: 1,
  type: "membership.revoked",
  workspaceId,
  userId,
  occurredAt: "2026-07-17T00:00:00.000Z",
};

try {
  process.env.LIVEKIT_API_KEY = "test-api-key";
  process.env.LIVEKIT_API_SECRET = "test-api-secret";
  process.env.LIVEKIT_WS_URL = "wss://livekit.example.test";
  delete process.env.LIVEKIT_URL;
  delete process.env.APP_SERVER_RUNTIME;

  {
    const database = new FakeDatabase([
      { livekit_identity: livekitIdentity, livekit_room_name: livekitRoomName },
    ]);
    const client = new FakeLiveKitRoomServiceClient();
    const service = new TestMeetingMembershipRevocationService(database, client);
    service.logger = { error() {}, warn() {} };

    assert.equal(await service.handleMembershipRevocation(validEvent), true);
    assert.equal(database.calls.length, 1);
    assert.match(database.calls[0].text, /FROM meetings/);
    assert.match(database.calls[0].text, /meeting_participants\.left_at IS NULL/);
    assert.match(database.calls[0].text, /meetings\.ended_at IS NULL/);
    assert.deepEqual(database.calls[0].values, [workspaceId, userId]);
    assert.deepEqual(client.calls, [
      {
        roomName: livekitRoomName,
        identity: livekitIdentity,
        options: { revokeTokenTs: 1784246401n },
      },
    ]);
    assert.deepEqual(service.configs, [
      {
        apiKey: "test-api-key",
        apiSecret: "test-api-secret",
        livekitApiUrl: "https://livekit.example.test",
      },
    ]);
  }

  {
    const database = new FakeDatabase();
    const service = new TestMeetingMembershipRevocationService(
      database,
      new FakeLiveKitRoomServiceClient(),
    );
    service.logger = { error() {}, warn() {} };

    assert.equal(
      await service.handleMembershipRevocation({ ...validEvent, userId: "not-a-uuid" }),
      false,
    );
    assert.equal(database.calls.length, 0);
  }

  {
    const database = new FakeDatabase([
      { livekit_identity: livekitIdentity, livekit_room_name: livekitRoomName },
    ]);
    const client = new FakeLiveKitRoomServiceClient({
      error: { code: "not_found" },
    });
    const service = new TestMeetingMembershipRevocationService(database, client);
    service.logger = { error() {}, warn() {} };

    assert.equal(await service.handleMembershipRevocation(validEvent), true);
  }

  {
    const database = new FakeDatabase([
      { livekit_identity: livekitIdentity, livekit_room_name: livekitRoomName },
    ]);
    const client = new FakeLiveKitRoomServiceClient({
      error: new Error("provider raw error must not escape"),
    });
    const service = new TestMeetingMembershipRevocationService(database, client);
    const logs = [];
    service.logger = {
      error(message) {
        logs.push(message);
      },
      warn() {},
    };

    assert.equal(await service.handleMembershipRevocation(validEvent), false);
    assert.deepEqual(logs, ["Meeting membership revocation LiveKit eviction failed"]);
  }

  {
    delete process.env.REDIS_URL;
    let createClientCalls = 0;
    redis.createClient = () => {
      createClientCalls += 1;
      throw new Error("Redis client should not be created");
    };
    const service = new TestMeetingMembershipRevocationService(
      new FakeDatabase(),
      new FakeLiveKitRoomServiceClient(),
    );
    service.logger = { error() {}, warn() {} };

    await service.onModuleInit();
    assert.equal(createClientCalls, 0);
    await service.onModuleDestroy();
  }

  {
    process.env.REDIS_URL = "redis://membership-test.invalid:6379";
    const subscriptions = [];
    const client = {
      connectCalls: 0,
      destroyCalls: 0,
      quitCalls: 0,
      on() {
        return client;
      },
      async connect() {
        client.connectCalls += 1;
      },
      async quit() {
        client.quitCalls += 1;
      },
      async subscribe(channel, handler) {
        subscriptions.push({ channel, handler });
      },
      destroy() {
        client.destroyCalls += 1;
      },
    };
    redis.createClient = () => client;
    const service = new TestMeetingMembershipRevocationService(
      new FakeDatabase(),
      new FakeLiveKitRoomServiceClient(),
    );
    service.logger = { error() {}, warn() {} };

    await service.onModuleInit();
    assert.equal(client.connectCalls, 1);
    assert.equal(subscriptions.length, 1);
    assert.equal(
      subscriptions[0].channel,
      WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL,
    );
    await service.onModuleDestroy();
    assert.equal(client.quitCalls, 1);
  }
} finally {
  redis.createClient = originalCreateClient;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
