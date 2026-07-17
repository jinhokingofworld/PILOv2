import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DocumentEmbeddingService } = require(
  "../../dist/modules/drive/document-embedding.service.js"
);

const workspaceId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const snapshotId = "33333333-3333-4333-8333-333333333333";
const jobId = "44444444-4444-4444-8444-444444444444";

class FakeTransaction {
  constructor() {
    this.executeCalls = [];
    this.queryOneCalls = [];
  }

  async execute(text, values = []) {
    this.executeCalls.push({ text, values });
    return { rows: [] };
  }

  async queryOne(text, values = []) {
    this.queryOneCalls.push({ text, values });
    return { id: jobId };
  }
}

const transaction = new FakeTransaction();
const service = new DocumentEmbeddingService();

await service.queueSnapshot(transaction, {
  workspaceId,
  documentId,
  snapshotId
});

assert.match(transaction.executeCalls[0].text, /UPDATE document_embedding_jobs/);
assert.deepEqual(transaction.executeCalls[0].values, [documentId, snapshotId]);
assert.match(transaction.queryOneCalls[0].text, /INSERT INTO document_embedding_jobs/);
assert.deepEqual(transaction.queryOneCalls[0].values, [workspaceId, documentId, snapshotId]);
assert.match(transaction.executeCalls[1].text, /INSERT INTO document_embedding_outbox/);
assert.deepEqual(transaction.executeCalls[1].values, [jobId, workspaceId]);

console.log("Document embedding lifecycle tests passed.");
