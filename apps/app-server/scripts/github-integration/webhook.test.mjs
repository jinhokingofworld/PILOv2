import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { GithubIntegrationService } = require("../../dist/modules/github-integration/github-integration.service.js");

class FakeDatabase {
  constructor({ queryOneRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ method: "queryOne", text, values });
    const next = this.queryOneRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
  }
}

const webhookSecret = "test-webhook-secret";
const deliveryId = "b32d8c10-5975-11ef-8e7e-000000000000";
const receivedAt = "2026-07-05T09:00:00.000Z";
const processedAt = "2026-07-05T09:00:01.000Z";

const configService = {
  getGithubWebhookConfig() {
    return {
      webhookSecret
    };
  }
};

function createService(database) {
  return new GithubIntegrationService(
    database,
    {},
    {},
    {},
    configService,
    {},
    {},
    {}
  );
}

function sign(rawBody, secret = webhookSecret) {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function webhookRow(overrides = {}) {
  return {
    delivery_id: deliveryId,
    event_name: "ping",
    status: "received",
    received_at: receivedAt,
    processed_at: null,
    error_message: null,
    ...overrides
  };
}

function assertWebhookFind(text, values) {
  assert.match(text, /FROM github_webhook_deliveries/i);
  assert.match(text, /delivery_id = \$1/i);
  assert.deepEqual(values, [deliveryId]);
}

function assertWebhookRecord(text, values) {
  assert.match(text, /INSERT INTO github_webhook_deliveries/i);
  assert.match(text, /ON CONFLICT \(delivery_id\)/i);
  assert.match(text, /DO NOTHING/i);
  assert.doesNotMatch(text, /token|private_key|secret/i);
  assert.doesNotMatch(JSON.stringify(values), /test-webhook-secret/i);
}

const controllerSource = await readFile(
  new URL("../../src/modules/github-integration/github-integration.controller.ts", import.meta.url),
  "utf8"
);
const mainSource = await readFile(new URL("../../src/main.ts", import.meta.url), "utf8");

assert.match(controllerSource, /@Post\("github\/webhooks"\)/);
assert.match(controllerSource, /@RawBody\(\)/);
assert.match(controllerSource, /receiveGithubWebhook/);
assert.match(mainSource, /rawBody: true/);

{
  const rawBody = Buffer.from(
    '{\n  "zen": "Keep it logically awesome",\n  "hook_id": 123\n}',
    "utf8"
  );
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assertWebhookFind(text, values);
        return null;
      },
      (text, values) => {
        assertWebhookRecord(text, values);
        assert.deepEqual(values, [deliveryId, "ping", "received", null]);
        return webhookRow();
      }
    ]
  });
  const service = createService(database);

  assert.equal(typeof service.receiveGithubWebhook, "function");

  const result = await service.receiveGithubWebhook({
    deliveryId,
    eventName: "ping",
    signature256: sign(rawBody),
    rawBody,
    body: {
      hook_id: 123,
      zen: "Keep it logically awesome"
    }
  });

  assert.deepEqual(result, {
    deliveryId,
    eventName: "ping",
    status: "received",
    receivedAt,
    processedAt: null,
    message: "GitHub webhook received"
  });
}

{
  const rawBody = Buffer.from('{"zen":"Keep it logically awesome"}', "utf8");
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assertWebhookFind(text, values);
        return webhookRow();
      }
    ]
  });
  const service = createService(database);

  const result = await service.receiveGithubWebhook({
    deliveryId,
    eventName: "ping",
    signature256: sign(rawBody),
    rawBody,
    body: {
      zen: "Keep it logically awesome"
    }
  });

  assert.deepEqual(result, {
    deliveryId,
    eventName: "ping",
    status: "received",
    receivedAt,
    processedAt: null,
    message: "GitHub webhook received"
  });
  assert.equal(database.queries.length, 1);
}

{
  const rawBody = Buffer.from('{"action":"opened"}', "utf8");
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assertWebhookFind(text, values);
        return null;
      },
      (text, values) => {
        assertWebhookRecord(text, values);
        assert.deepEqual(values, [
          deliveryId,
          "pull_request_review_thread",
          "ignored",
          "Unsupported GitHub webhook event ignored"
        ]);
        return webhookRow({
          event_name: "pull_request_review_thread",
          status: "ignored",
          processed_at: processedAt,
          error_message: "Unsupported GitHub webhook event ignored"
        });
      }
    ]
  });
  const service = createService(database);

  const result = await service.receiveGithubWebhook({
    deliveryId,
    eventName: "pull_request_review_thread",
    signature256: sign(rawBody),
    rawBody,
    body: {
      action: "opened"
    }
  });

  assert.deepEqual(result, {
    deliveryId,
    eventName: "pull_request_review_thread",
    status: "ignored",
    receivedAt,
    processedAt,
    message: "Unsupported GitHub webhook event ignored"
  });
}

{
  const rawBody = Buffer.from('{"zen":"Keep it logically awesome"}', "utf8");
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assertWebhookRecord(text, values);
        assert.deepEqual(values, [
          deliveryId,
          "ping",
          "failed",
          "Invalid GitHub webhook signature"
        ]);
        return webhookRow({
          status: "failed",
          processed_at: processedAt,
          error_message: "Invalid GitHub webhook signature"
        });
      }
    ]
  });
  const service = createService(database);

  await assert.rejects(
    () =>
      service.receiveGithubWebhook({
        deliveryId,
        eventName: "ping",
        signature256: "sha256=bad-signature",
        rawBody,
        body: {
          zen: "Keep it logically awesome"
        }
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().error.code, "BAD_REQUEST");
      assert.equal(error.getResponse().error.message, "Invalid GitHub webhook signature");
      return true;
    }
  );
  assert.equal(database.queries.length, 1);
}
