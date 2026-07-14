import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("reflect-metadata");
const {
  SqlErdOperationPublisherService,
  SQL_ERD_OPERATION_REDIS_CHANNEL,
  getSqlErdOperationRetryDelayMs
} = require("../../dist/modules/sql-erd/sql-erd-operation-publisher.service.js");

const payload = {
  id: "operation-1",
  workspaceId: "workspace-1",
  sessionId: "session-1",
  actorUserId: "user-1",
  type: "layout_patch",
  opSeq: 7,
  clientOperationId: "client-operation-1",
  baseRevision: 3,
  appliedOnRevision: 4,
  resultRevision: 5,
  rebased: true,
  patch: { annotations: { notes: { deleteIds: ["note-1"] } } },
  createdAt: "2026-07-14T12:00:00.000Z"
};

class FakeDatabase {
  constructor({ publishError = null } = {}) {
    this.claim = {
      id: "outbox-1",
      claim_token: "claim-current",
      attempt_count: 1,
      payload
    };
    this.executeCalls = [];
    this.publishError = publishError;
    this.queryCalls = [];
    this.queryOneCalls = [];
    this.storedClaimToken = this.claim.claim_token;
    this.storedStatus = "publishing";
  }

  async query(text, values = []) {
    this.queryCalls.push({ text, values });
    return [{ id: this.claim.id }];
  }

  async transaction(callback) {
    return callback({
      queryOne: async (text, values = []) => {
        this.queryOneCalls.push({ text, values });
        return this.claim;
      }
    });
  }

  async execute(text, values = []) {
    this.executeCalls.push({ text, values });
    const claimToken = text.includes("claim_token = $4") ? values[3] : values[1];
    if (claimToken !== this.storedClaimToken || this.storedStatus !== "publishing") {
      return { rowCount: 0, rows: [] };
    }
    this.storedStatus = text.includes("SET status = 'delivered'")
      ? "delivered"
      : "pending";
    return { rowCount: 1, rows: [] };
  }
}

function createPublisher(database) {
  const publisher = new SqlErdOperationPublisherService(database);
  publisher.getRedisClient = async () => ({
    publish: async (channel, serializedPayload) => {
      if (database.publishError) throw database.publishError;
      database.published = { channel, payload: JSON.parse(serializedPayload) };
    }
  });
  return publisher;
}

assert.deepEqual(
  [1, 2, 3, 4, 5, 6, 7].map(getSqlErdOperationRetryDelayMs),
  [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000],
  "operation publisher backoff must cap at 30 seconds"
);

{
  const database = new FakeDatabase();
  await createPublisher(database).publishDue();

  assert.match(database.queryCalls[0].text, /status = 'pending'/);
  assert.match(database.queryCalls[0].text, /status = 'publishing'/);
  assert.deepEqual(database.queryCalls[0].values, [60, 50]);
  assert.match(database.queryOneCalls[0].text, /FOR UPDATE SKIP LOCKED/);
  assert.deepEqual(database.queryOneCalls[0].values.slice(0, 2), ["outbox-1", 60]);
  assert.deepEqual(database.published, {
    channel: SQL_ERD_OPERATION_REDIS_CHANNEL,
    payload
  });
  assert.match(database.executeCalls[0].text, /SET status = 'delivered'/);
  assert.match(database.executeCalls[0].text, /status = 'publishing' AND claim_token = \$2/);
  assert.deepEqual(database.executeCalls[0].values, ["outbox-1", "claim-current"]);
}

{
  const database = new FakeDatabase({ publishError: new Error("Redis unavailable") });
  database.claim = { ...database.claim, attempt_count: 6 };
  const beforeRetry = Date.now();
  await createPublisher(database).publishDue();

  const retry = database.executeCalls[0];
  assert.match(retry.text, /SET status = 'pending'/);
  assert.match(retry.text, /status = 'publishing' AND claim_token = \$4/);
  assert.equal(retry.values[0], "outbox-1");
  assert.equal(retry.values[3], "claim-current");
  assert.ok(retry.values[1] instanceof Date);
  assert.ok(
    retry.values[1].getTime() >= beforeRetry + 30_000,
    "sixth failed attempt must use capped retry delay"
  );
}

{
  const database = new FakeDatabase();
  database.claim = { ...database.claim, claim_token: "claim-stale" };
  database.storedClaimToken = "claim-newer";
  await createPublisher(database).publishDue();

  const delivered = database.executeCalls[0];
  assert.equal(delivered.values[1], "claim-stale");
  assert.match(delivered.text, /status = 'publishing' AND claim_token = \$2/);
  assert.equal(
    database.storedStatus,
    "publishing",
    "a prior worker must not overwrite a row reclaimed with a newer claim token"
  );
}
