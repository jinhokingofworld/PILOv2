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
const driveStorageService = await readSource(
  "../../src/modules/drive/drive-storage.service.ts"
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
const uploadId = "66666666-6666-4666-8666-666666666666";
const createdAt = new Date("2026-07-07T08:00:00.000Z");
const updatedAt = new Date("2026-07-07T08:05:00.000Z");
const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

assert.match(appModule, /DriveModule/);
assert.match(driveModule, /controllers: \[DriveController\]/);
assert.match(driveModule, /providers: \[DocumentService, DriveService, DriveStorageService\]/);
assert.match(driveModule, /DocumentService/);
assert.match(driveModule, /WorkspaceModule/);
assert.match(driveController, /@Controller\("workspaces\/:workspaceId\/drive"\)/);
assert.match(driveController, /@UseGuards\(AuthGuard\)/);
assert.match(driveController, /@Get\("items"\)/);
assert.match(driveController, /@Post\("folders"\)/);
assert.match(driveController, /@Post\("documents"\)/);
assert.match(driveController, /@Post\("files\/upload-url"\)/);
assert.match(driveController, /@Post\("files\/:fileId\/complete"\)/);
assert.match(driveController, /@Get\("files\/:fileId\/download-url"\)/);
assert.match(driveController, /@Patch\("items\/:itemId"\)/);
assert.match(driveController, /@Delete\("items\/:itemId"\)/);
assert.match(driveServiceSource, /domain: "drive"/);
assert.match(driveServiceSource, /apiContract: "docs\/api\/drive-api.md"/);
assert.match(driveServiceSource, /assertWorkspaceAccess/);
assert.match(driveServiceSource, /FROM drive_items/);
assert.match(driveServiceSource, /INSERT INTO drive_items/);
assert.match(driveServiceSource, /INSERT INTO drive_uploads/);
assert.match(driveServiceSource, /createUploadUrl/);
assert.match(driveServiceSource, /completeUpload/);
assert.match(driveServiceSource, /createDownloadUrl/);
assert.match(driveServiceSource, /drive_items\.item_type = 'document'/);
assert.match(driveServiceSource, /drive\/workspaces\/\$\{workspaceId\}\/items/);
assert.match(driveServiceSource, /WITH RECURSIVE target_tree/);
assert.match(driveServiceSource, /deleted_at = now\(\)/);
assert.match(driveStorageService, /S3Client/);
assert.match(driveStorageService, /PutObjectCommand/);
assert.match(driveStorageService, /GetObjectCommand/);
assert.match(driveStorageService, /HeadObjectCommand/);
assert.match(driveStorageService, /getSignedUrl/);
assert.match(driveStorageService, /S3_UPLOADS_BUCKET/);
assert.match(driveStorageService, /AWS_REGION/);
assert.match(driveStorageService, /BAD_GATEWAY/);
assert.match(driveStorageService, /async createPreviewUrl\(/);
assert.match(driveStorageService, /ResponseContentDisposition: this\.inlineContentDisposition/);
assert.match(driveValidation, /validateCreateDriveFolderRequest/);
assert.match(driveValidation, /validateCreateDriveUploadUrlRequest/);
assert.match(driveValidation, /validateCompleteDriveUploadRequest/);
assert.match(driveValidation, /validateUpdateDriveItemRequest/);
assert.match(driveValidation, /validateListDriveItemsQuery/);
assert.match(driveValidation, /path separators/);
assert.match(driveMapper, /mapDriveItem/);
assert.match(packageJson, /@aws-sdk\/client-s3/);
assert.match(packageJson, /@aws-sdk\/s3-request-presigner/);

class FakeDatabase {
  constructor({ queryRows = [], queryOneRows = [] } = {}) {
    this.queryRows = [...queryRows];
    this.queryOneRows = [...queryOneRows];
    this.queries = [];
    this.queryOneCalls = [];
    this.executeCalls = [];
    this.transactions = 0;
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

  async execute(text, values = []) {
    this.executeCalls.push({ text, values });
    return { rows: [] };
  }

  async transaction(callback) {
    this.transactions += 1;
    return callback(this);
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

class FakeDriveStorageService {
  constructor({ objectSizeBytes = 1024 } = {}) {
    this.objectSizeBytes = objectSizeBytes;
    this.uploadUrlCalls = [];
    this.downloadUrlCalls = [];
    this.previewUrlCalls = [];
    this.headCalls = [];
  }

  async createUploadUrl(input) {
    this.uploadUrlCalls.push(input);
    return "https://s3.example/upload";
  }

  async createDownloadUrl(input) {
    this.downloadUrlCalls.push(input);
    return "https://s3.example/download";
  }

  async createPreviewUrl(input) {
    this.previewUrlCalls.push(input);
    return "https://s3.example/preview";
  }

  async getObjectSizeBytes(objectKey) {
    this.headCalls.push(objectKey);
    return this.objectSizeBytes;
  }
}

function createSubject(
  database = new FakeDatabase(),
  driveStorageService = new FakeDriveStorageService()
) {
  const workspaceService = new FakeWorkspaceService();
  const service = new DriveService(database, workspaceService, driveStorageService);
  return {
    database,
    service,
    driveStorageService,
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

function uploadRow(overrides = {}) {
  return {
    id: uploadId,
    workspace_id: workspaceId,
    drive_item_id: fileId,
    object_key: "drive/workspaces/workspace/items/file/PILO.pdf",
    status: "pending",
    expected_size_bytes: "1024",
    expected_mime_type: "application/pdf",
    expires_at: expiresAt,
    completed_at: null,
    created_by_user_id: currentUserId,
    created_at: createdAt,
    updated_at: updatedAt,
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
  const pendingFile = itemRow({
    id: fileId,
    item_type: "file",
    name: "PILO.pdf",
    object_key: "drive/workspaces/workspace/items/file/PILO.pdf",
    mime_type: "application/pdf",
    size_bytes: "1024",
    upload_status: "pending"
  });
  const upload = uploadRow();
  const database = new FakeDatabase({
    queryOneRows: [
      (text, values) => {
        assert.match(text, /INSERT INTO drive_items/);
        assert.match(text, /upload_status/);
        assert.equal(values[1], workspaceId);
        assert.equal(values[2], null);
        assert.equal(values[3], "PILO.pdf");
        assert.match(values[4], /^drive\/workspaces\//);
        assert.equal(values[5], "application/pdf");
        assert.equal(values[6], 1024);
        assert.equal(values[7], currentUserId);
        return pendingFile;
      },
      (text, values) => {
        assert.match(text, /INSERT INTO drive_uploads/);
        assert.equal(values[1], workspaceId);
        assert.equal(values[4], 1024);
        assert.equal(values[5], "application/pdf");
        return upload;
      }
    ]
  });
  const storage = new FakeDriveStorageService();
  const { service, driveStorageService } = createSubject(database, storage);

  const result = await service.createUploadUrl(currentUserId, workspaceId, {
    parentId: null,
    name: " PILO.pdf ",
    sizeBytes: 1024,
    mimeType: " application/pdf "
  });

  assert.equal(result.file.id, fileId);
  assert.equal(result.file.uploadStatus, "pending");
  assert.equal(result.upload.id, uploadId);
  assert.equal(result.upload.method, "PUT");
  assert.equal(result.upload.uploadUrl, "https://s3.example/upload");
  assert.equal(result.upload.headers["Content-Type"], "application/pdf");
  assert.equal(driveStorageService.uploadUrlCalls.length, 1);
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
  const pendingFile = itemRow({
    id: fileId,
    item_type: "file",
    name: "PILO.pdf",
    object_key: "drive/workspaces/workspace/items/file/PILO.pdf",
    mime_type: "application/pdf",
    size_bytes: "1024",
    upload_status: "pending"
  });
  const completedFile = itemRow({
    ...pendingFile,
    upload_status: "ready",
    updated_by_user_id: currentUserId,
    updated_by_user_name: "PILO User"
  });
  const database = new FakeDatabase({
    queryOneRows: [
      pendingFile,
      uploadRow(),
      (text, values) => {
        assert.match(text, /UPDATE drive_items/);
        assert.match(text, /upload_status = 'ready'/);
        assert.deepEqual(values, [workspaceId, fileId, currentUserId]);
        return completedFile;
      }
    ]
  });
  const storage = new FakeDriveStorageService({ objectSizeBytes: 1024 });
  const { service, driveStorageService } = createSubject(database, storage);

  const file = await service.completeUpload(currentUserId, workspaceId, fileId, {
    uploadId
  });

  assert.equal(file.uploadStatus, "ready");
  assert.equal(driveStorageService.headCalls[0], uploadRow().object_key);
  assert.equal(database.executeCalls.length, 1);
  assert.match(database.executeCalls[0].text, /status = 'completed'/);
}

{
  const pendingFile = itemRow({
    id: fileId,
    item_type: "file",
    name: "PILO.pdf",
    object_key: "drive/workspaces/workspace/items/file/PILO.pdf",
    mime_type: "application/pdf",
    size_bytes: "1024",
    upload_status: "pending"
  });
  const database = new FakeDatabase({
    queryOneRows: [pendingFile, uploadRow()]
  });
  const storage = new FakeDriveStorageService({ objectSizeBytes: null });
  const { service } = createSubject(database, storage);

  await assertApiError(
    () => service.completeUpload(currentUserId, workspaceId, fileId, { uploadId }),
    400,
    "BAD_REQUEST",
    /object was not found/
  );
}

{
  const pendingFile = itemRow({
    id: fileId,
    item_type: "file",
    name: "PILO.pdf",
    object_key: "drive/workspaces/workspace/items/file/PILO.pdf",
    mime_type: "application/pdf",
    size_bytes: "1024",
    upload_status: "pending"
  });
  const database = new FakeDatabase({
    queryOneRows: [
      pendingFile,
      uploadRow({ expires_at: new Date("2020-01-01T00:00:00.000Z") })
    ]
  });
  const { service } = createSubject(database);

  await assertApiError(
    () => service.completeUpload(currentUserId, workspaceId, fileId, { uploadId }),
    400,
    "BAD_REQUEST",
    /expired/
  );
  assert.equal(database.executeCalls.length, 2);
  assert.match(database.executeCalls[0].text, /status = 'expired'/);
  assert.match(database.executeCalls[1].text, /upload_status = 'failed'/);
}

{
  const readyFile = itemRow({
    id: fileId,
    item_type: "file",
    name: "PILO.pdf",
    object_key: "drive/workspaces/workspace/items/file/PILO.pdf",
    mime_type: "application/pdf",
    size_bytes: "1024",
    upload_status: "ready"
  });
  const database = new FakeDatabase({ queryOneRows: [readyFile] });
  const storage = new FakeDriveStorageService();
  const { service, driveStorageService } = createSubject(database, storage);

  const result = await service.createDownloadUrl(currentUserId, workspaceId, fileId);

  assert.equal(result.file.id, fileId);
  assert.equal(result.downloadUrl, "https://s3.example/download");
  assert.equal(driveStorageService.downloadUrlCalls[0].fileName, "PILO.pdf");
}

{
  const readyPdf = itemRow({
    id: fileId,
    item_type: "file",
    name: "PILO.pdf",
    object_key: "drive/workspaces/workspace/items/file/PILO.pdf",
    mime_type: "application/pdf",
    size_bytes: "1024",
    upload_status: "ready"
  });
  const database = new FakeDatabase({ queryOneRows: [readyPdf] });
  const storage = new FakeDriveStorageService();
  const { service, driveStorageService } = createSubject(database, storage);

  assert.equal(typeof service.createPreviewUrl, "function");
  const result = await service.createPreviewUrl(currentUserId, workspaceId, fileId);

  assert.equal(result.file.id, fileId);
  assert.equal(result.previewUrl, "https://s3.example/preview");
  assert.equal(driveStorageService.previewUrlCalls[0].fileName, "PILO.pdf");
  assert.equal(driveStorageService.previewUrlCalls[0].mimeType, "application/pdf");
}

{
  const readyImage = itemRow({
    id: fileId,
    item_type: "file",
    name: "PILO.png",
    object_key: "drive/workspaces/workspace/items/file/PILO.png",
    mime_type: "image/png",
    size_bytes: "1024",
    upload_status: "ready"
  });
  const database = new FakeDatabase({ queryOneRows: [readyImage] });
  const storage = new FakeDriveStorageService();
  const { service, driveStorageService } = createSubject(database, storage);

  await assertApiError(
    () => service.createPreviewUrl(currentUserId, workspaceId, fileId),
    404,
    "NOT_FOUND",
    /PDF file not found/
  );
  assert.equal(driveStorageService.previewUrlCalls.length, 0);
}

{
  const mixedCasePdf = itemRow({
    id: fileId,
    item_type: "file",
    name: "PILO.pdf",
    object_key: "drive/workspaces/workspace/items/file/PILO.pdf",
    mime_type: "Application/PDF",
    size_bytes: "1024",
    upload_status: "ready"
  });
  const database = new FakeDatabase({ queryOneRows: [mixedCasePdf] });
  const storage = new FakeDriveStorageService();
  const { service, driveStorageService } = createSubject(database, storage);

  await assertApiError(
    () => service.createPreviewUrl(currentUserId, workspaceId, fileId),
    404,
    "NOT_FOUND",
    /PDF file not found/
  );
  assert.equal(driveStorageService.previewUrlCalls.length, 0);
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
