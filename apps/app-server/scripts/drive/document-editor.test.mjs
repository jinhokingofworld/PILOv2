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
const nextSnapshotId = "55555555-5555-4555-8555-555555555555";
const createdAt = new Date("2026-07-16T01:00:00.000Z");
const updatedAt = new Date("2026-07-16T01:10:00.000Z");

class FakeDatabase {
  constructor(rows) {
    this.rows = [...rows];
    this.queryOneCalls = [];
    this.executeCalls = [];
    this.transactions = 0;
  }
  async transaction(callback) {
    this.transactions += 1;
    return callback(this);
  }
  async queryOne(text, values = []) {
    this.queryOneCalls.push({ text, values });
    return this.rows.shift() ?? null;
  }
  async execute(text, values = []) {
    this.executeCalls.push({ text, values });
    return { rows: [] };
  }
}

class FakeWorkspaceService {
  constructor() {
    this.calls = [];
  }
  async assertWorkspaceAccess(userId, targetWorkspaceId) {
    this.calls.push({ userId, workspaceId: targetWorkspaceId });
  }
}

class FakeActivityLogService {
  constructor() {
    this.calls = [];
  }
  async append(transaction, input) {
    this.calls.push({ transaction, input });
  }
}

const workspaceService = new FakeWorkspaceService();
const activityLogService = new FakeActivityLogService();
const database = new FakeDatabase([
  documentBootstrapRow(),
  lockedDocumentRow(),
  insertedSnapshotRow(),
  updatedDocumentRow()
]);
const service = new DocumentService(database, workspaceService, activityLogService, {
  createDocumentId: () => documentId,
  createSnapshotId: () => nextSnapshotId
});

const bootstrap = await service.getDocument(currentUserId, workspaceId, documentId);

assert.equal(bootstrap.item.id, documentId);
assert.equal(bootstrap.document.currentVersion, 0);
assert.equal(bootstrap.snapshot.id, snapshotId);
assert.equal(bootstrap.snapshot.yjsState, "AAA=");
assert.deepEqual(bootstrap.snapshot.contentJson, {
  type: "doc",
  content: [{ type: "paragraph" }]
});
assert.match(database.queryOneCalls[0].text, /document_snapshots/);
assert.match(database.queryOneCalls[0].text, /drive_items/);

const saved = await service.saveDocumentSnapshot(currentUserId, workspaceId, documentId, {
  expectedVersion: 0,
  yjsState: "AQID",
  contentJson: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "PILO 기획서" }] }]
  }
});

assert.equal(database.transactions, 1);
assert.match(database.queryOneCalls[1].text, /FOR UPDATE/);
assert.match(database.queryOneCalls[2].text, /INSERT INTO document_snapshots/);
assert.equal(database.queryOneCalls[2].values[0], nextSnapshotId);
assert.equal(database.queryOneCalls[2].values[3], 1);
assert.equal(database.queryOneCalls[2].values[4].toString("base64"), "AQID");
assert.match(database.queryOneCalls[3].text, /UPDATE documents/);
assert.equal(saved.document.currentVersion, 1);
assert.equal(saved.snapshot.id, nextSnapshotId);
assert.equal(saved.snapshot.plainText, "PILO 기획서");
assert.equal(activityLogService.calls[0].input.action, "document_content_updated");
assert.equal(
  activityLogService.calls[0].input.dedupeKey,
  `document:document_content_updated:${documentId}:1`
);
assert.equal(Object.hasOwn(activityLogService.calls[0].input.metadata.data, "contentJson"), false);
assert.equal(Object.hasOwn(activityLogService.calls[0].input.metadata.data, "yjsState"), false);

const staleDatabase = new FakeDatabase([lockedDocumentRow({ currentVersion: 1 })]);
const staleService = new DocumentService(
  staleDatabase,
  new FakeWorkspaceService(),
  new FakeActivityLogService(),
  { createDocumentId: () => documentId, createSnapshotId: () => nextSnapshotId }
);

await assert.rejects(
  () =>
    staleService.saveDocumentSnapshot(currentUserId, workspaceId, documentId, {
      expectedVersion: 0,
      yjsState: "AQID",
      contentJson: { type: "doc", content: [] }
    }),
  (error) => error?.getStatus?.() === 409
);

console.log("Document editor tests passed.");

function documentBootstrapRow() {
  return {
    ...driveItemRow(),
    document_id: documentId,
    document_current_version: "0",
    document_latest_snapshot_id: snapshotId,
    document_created_at: createdAt,
    document_updated_at: createdAt,
    document_deleted_at: null,
    snapshot_id: snapshotId,
    snapshot_version: "0",
    snapshot_yjs_state: Buffer.from([0, 0]),
    snapshot_content_json: { type: "doc", content: [{ type: "paragraph" }] },
    snapshot_plain_text: "",
    snapshot_source_update_sequence: "0",
    snapshot_created_at: createdAt
  };
}

function lockedDocumentRow({ currentVersion = 0 } = {}) {
  return {
    ...documentRow(),
    current_version: String(currentVersion),
    name: "PILO 기획서"
  };
}

function insertedSnapshotRow() {
  return {
    id: nextSnapshotId,
    document_id: documentId,
    workspace_id: workspaceId,
    version: "1",
    yjs_state: Buffer.from([1, 2, 3]),
    content_json: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "PILO 기획서" }] }]
    },
    plain_text: "PILO 기획서",
    source_update_sequence: "0",
    created_at: updatedAt
  };
}

function updatedDocumentRow() {
  return {
    ...documentRow(),
    current_version: "1",
    latest_snapshot_id: nextSnapshotId,
    updated_at: updatedAt
  };
}

function driveItemRow() {
  return {
    id: documentId,
    workspace_id: workspaceId,
    parent_id: null,
    item_type: "document",
    name: "PILO 기획서",
    object_key: null,
    mime_type: null,
    size_bytes: null,
    upload_status: null,
    created_by_user_id: currentUserId,
    updated_by_user_id: null,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null,
    created_by_user_name: "PILO User",
    created_by_user_avatar_url: null,
    updated_by_user_name: null,
    updated_by_user_avatar_url: null
  };
}

function documentRow() {
  return {
    id: documentId,
    drive_item_id: documentId,
    workspace_id: workspaceId,
    current_version: "0",
    latest_snapshot_id: snapshotId,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: null
  };
}
