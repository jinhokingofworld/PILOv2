import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

function readSource(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const appModule = await readSource("../../src/app.module.ts");
const driveModule = await readSource("../../src/modules/drive/drive.module.ts");
const driveController = await readSource(
  "../../src/modules/drive/drive.controller.ts"
);
const driveServiceSource = await readSource(
  "../../src/modules/drive/drive.service.ts"
);
const driveValidation = await readSource(
  "../../src/modules/drive/drive.validation.ts"
);
const driveMapper = await readSource("../../src/modules/drive/drive.mapper.ts");
const packageJson = await readSource("../../package.json");
const require = createRequire(import.meta.url);
const { DriveService } = require("../../dist/modules/drive/drive.service.js");

const currentUserId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const folderId = "33333333-3333-4333-8333-333333333333";
const fileId = "44444444-4444-4444-8444-444444444444";
const createdAt = new Date("2026-07-07T08:00:00.000Z");
const updatedAt = new Date("2026-07-07T08:05:00.000Z");

assert.match(appModule, /DriveModule/);
assert.match(driveModule, /controllers: \[DriveController\]/);
assert.match(driveModule, /providers: \[DriveService\]/);
assert.match(driveModule, /WorkspaceModule/);
assert.match(driveController, /@Controller\("workspaces\/:workspaceId\/drive"\)/);
assert.match(driveController, /@UseGuards\(AuthGuard\)/);
assert.match(driveController, /@Get\("items"\)/);
assert.match(driveController, /@Post\("folders"\)/);
assert.match(driveController, /@Patch\("items\/:itemId"\)/);
assert.match(driveController, /@Delete\("items\/:itemId"\)/);
assert.match(driveServiceSource, /domain: "drive"/);
assert.match(driveServiceSource, /apiContract: "docs\/api\/drive-api.md"/);
assert.match(driveServiceSource, /assertWorkspaceAccess/);
assert.match(driveServiceSource, /FROM drive_items/);
assert.match(driveServiceSource, /INSERT INTO drive_items/);
assert.match(driveServiceSource, /WITH RECURSIVE target_tree/);
assert.match(driveServiceSource, /deleted_at = now\(\)/);
assert.match(driveValidation, /validateCreateDriveFolderRequest/);
assert.match(driveValidation, /validateUpdateDriveItemRequest/);
assert.match(driveValidation, /validateListDriveItemsQuery/);
assert.match(driveValidation, /path separators/);
assert.match(driveMapper, /mapDriveItem/);
assert.doesNotMatch(packageJson, /@aws-sdk\/client-s3/);
assert.doesNotMatch(packageJson, /@aws-sdk\/s3-request-presigner/);

class FakeDatabase {
  constructor({ queryRows = [], queryOneRows = [] } = {}) {
    this.queryRows = [...queryRows];
    this.queryOneRows = [...queryOneRows];
    this.queries = [];
    this.queryOneCalls = [];
  }

  async query(text, values = []) {
    this.queries.push({ text, values });
    const next = this.queryRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? [];
  }

  async queryOne(text, values = []) {
    this.queryOneCalls.push({ text, values });
    const next = this.queryOneRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
  }
}

class FakeWorkspaceService {
  constructor() {
    this.calls = [];
  }

  async assertWorkspaceAccess(userId, targetWorkspaceId) {
    this.calls.push({ userId, workspaceId: targetWorkspaceId });
    return { id: targetWorkspaceId, role: "member" };
  }
}

function createSubject(database = new FakeDatabase()) {
  const workspaceService = new FakeWorkspaceService();
  const service = new DriveService(database, workspaceService);
  return {
    database,
    service,
    workspaceService
  };
}

function itemRow(overrides = {}) {
  return {
    id: folderId,
    workspace_id: workspaceId,
    parent_id: null,
    item_type: "folder",
    name: "Docs",
    object_key: null,
    mime_type: null,
    size_bytes: null,
    upload_status: null,
    created_by_user_id: currentUserId,
    updated_by_user_id: null,
    created_at: createdAt,
    updated_at: updatedAt,
    deleted_at: null,
    created_by_user_name: "PILO User",
    created_by_user_avatar_url: null,
    updated_by_user_name: null,
    updated_by_user_avatar_url: null,
    ...overrides
  };
}

async function assertApiError(action, status, code, messagePattern) {
  await assert.rejects(action, (error) => {
    assert.equal(error.getStatus(), status);
    assert.equal(error.getResponse().error.code, code);
    assert.match(error.getResponse().error.message, messagePattern);
    return true;
  });
}

{
  const folder = itemRow();
  const file = itemRow({
    id: fileId,
    item_type: "file",
    name: "PILO.pdf",
    object_key: "drive/workspaces/workspace/items/file/PILO.pdf",
    mime_type: "application/pdf",
    size_bytes: "1024",
    upload_status: "ready"
  });
  const database = new FakeDatabase({
    queryRows: [
      (text, values) => {
        assert.match(text, /drive_items\.parent_id IS NULL/);
        assert.match(text, /upload_status = 'ready'/);
        assert.deepEqual(values, [workspaceId, null]);
        return [folder, file];
      }
    ]
  });
  const { service, workspaceService } = createSubject(database);

  const result = await service.listItems(currentUserId, workspaceId, undefined);

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.equal(result.parent, null);
  assert.deepEqual(result.breadcrumbs, []);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].itemType, "folder");
  assert.equal(result.items[1].sizeBytes, 1024);
}

{
  const parent = itemRow({ id: folderId, name: "Parent" });
  const child = itemRow({
    id: "55555555-5555-4555-8555-555555555555",
    parent_id: folderId,
    name: "Child"
  });
  const database = new FakeDatabase({
    queryOneRows: [parent],
    queryRows: [[parent], [child]]
  });
  const { service } = createSubject(database);

  const result = await service.listItems(currentUserId, workspaceId, folderId);

  assert.equal(result.parent?.id, folderId);
  assert.equal(result.breadcrumbs[0].name, "Parent");
  assert.equal(result.items[0].parentId, folderId);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /INSERT INTO drive_items/);
        assert.deepEqual(values, [workspaceId, null, "Meeting Notes", currentUserId]);
        return itemRow({ name: "Meeting Notes" });
      }
    ]
  });
  const { service } = createSubject(database);

  const folder = await service.createFolder(currentUserId, workspaceId, {
    parentId: null,
    name: " Meeting Notes "
  });

  assert.equal(folder.name, "Meeting Notes");
  assert.equal(folder.createdByUser.id, currentUserId);
  assert.equal(folder.updatedByUser, null);
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      () => {
        throw { code: "23505" };
      }
    ]
  });
  const { service } = createSubject(database);

  await assertApiError(
    () => service.createFolder(currentUserId, workspaceId, { name: "Docs" }),
    400,
    "BAD_REQUEST",
    /already exists/
  );
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      itemRow(),
      (text, values) => {
        assert.match(text, /UPDATE drive_items/);
        assert.deepEqual(values, [workspaceId, folderId, "Renamed Docs", currentUserId]);
        return itemRow({
          name: "Renamed Docs",
          updated_by_user_id: currentUserId,
          updated_by_user_name: "PILO User"
        });
      }
    ]
  });
  const { service } = createSubject(database);

  const item = await service.updateItem(currentUserId, workspaceId, folderId, {
    name: " Renamed Docs "
  });

  assert.equal(item.name, "Renamed Docs");
  assert.equal(item.updatedByUser?.id, currentUserId);
}

{
  const database = new FakeDatabase();
  const { service } = createSubject(database);

  await assertApiError(
    () => service.updateItem(currentUserId, workspaceId, folderId, { name: "../x" }),
    400,
    "BAD_REQUEST",
    /path separators/
  );
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      itemRow(),
      (text, values) => {
        assert.match(text, /WITH RECURSIVE target_tree/);
        assert.match(text, /deleted_at = now\(\)/);
        assert.deepEqual(values, [workspaceId, folderId, currentUserId]);
        return { deleted_item_count: "3" };
      }
    ]
  });
  const { service } = createSubject(database);

  const result = await service.deleteItem(currentUserId, workspaceId, folderId);

  assert.deepEqual(result, {
    id: folderId,
    deleted: true,
    deletedItemCount: 3
  });
}
