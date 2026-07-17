import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DocumentService } = require(
  "../../dist/modules/drive/document.service.js"
);

const currentUserId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const snapshotId = "44444444-4444-4444-8444-444444444444";

class FakeDatabase {
  constructor() {
    this.rows = [lockedDocumentRow(), snapshotRow(), documentRow()];
    this.transactions = 0;
  }

  async transaction(callback) {
    this.transactions += 1;
    return callback(this);
  }

  async queryOne() {
    return this.rows.shift() ?? null;
  }

  async query() {
    return [];
  }

  async execute() {
    return { rows: [] };
  }
}

class FakeWorkspaceService {
  async assertWorkspaceAccess() {}
}

class FakeActivityLogService {
  async append() {}
}

class FakeDocumentEmbeddingService {
  constructor() {
    this.calls = [];
  }

  async queueSnapshot(transaction, input) {
    this.calls.push({ transaction, input });
  }
}

const database = new FakeDatabase();
const embeddingService = new FakeDocumentEmbeddingService();
const service = new DocumentService(
  database,
  new FakeWorkspaceService(),
  new FakeActivityLogService(),
  { createDocumentId: () => documentId, createSnapshotId: () => snapshotId },
  embeddingService
);

await service.saveDocumentSnapshot(currentUserId, workspaceId, documentId, {
  expectedVersion: 0,
  yjsState: "AQID",
  contentJson: { type: "doc", content: [{ type: "paragraph" }] }
});

assert.equal(database.transactions, 1);
assert.deepEqual(embeddingService.calls, [
  {
    transaction: database,
    input: { workspaceId, documentId, snapshotId }
  }
]);

console.log("Document embedding save integration tests passed.");

function lockedDocumentRow() {
  return {
    id: documentId,
    drive_item_id: documentId,
    workspace_id: workspaceId,
    current_version: "0",
    latest_snapshot_id: "55555555-5555-4555-8555-555555555555",
    created_at: new Date("2026-07-17T00:00:00.000Z"),
    updated_at: new Date("2026-07-17T00:00:00.000Z"),
    deleted_at: null,
    name: "PILO 기획서",
    current_snapshot_content_json: { type: "doc", content: [{ type: "paragraph" }] }
  };
}

function snapshotRow() {
  return {
    id: snapshotId,
    document_id: documentId,
    workspace_id: workspaceId,
    version: "1",
    yjs_state: Buffer.from([1, 2, 3]),
    content_json: { type: "doc", content: [{ type: "paragraph" }] },
    plain_text: "",
    source_update_sequence: "0",
    created_at: new Date("2026-07-17T00:00:01.000Z")
  };
}

function documentRow() {
  return {
    id: documentId,
    drive_item_id: documentId,
    workspace_id: workspaceId,
    current_version: "1",
    latest_snapshot_id: snapshotId,
    created_at: new Date("2026-07-17T00:00:00.000Z"),
    updated_at: new Date("2026-07-17T00:00:01.000Z"),
    deleted_at: null
  };
}
