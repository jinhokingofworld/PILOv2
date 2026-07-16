import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DriveService } = require("../../dist/modules/drive/drive.service.js");

const currentUserId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const sourceFolderId = "44444444-4444-4444-8444-444444444444";
const targetFolderId = "55555555-5555-4555-8555-555555555555";
const createdAt = new Date("2026-07-16T01:00:00.000Z");
const updatedAt = new Date("2026-07-16T01:10:00.000Z");

class FakeDatabase {
  constructor(rows = []) {
    this.rows = [...rows];
    this.queryOneCalls = [];
    this.executeCalls = [];
    this.transactions = 0;
    this.rollbacks = 0;
  }

  async queryOne(text, values = []) {
    this.queryOneCalls.push({ text, values });
    return this.rows.shift() ?? null;
  }

  async execute(text, values = []) {
    this.executeCalls.push({ text, values });
    return { rows: [] };
  }

  async transaction(callback) {
    this.transactions += 1;
    try {
      return await callback(this);
    } catch (error) {
      this.rollbacks += 1;
      throw error;
    }
  }
}

class FakeWorkspaceService {
  async assertWorkspaceAccess() {}
}

class FakeDriveStorageService {}

class FakeActivityLogService {
  constructor() {
    this.calls = [];
  }

  async append(transaction, input) {
    this.calls.push({ transaction, input });
  }
}

class FailingActivityLogService extends FakeActivityLogService {
  async append(transaction, input) {
    await super.append(transaction, input);
    throw new Error("Activity Log append failed");
  }
}

{
  const database = new FakeDatabase([documentRow()]);
  const service = createService(database, new FakeActivityLogService());

  await assert.rejects(
    () =>
      service.updateItem(currentUserId, workspaceId, documentId, {
        name: "renamed",
        parentId: null
      }),
    (error) => error?.getStatus?.() === 400
  );
  assert.equal(database.transactions, 0);
}

{
  const database = new FakeDatabase([
    documentRow(),
    documentRow({ name: "PILO 기획서 v2", updated_at: updatedAt })
  ]);
  const activityLogService = new FakeActivityLogService();
  const service = createService(database, activityLogService);

  const result = await service.updateItem(currentUserId, workspaceId, documentId, {
    name: "PILO 기획서 v2"
  });

  assert.equal(result.name, "PILO 기획서 v2");
  assert.equal(database.transactions, 1);
  assert.match(database.queryOneCalls[1].text, /UPDATE drive_items/);
  assert.equal(activityLogService.calls[0].input.action, "document_renamed");
  assert.equal(activityLogService.calls[0].transaction, database);
  assert.deepEqual(activityLogService.calls[0].input.metadata.data, {
    title: "PILO 기획서 v2",
    previousTitle: "PILO 기획서"
  });
}

{
  const database = new FakeDatabase([
    documentRow(),
    folderRow(),
    documentRow({ parent_id: targetFolderId, updated_at: updatedAt })
  ]);
  const activityLogService = new FakeActivityLogService();
  const service = createService(database, activityLogService);

  const result = await service.updateItem(currentUserId, workspaceId, documentId, {
    parentId: targetFolderId
  });

  assert.equal(result.parentId, targetFolderId);
  assert.equal(database.transactions, 1);
  assert.match(database.queryOneCalls[2].text, /parent_id = \$3/);
  assert.equal(activityLogService.calls[0].input.action, "document_moved");
  assert.deepEqual(activityLogService.calls[0].input.metadata.data, {
    fromParentId: sourceFolderId,
    toParentId: targetFolderId
  });
}

{
  const database = new FakeDatabase([folderRow({ id: sourceFolderId }), folderRow({ id: targetFolderId }), { id: targetFolderId }]);
  const service = createService(database, new FakeActivityLogService());

  await assert.rejects(
    () =>
      service.updateItem(currentUserId, workspaceId, sourceFolderId, {
        parentId: targetFolderId
      }),
    (error) => error?.getStatus?.() === 400
  );
}

{
  const database = new FakeDatabase([documentRow(), { deleted_item_count: "1" }]);
  const activityLogService = new FakeActivityLogService();
  const service = createService(database, activityLogService);

  const result = await service.deleteItem(currentUserId, workspaceId, documentId);

  assert.deepEqual(result, {
    id: documentId,
    deleted: true,
    deletedItemCount: 1
  });
  assert.equal(database.transactions, 1);
  assert.match(database.queryOneCalls[1].text, /UPDATE documents/);
  assert.equal(activityLogService.calls[0].input.action, "document_deleted");
  assert.deepEqual(activityLogService.calls[0].input.metadata.data, {});
}

{
  const database = new FakeDatabase([
    documentRow(),
    documentRow({ name: "renamed", updated_at: updatedAt })
  ]);
  const service = createService(database, new FailingActivityLogService());

  await assert.rejects(
    () => service.updateItem(currentUserId, workspaceId, documentId, { name: "renamed" }),
    /Activity Log append failed/
  );
  assert.equal(database.transactions, 1);
  assert.equal(database.rollbacks, 1);
}

console.log("Document lifecycle mutation tests passed.");

function createService(database, activityLogService) {
  return new DriveService(
    database,
    new FakeWorkspaceService(),
    new FakeDriveStorageService(),
    activityLogService
  );
}

function documentRow(overrides = {}) {
  return {
    ...baseRow(),
    id: documentId,
    parent_id: sourceFolderId,
    item_type: "document",
    name: "PILO 기획서",
    ...overrides
  };
}

function folderRow(overrides = {}) {
  return {
    ...baseRow(),
    id: targetFolderId,
    item_type: "folder",
    name: "회의 자료",
    ...overrides
  };
}

function baseRow() {
  return {
    workspace_id: workspaceId,
    object_key: null,
    mime_type: null,
    size_bytes: null,
    upload_status: null,
    created_by_user_id: currentUserId,
    updated_by_user_id: currentUserId,
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: null,
    created_by_user_name: "PILO User",
    created_by_user_avatar_url: null,
    updated_by_user_name: "PILO User",
    updated_by_user_avatar_url: null
  };
}
