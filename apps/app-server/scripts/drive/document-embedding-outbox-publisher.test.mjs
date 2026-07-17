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
  constructor({ claimRow = claim } = {}) {
    this.claimRow = claimRow;
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
        if (text.includes("RETURNING job_id")) {
          return { job_id: this.claimRow.job_id };
        }
        return this.claimRow;
      },
      execute: async (text, values = []) => {
        this.calls.push({ method: "transaction.execute", text, values });
        return { rowCount: 1 };
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

  const recovery = database.calls.find(
    (call) => call.method === "execute" && call.text.includes("recovered_jobs")
  );
  assert.ok(recovery, "current superseded document jobs must be recovered");
  assert.match(recovery.text, /document\.latest_snapshot_id = job\.snapshot_id/);
  assert.match(recovery.text, /SET status = 'queued'/);
  assert.match(recovery.text, /UPDATE document_embedding_outbox/);
  assert.match(recovery.text, /SET status = 'pending'/);
  assert.doesNotMatch(
    recovery.text.slice(recovery.text.indexOf("UPDATE document_embedding_outbox")),
    /error_code|error_message/
  );

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
  assert.doesNotMatch(delivered.text, /error_code|error_message/);
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
  assert.equal(retry.values.at(-1), claim.claim_token);
  assert.deepEqual(retry.values, [claim.id, retry.values[1], claim.claim_token]);
  assert.doesNotMatch(retry.text, /error_code|error_message/);
}

{
  const exhaustedClaim = { ...claim, attempt_count: 6 };
  const database = new FakeDatabase({ claimRow: exhaustedClaim });
  const queue = new FakeWorkspaceIndexingJobService({ shouldFail: true });
  const publisher = new DocumentEmbeddingOutboxPublisherService(database, queue);

  await publisher.publishDue();

  const failedOutbox = database.calls.find(
    (call) => call.method === "queryOne" && call.text.includes("RETURNING job_id")
  );
  assert.deepEqual(failedOutbox.values, [exhaustedClaim.id, exhaustedClaim.claim_token]);
  assert.doesNotMatch(failedOutbox.text, /error_code|error_message/);

  const failedJob = database.calls.find(
    (call) => call.method === "transaction.execute" && call.text.includes("SET status = 'failed'")
  );
  assert.deepEqual(failedJob.values, [
    exhaustedClaim.job_id,
    "WORKSPACE_INDEXING_PUBLISH_FAILED",
    "Workspace indexing job could not be published"
  ]);
}

console.log("Document embedding outbox publisher tests passed.");
