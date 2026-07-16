import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const workerFlag = "--unavailable-redis-worker";

function statusTargetRow() {
  return {
    id: "1001",
    board_id: "42",
    column_id: "10",
    project_item_id: "55555555-5555-4555-8555-555555555555",
    github_project_node_id: "PVT_kwDOExample",
    github_project_item_node_id: "PVTI_lADOExample",
    github_field_node_id: "PVTSSF_lADOExample",
    status_field_id: "66666666-6666-4666-8666-666666666666",
    status_field_name: "Status",
    target_status_option_id: "88888888-8888-4888-8888-888888888888",
    target_status_option_github_id: "option-doing",
    target_status_name: "Doing",
    target_status_normalized_name: "doing",
    updated_at: new Date("2026-07-06T01:06:00.000Z")
  };
}

function issueRow() {
  return {
    id: "1001",
    board_id: "42",
    column_id: "20",
    repository_id: "33333333-3333-4333-8333-333333333333",
    github_issue_id: "44444444-4444-4444-8444-444444444444",
    project_item_id: "55555555-5555-4555-8555-555555555555",
    github_issue_node_id: "I_kwDOExample",
    github_project_item_node_id: "PVTI_lADOExample",
    github_issue_number: 134,
    issue_number: "#134",
    title: "Board issue status update",
    html_url: "https://github.com/Developer-EJ/PILO/issues/134",
    state: "open",
    labels: [],
    assignees: [],
    position: 0,
    github_updated_at: null,
    last_synced_at: null,
    created_at: new Date("2026-07-06T01:00:00.000Z"),
    updated_at: new Date("2026-07-06T01:07:00.000Z")
  };
}

async function runUnavailableRedisWorker() {
  const {
    BoardInvalidationPublisherService
  } = require("../../dist/modules/board/board-invalidation-publisher.service.js");
  const {
    BoardIssueStatusService
  } = require("../../dist/modules/board/board-issue-status.service.js");
  const queries = {
    findStatusMoveTarget: async () => statusTargetRow(),
    transaction: async (callback) => callback({}),
    updateProjectItemStatus: async () => {},
    upsertProjectItemStatusFieldValue: async () => {},
    clearProjectItemStatusFieldValue: async () => {},
    updatePiloIssueColumn: async () => {},
    findBoardIssueCard: async () => issueRow()
  };
  const publisher = new BoardInvalidationPublisherService();
  publisher.logger.error = () => {};
  const service = new BoardIssueStatusService(
    queries,
    { assertWorkspaceAccess: async () => ({}) },
    { updateProjectV2ItemStatus: async () => {} },
    { withAdvisoryLock: async (_key, callback) => callback({}) },
    { append: async () => {} },
    publisher
  );
  const warnings = [];
  service.logger.warn = (message) => warnings.push(message);
  const startedAt = performance.now();
  const result = await service.updateBoardIssueStatus(
    "22222222-2222-4222-8222-222222222222",
    "11111111-1111-4111-8111-111111111111",
    "42",
    "1001",
    { columnId: "20", previousColumnId: "10" }
  );

  process.send?.({
    elapsedMs: performance.now() - startedAt,
    issueColumnId: result.issue.columnId,
    warnings
  });
  process.disconnect?.();
}

function runUnavailableRedisStatusUpdate() {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [workerFlag], {
      env: { ...process.env, REDIS_URL: "redis://127.0.0.1:1" },
      silent: true
    });
    let result = null;
    let stderr = "";
    let timedOut = false;
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("message", (message) => {
      result = message;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error("Unavailable Redis worker did not exit within 2000ms"));
        return;
      }
      if (result) {
        resolve(result);
        return;
      }

      reject(
        new Error(
          `Unavailable Redis worker exited without a result (code=${code}, signal=${signal})${stderr}`
        )
      );
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 2000);
  });
}

function createDeferred() {
  let reject;
  let resolve;
  const promise = new Promise((promiseResolve, promiseReject) => {
    reject = promiseReject;
    resolve = promiseResolve;
  });

  return { promise, reject, resolve };
}

class FakeRedisClient {
  constructor({ connect = createDeferred(), publish = null } = {}) {
    this.connectDeferred = connect;
    this.publishDeferred = publish;
    this.connectCalls = 0;
    this.destroyCalls = 0;
    this.errorListeners = [];
    this.isReady = false;
    this.publishCalls = [];
  }

  on(event, listener) {
    if (event === "error") {
      this.errorListeners.push(listener);
    }
    return this;
  }

  async connect() {
    this.connectCalls += 1;
    await this.connectDeferred.promise;
    this.isReady = true;
  }

  async publish(channel, message) {
    this.publishCalls.push({ channel, message });
    if (this.publishDeferred) {
      return this.publishDeferred.promise;
    }
    return 1;
  }

  destroy() {
    this.destroyCalls += 1;
    this.isReady = false;
    const error = new Error("Redis client destroyed");
    this.connectDeferred.reject(error);
    this.publishDeferred?.reject(error);
  }
}

class RedisClientClosedBeforeConnectFake extends FakeRedisClient {
  constructor() {
    const connect = createDeferred();
    connect.resolve();
    super({ connect });
    this.isOpen = false;
  }

  async connect() {
    this.connectCalls += 1;
    this.isOpen = true;
    await this.connectDeferred.promise;
    this.isReady = true;
  }

  destroy() {
    this.destroyCalls += 1;
    if (!this.isOpen) {
      throw new Error("The client is closed");
    }
    this.isOpen = false;
    this.isReady = false;
  }
}

async function runLifecycleTests() {
  const {
    createBoardInvalidationRedisClient,
    createBoardInvalidationRedisConnection
  } = require("../../dist/modules/board/board-invalidation-publisher.service.js");

  {
    const optionsCalls = [];
    const fakeClient = {};
    const client = createBoardInvalidationRedisClient(
      "redis://127.0.0.1:6379",
      (options) => {
        optionsCalls.push(options);
        return fakeClient;
      }
    );

    assert.equal(client, fakeClient);
    assert.deepEqual(optionsCalls, [
      {
        url: "redis://127.0.0.1:6379",
        disableOfflineQueue: true,
        socket: { connectTimeout: 500, reconnectStrategy: false }
      }
    ]);
  }

  {
    const connect = createDeferred();
    const client = new FakeRedisClient({ connect });
    const clients = [];
    const connection = createBoardInvalidationRedisConnection({
      createClient: () => {
        clients.push(client);
        return client;
      }
    });
    const firstPublish = connection.publish("redis://test", "channel", "first");
    const secondPublish = connection.publish("redis://test", "channel", "second");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(clients.length, 1);
    assert.equal(client.connectCalls, 1);
    connect.resolve();
    await Promise.all([firstPublish, secondPublish]);
    assert.deepEqual(client.publishCalls, [
      { channel: "channel", message: "first" },
      { channel: "channel", message: "second" }
    ]);
    connection.destroy();
  }

  {
    const firstConnect = createDeferred();
    firstConnect.resolve();
    const blockedPublish = createDeferred();
    const firstClient = new FakeRedisClient({
      connect: firstConnect,
      publish: blockedPublish
    });
    const secondConnect = createDeferred();
    secondConnect.resolve();
    const secondClient = new FakeRedisClient({ connect: secondConnect });
    const clients = [firstClient, secondClient];
    let createCalls = 0;
    const connection = createBoardInvalidationRedisConnection({
      createClient: () => clients[createCalls++],
      operationTimeoutMs: 25
    });

    await assert.rejects(
      connection.publish("redis://test", "channel", "blocked"),
      /Board invalidation Redis operation timed out/
    );
    assert.equal(firstClient.destroyCalls, 1);
    await connection.publish("redis://test", "channel", "retry");
    await connection.publish("redis://test", "channel", "reuse");
    assert.equal(createCalls, 2);
    assert.deepEqual(secondClient.publishCalls, [
      { channel: "channel", message: "retry" },
      { channel: "channel", message: "reuse" }
    ]);
    connection.destroy();
  }

  {
    const client = new FakeRedisClient();
    let createCalls = 0;
    const connection = createBoardInvalidationRedisConnection({
      createClient: () => {
        createCalls += 1;
        return client;
      }
    });
    const unhandledRejections = [];
    const onUnhandledRejection = (error) => unhandledRejections.push(error);
    process.on("unhandledRejection", onUnhandledRejection);
    try {
      const pendingPublish = connection.publish("redis://test", "channel", "message");
      await new Promise((resolve) => setImmediate(resolve));
      connection.destroy();
      await assert.rejects(pendingPublish, /Redis client destroyed/);
      await new Promise((resolve) => setImmediate(resolve));
      await connection.publish("redis://test", "channel", "after-shutdown");

      assert.equal(client.destroyCalls, 1);
      assert.equal(createCalls, 1);
      assert.deepEqual(unhandledRejections, []);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  }

  {
    const client = new RedisClientClosedBeforeConnectFake();
    const connection = createBoardInvalidationRedisConnection({
      createClient: () => client
    });
    const unhandledRejections = [];
    const onUnhandledRejection = (error) => unhandledRejections.push(error);
    process.on("unhandledRejection", onUnhandledRejection);
    try {
      const pendingPublish = connection.publish("redis://test", "channel", "message");
      connection.destroy();

      await assert.rejects(
        pendingPublish,
        /Board invalidation Redis client did not become ready/
      );
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(client.connectCalls, 1);
      assert.equal(client.destroyCalls, 2);
      assert.equal(client.isOpen, false);
      assert.equal(client.isReady, false);
      assert.deepEqual(unhandledRejections, []);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  }
}

if (process.argv.includes(workerFlag)) {
  await runUnavailableRedisWorker();
} else {
  const result = await runUnavailableRedisStatusUpdate();
  assert.ok(result.elapsedMs < 1500, `Status update took ${result.elapsedMs}ms`);
  assert.equal(result.issueColumnId, "20");
  assert.deepEqual(result.warnings, [
    "Board invalidation publish failed workspace_id=11111111-1111-4111-8111-111111111111 board_id=42"
  ]);
  await runLifecycleTests();
}
