import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const redis = require("redis");
const originalCreateClient = redis.createClient;
const originalRedisUrl = process.env.REDIS_URL;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function fakeEvent(id) {
  return {
    version: 1,
    type: "message.deleted",
    workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    occurredAt: "2026-07-16T00:00:00.000Z",
    messageId: id,
    deletedAt: "2026-07-16T00:00:00.000Z"
  };
}

try {
  process.env.REDIS_URL = "redis://chat-test.invalid:6379";
  const connectGate = deferred();
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
        return connectGate.promise;
      },
      async publish(channel, payload) {
        client.publishCalls.push({ channel, payload });
      },
      async quit() {
        client.quitCalls += 1;
      },
      destroy() {
        client.destroyCalls += 1;
      }
    };
    clients.push(client);
    return client;
  };

  const {
    ChatPublisherService
  } = require("../../dist/modules/chat/chat-publisher.service.js");
  const publisher = new ChatPublisherService();
  publisher.logger = { error() {}, warn() {} };

  const firstPublish = publisher.publish(fakeEvent("message-1"));
  const secondPublish = publisher.publish(fakeEvent("message-2"));
  await Promise.resolve();
  assert.equal(
    clients.length,
    1,
    "concurrent first publishes must share one Redis client"
  );
  assert.equal(clients[0].connectCalls, 1);
  connectGate.resolve();
  await Promise.all([firstPublish, secondPublish]);
  assert.equal(clients[0].publishCalls.length, 2);
  await publisher.onModuleDestroy();
  assert.equal(clients[0].quitCalls, 1);

  const shutdownConnectGate = deferred();
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
        return shutdownConnectGate.promise;
      },
      async publish() {
        client.publishCalls += 1;
      },
      async quit() {
        client.quitCalls += 1;
      },
      destroy() {
        client.destroyCalls += 1;
      }
    };
    shutdownClients.push(client);
    return client;
  };

  const shutdownPublisher = new ChatPublisherService();
  shutdownPublisher.logger = { error() {}, warn() {} };
  const pendingPublish = shutdownPublisher.publish(fakeEvent("message-shutdown"));
  await Promise.resolve();
  assert.equal(shutdownClients.length, 1);

  let shutdownResolved = false;
  const shutdown = shutdownPublisher.onModuleDestroy().then(() => {
    shutdownResolved = true;
  });
  await Promise.resolve();
  assert.equal(
    shutdownClients[0].destroyCalls,
    1,
    "teardown must cancel ownership of a pending Redis client"
  );
  assert.equal(
    shutdownResolved,
    false,
    "teardown must wait for the pending connection to settle"
  );

  shutdownConnectGate.resolve();
  await Promise.all([pendingPublish, shutdown]);
  assert.equal(shutdownClients[0].publishCalls, 0);
  assert.equal(
    shutdownClients[0].quitCalls,
    1,
    "a pending client that connects after cancellation must be closed"
  );
  await shutdownPublisher.publish(fakeEvent("message-after-shutdown"));
  assert.equal(shutdownClients.length, 1);
  assert.equal(shutdownClients[0].publishCalls, 0);

  const failureGate = deferred();
  let attempt = 0;
  const retryClients = [];
  redis.createClient = () => {
    attempt += 1;
    const currentAttempt = attempt;
    const client = {
      destroyCalls: 0,
      publishCalls: 0,
      on() {
        return client;
      },
      async connect() {
        if (currentAttempt === 1) return failureGate.promise;
      },
      async publish() {
        client.publishCalls += 1;
      },
      async quit() {},
      destroy() {
        client.destroyCalls += 1;
      }
    };
    retryClients.push(client);
    return client;
  };

  const retryPublisher = new ChatPublisherService();
  retryPublisher.logger = { error() {}, warn() {} };
  const failedFirst = retryPublisher.publish(fakeEvent("message-3"));
  const failedSecond = retryPublisher.publish(fakeEvent("message-4"));
  await Promise.resolve();
  assert.equal(retryClients.length, 1);
  failureGate.reject(new Error("connect failed"));
  await Promise.all([failedFirst, failedSecond]);
  assert.equal(retryClients[0].destroyCalls, 1);

  await retryPublisher.publish(fakeEvent("message-5"));
  assert.equal(retryClients.length, 2, "a failed connection must be retryable");
  assert.equal(retryClients[1].publishCalls, 1);
  await retryPublisher.onModuleDestroy();
} finally {
  redis.createClient = originalCreateClient;
  if (originalRedisUrl === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = originalRedisUrl;
  }
}
