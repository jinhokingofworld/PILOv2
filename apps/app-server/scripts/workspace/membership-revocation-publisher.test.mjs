import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const redis = require("redis");
const originalCreateClient = redis.createClient;
const originalRedisUrl = process.env.REDIS_URL;
const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const event = {
  version: 1,
  type: "membership.revoked",
  workspaceId,
  userId,
  occurredAt: "2026-07-17T00:00:00.000Z",
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

let publisherModule;
try {
  publisherModule = require(
    "../../dist/modules/workspace-membership-revocation/workspace-membership-revocation-publisher.service.js",
  );
} catch {
  assert.fail("Workspace membership revocation publisher is missing");
}

const {
  WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL,
  WorkspaceMembershipRevocationPublisherService,
} = publisherModule;

try {
  delete process.env.REDIS_URL;
  let createClientCalls = 0;
  redis.createClient = () => {
    createClientCalls += 1;
    throw new Error("Redis client should not be created");
  };
  const disabledPublisher = new WorkspaceMembershipRevocationPublisherService();
  assert.equal(await disabledPublisher.publishMembershipRevoked(event), false);
  assert.equal(createClientCalls, 0);
  await disabledPublisher.onModuleDestroy();

  process.env.REDIS_URL = "redis://membership-test.invalid:6379";
  const clients = [];
  redis.createClient = () => {
    const client = {
      connectCalls: 0,
      destroyCalls: 0,
      publishCalls: [],
      quitCalls: 0,
      on() {
        return client;
      },
      async connect() {
        client.connectCalls += 1;
      },
      async publish(channel, payload) {
        client.publishCalls.push({ channel, payload: JSON.parse(payload) });
      },
      async quit() {
        client.quitCalls += 1;
      },
      destroy() {
        client.destroyCalls += 1;
      },
    };
    clients.push(client);
    return client;
  };
  const publisher = new WorkspaceMembershipRevocationPublisherService();
  publisher.logger = { error() {}, warn() {} };
  await Promise.all([
    publisher.publishMembershipRevoked(event),
    publisher.publishMembershipRevoked(event),
  ]);

  assert.equal(
    WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL,
    "workspace:membership-revocations",
  );
  assert.equal(clients.length, 1);
  assert.equal(clients[0].connectCalls, 1);
  assert.equal(clients[0].publishCalls.length, 2);
  for (const call of clients[0].publishCalls) {
    assert.equal(call.channel, WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL);
    assert.deepEqual(Object.keys(call.payload).sort(), [
      "occurredAt",
      "type",
      "userId",
      "version",
      "workspaceId",
    ]);
    assert.deepEqual(
      {
        type: call.payload.type,
        userId: call.payload.userId,
        version: call.payload.version,
        workspaceId: call.payload.workspaceId,
      },
      { type: "membership.revoked", userId, version: 1, workspaceId },
    );
    assert.deepEqual(
      call.payload,
      event,
    );
  }
  await publisher.onModuleDestroy();
  assert.equal(clients[0].quitCalls, 1);

  const logs = [];
  redis.createClient = ({ url }) => {
    const client = {
      on() {
        return client;
      },
      async connect() {
        throw new Error(`connect failed ${url} bearer-secret user-content`);
      },
      async publish() {
        throw new Error("publish failed bearer-secret user-content");
      },
      async quit() {},
      destroy() {},
    };
    return client;
  };
  const failingPublisher = new WorkspaceMembershipRevocationPublisherService();
  failingPublisher.logger = {
    error(message) {
      logs.push(message);
    },
    warn(message) {
      logs.push(message);
    },
  };
  assert.equal(await failingPublisher.publishMembershipRevoked(event), false);
  assert.equal(logs.length > 0, true);
  assert.doesNotMatch(logs.join("\n"), /redis:\/\//i);
  assert.doesNotMatch(logs.join("\n"), /bearer-secret|user-content/i);

  redis.createClient = () => {
    const client = {
      on() {
        return client;
      },
      async connect() {},
      async publish() {
        throw new Error("publish failed bearer-secret user-content");
      },
      async quit() {},
      destroy() {},
    };
    return client;
  };
  const publishFailureLogs = [];
  const publishFailingPublisher =
    new WorkspaceMembershipRevocationPublisherService();
  publishFailingPublisher.logger = {
    error(message) {
      publishFailureLogs.push(message);
    },
    warn(message) {
      publishFailureLogs.push(message);
    },
  };
  assert.equal(await publishFailingPublisher.publishMembershipRevoked(event), false);
  assert.equal(publishFailureLogs.length > 0, true);
  assert.doesNotMatch(publishFailureLogs.join("\n"), /bearer-secret|user-content/i);
  await publishFailingPublisher.onModuleDestroy();

  const connectGate = deferred();
  const shutdownClients = [];
  redis.createClient = () => {
    const client = {
      destroyCalls: 0,
      publishCalls: 0,
      quitCalls: 0,
      on() {
        return client;
      },
      async connect() {
        return connectGate.promise;
      },
      async publish() {
        client.publishCalls += 1;
      },
      async quit() {
        client.quitCalls += 1;
      },
      destroy() {
        client.destroyCalls += 1;
      },
    };
    shutdownClients.push(client);
    return client;
  };
  const shutdownPublisher =
    new WorkspaceMembershipRevocationPublisherService();
  shutdownPublisher.logger = { error() {}, warn() {} };
  const pendingPublish = shutdownPublisher.publishMembershipRevoked(event);
  await Promise.resolve();
  const shutdown = shutdownPublisher.onModuleDestroy();
  assert.equal(shutdownClients[0].destroyCalls, 1);
  connectGate.resolve();
  await Promise.all([pendingPublish, shutdown]);
  assert.equal(shutdownClients[0].publishCalls, 0);
  assert.equal(shutdownClients[0].quitCalls, 1);
  assert.equal(await shutdownPublisher.publishMembershipRevoked(event), false);
  assert.equal(shutdownClients.length, 1);
} finally {
  redis.createClient = originalCreateClient;
  if (originalRedisUrl === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = originalRedisUrl;
  }
}
