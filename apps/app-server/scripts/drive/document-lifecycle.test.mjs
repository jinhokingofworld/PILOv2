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
const createdAt = new Date("2026-07-16T01:00:00.000Z");

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
    const next = this.rows.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next ?? null;
  }
  async query() {
    return this.queryRows?.shift() ?? [];
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

const database = new FakeDatabase([driveItemRow(), documentRow(), snapshotRow()]);
const workspaceService = new FakeWorkspaceService();
const activityLogService = new FakeActivityLogService();
const service = new DocumentService(database, workspaceService, activityLogService, {
  createDocumentId: () => documentId,
  createSnapshotId: () => snapshotId
});

const result = await service.createDocument(currentUserId, workspaceId, {
  parentId: null,
  name: " PILO 기획서 "
});

assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
assert.equal(database.transactions, 1);
assert.match(database.queryOneCalls[0].text, /INSERT INTO drive_items/);
assert.deepEqual(database.queryOneCalls[0].values, [
  documentId, workspaceId, null, "PILO 기획서", currentUserId
]);
assert.match(database.queryOneCalls[1].text, /INSERT INTO documents/);
assert.deepEqual(database.queryOneCalls[1].values, [documentId, workspaceId, documentId]);
assert.match(database.queryOneCalls[2].text, /INSERT INTO document_snapshots/);
assert.equal(database.queryOneCalls[2].values[0], snapshotId);
assert.match(database.executeCalls[0].text, /latest_snapshot_id/);
assert.equal(activityLogService.calls[0].input.action, "document_created");
assert.equal(activityLogService.calls[0].input.dedupeKey, `document:document_created:${documentId}:0`);
assert.equal(result.item.itemType, "document");
assert.equal(result.item.name, "PILO 기획서");
assert.equal(result.document.latestSnapshotId, snapshotId);

const automaticNameDatabase = new FakeDatabase([
  uniqueViolation(),
  driveItemRow({ name: "새 문서 (2)" }),
  documentRow(),
  snapshotRow()
]);
automaticNameDatabase.queryRows = [[{ name: "새 문서" }]];
const automaticNameActivityLogService = new FakeActivityLogService();
const automaticNameService = new DocumentService(
  automaticNameDatabase,
  new FakeWorkspaceService(),
  automaticNameActivityLogService,
  {
    createDocumentId: () => documentId,
    createSnapshotId: () => snapshotId
  }
);

const automaticallyNamedDocument = await automaticNameService.createDocument(
  currentUserId,
  workspaceId,
  { parentId: null }
);

assert.equal(automaticNameDatabase.transactions, 2);
assert.equal(automaticNameDatabase.queryOneCalls[0].values[3], "새 문서");
assert.equal(automaticNameDatabase.queryOneCalls[1].values[3], "새 문서 (2)");
assert.equal(automaticallyNamedDocument.item.name, "새 문서 (2)");
assert.equal(automaticNameActivityLogService.calls.length, 1);

const explicitNameDatabase = new FakeDatabase([uniqueViolation()]);
const explicitNameService = new DocumentService(
  explicitNameDatabase,
  new FakeWorkspaceService(),
  new FakeActivityLogService(),
  {
    createDocumentId: () => documentId,
    createSnapshotId: () => snapshotId
  }
);

await assert.rejects(
  () =>
    explicitNameService.createDocument(currentUserId, workspaceId, {
      parentId: null,
      name: "새 문서"
    }),
  (error) => error?.getStatus?.() === 400
);

console.log("Document lifecycle tests passed.");

function uniqueViolation() {
  return Object.assign(new Error("duplicate drive item name"), {
    code: "23505",
    constraint: "ux_drive_items_workspace_parent_name_active"
  });
}

function driveItemRow(overrides = {}) {
  return {
    id: documentId, workspace_id: workspaceId, parent_id: null, item_type: "document",
    name: "PILO 기획서", object_key: null, mime_type: null, size_bytes: null,
    upload_status: null, created_by_user_id: currentUserId, updated_by_user_id: null,
    created_at: createdAt, updated_at: createdAt, deleted_at: null,
    created_by_user_name: "PILO User", created_by_user_avatar_url: null,
    updated_by_user_name: null, updated_by_user_avatar_url: null,
    ...overrides
  };
}

function documentRow() {
  return {
    id: documentId, drive_item_id: documentId, workspace_id: workspaceId,
    current_version: "0", latest_snapshot_id: null, created_at: createdAt,
    updated_at: createdAt, deleted_at: null
  };
}

function snapshotRow() {
  return {
    id: snapshotId, document_id: documentId, workspace_id: workspaceId,
    version: "0", created_at: createdAt
  };
}
