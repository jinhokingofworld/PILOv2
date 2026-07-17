import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DocumentEmbeddingOutboxPublisherService
} = require("../../dist/modules/drive/document-embedding-outbox-publisher.service.js");

const claim = {
  id: "11111111-1111-4111-8111-111111111111",
  job_id: "22222222-2222-4222-8222-222222222222",
  workspace_id: "33333333-3333-4333-8333-333333333333",
  attempt_count: 1,
  claim_token: "44444444-4444-4444-8444-444444444444"
};

class FakeDatabase {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.calls = [];
  }

  async query(text, values = []) {
    this.calls.push({ method: "query", text, values });
    return [{ id: claim.id }];
  }

  async execute(text, values = []) {
    this.calls.push({ method: "execute", text, values });
    return { rowCount: 1 };
  }

  async transaction(callback) {
    return callback({
      queryOne: async (text, values = []) => {
        this.calls.push({ method: "queryOne", text, values });
        return claim;
      }
    });
  }
}

class FakeWorkspaceIndexingJobService {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.messages = [];
  }

  async enqueue(payload) {
    this.messages.push(payload);
    if (this.shouldFail) throw new Error("SQS unavailable");
  }
}

{
  const database = new FakeDatabase();
  const queue = new FakeWorkspaceIndexingJobService();
  const publisher = new DocumentEmbeddingOutboxPublisherService(database, queue);

  await publisher.publishDue();

  assert.deepEqual(queue.messages, [{
    version: 1,
    source: "document",
    jobId: claim.job_id
  }]);
  assert.match(
    database.calls.find((call) => call.method === "queryOne").text,
    /FOR UPDATE OF outbox SKIP LOCKED/
  );
  const delivered = database.calls.find(
    (call) => call.method === "execute" && call.text.includes("delivered_at = now()")
  );
  assert.match(delivered.text, /SET status = 'delivered'/);
  assert.deepEqual(delivered.values, [claim.id, claim.claim_token]);
}

{
  const database = new FakeDatabase();
  const queue = new FakeWorkspaceIndexingJobService({ shouldFail: true });
  const publisher = new DocumentEmbeddingOutboxPublisherService(database, queue);

  await publisher.publishDue();

  const retry = database.calls.find(
    (call) => call.method === "execute" && call.text.includes("next_attempt_at = $2")
  );
  assert.equal(retry.values[0], claim.id);
  assert.ok(retry.values[1] instanceof Date);
  assert.equal(retry.values[2], "WORKSPACE_INDEXING_PUBLISH_FAILED");
  assert.equal(retry.values.at(-1), claim.claim_token);
}

console.log("Document embedding outbox publisher tests passed.");
