import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { badRequest, notFound } from "../../common/api-error";
import {
  DatabaseService,
  DatabaseTransaction
} from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { mapDriveItem } from "./drive.mapper";
import { DriveStorageService } from "./drive-storage.service";
import {
  CompleteDriveUploadRequest,
  CreateDriveFolderRequest,
  CreateDriveUploadUrlRequest,
  DriveDeleteCountRow,
  DriveDeletePayload,
  DriveDownloadUrlPayload,
  DriveItemPayload,
  DriveItemRow,
  DriveListPayload,
  DriveUploadRow,
  DriveUploadUrlPayload,
  UpdateDriveItemRequest
} from "./drive.types";
import {
  DRIVE_FILE_SIZE_LIMIT_BYTES,
  validateCompleteDriveUploadRequest,
  validateCreateDriveFolderRequest,
  validateCreateDriveUploadUrlRequest,
  validateDriveItemId,
  validateListDriveItemsQuery,
  validateUpdateDriveItemRequest
} from "./drive.validation";

const DRIVE_ITEM_SELECT = `
  SELECT
    drive_items.id,
    drive_items.workspace_id,
    drive_items.parent_id,
    drive_items.item_type,
    drive_items.name,
    drive_items.object_key,
    drive_items.mime_type,
    drive_items.size_bytes,
    drive_items.upload_status,
    drive_items.created_by_user_id,
    drive_items.updated_by_user_id,
    drive_items.created_at,
    drive_items.updated_at,
    drive_items.deleted_at,
    created_by_user.name AS created_by_user_name,
    created_by_user.avatar_url AS created_by_user_avatar_url,
    updated_by_user.name AS updated_by_user_name,
    updated_by_user.avatar_url AS updated_by_user_avatar_url
  FROM drive_items
  JOIN users created_by_user
    ON created_by_user.id = drive_items.created_by_user_id
  LEFT JOIN users updated_by_user
    ON updated_by_user.id = drive_items.updated_by_user_id
`;
const UNIQUE_VIOLATION_CODE = "23505";
const DRIVE_UPLOAD_EXPIRES_SECONDS = 10 * 60;

@Injectable()
export class DriveService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly driveStorageService: DriveStorageService
  ) {}

  getModuleInfo() {
    return {
      domain: "drive",
      apiContract: "docs/api/drive-api.md"
    };
  }

  async listItems(
    currentUserId: string,
    workspaceId: string,
    parentIdQuery: unknown
  ): Promise<DriveListPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const { parentId } = validateListDriveItemsQuery(parentIdQuery);
    const parent =
      parentId === null
        ? null
        : await this.findActiveFolder(workspaceId, parentId, "Drive folder not found");

    const [breadcrumbs, items] = await Promise.all([
      parentId === null ? Promise.resolve([]) : this.listBreadcrumbs(workspaceId, parentId),
      this.listChildren(workspaceId, parentId)
    ]);

    return {
      parent: parent === null ? null : mapDriveItem(parent),
      breadcrumbs: breadcrumbs.map((item) => mapDriveItem(item)),
      items: items.map((item) => mapDriveItem(item))
    };
  }

  async createFolder(
    currentUserId: string,
    workspaceId: string,
    body: CreateDriveFolderRequest
  ): Promise<DriveItemPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = validateCreateDriveFolderRequest(body);
    if (input.parentId !== null) {
      await this.findActiveFolder(workspaceId, input.parentId, "Drive folder not found");
    }

    try {
      const folder = await this.database.queryOne<DriveItemRow>(
        `
          WITH inserted AS (
            INSERT INTO drive_items (
              workspace_id,
              parent_id,
              item_type,
              name,
              created_by_user_id
            )
            VALUES ($1, $2, 'folder', $3, $4)
            RETURNING *
          )
          ${this.selectInsertedDriveItem("inserted")}
        `,
        [workspaceId, input.parentId, input.name, currentUserId]
      );

      if (!folder) {
        throw badRequest("Drive folder could not be created");
      }

      return mapDriveItem(folder);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw badRequest("Drive item name already exists in this folder");
      }

      throw error;
    }
  }

  async createUploadUrl(
    currentUserId: string,
    workspaceId: string,
    body: CreateDriveUploadUrlRequest
  ): Promise<DriveUploadUrlPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = validateCreateDriveUploadUrlRequest(body);
    if (input.parentId !== null) {
      await this.findActiveFolder(workspaceId, input.parentId, "Drive folder not found");
    }

    const fileId = randomUUID();
    const uploadId = randomUUID();
    const objectKey = this.buildObjectKey(workspaceId, fileId, input.name);
    const uploadUrl = await this.driveStorageService.createUploadUrl({
      objectKey,
      mimeType: input.mimeType,
      expiresInSeconds: DRIVE_UPLOAD_EXPIRES_SECONDS
    });

    try {
      const result = await this.database.transaction(async (transaction) => {
        const file = await transaction.queryOne<DriveItemRow>(
          `
            WITH inserted AS (
              INSERT INTO drive_items (
                id,
                workspace_id,
                parent_id,
                item_type,
                name,
                object_key,
                mime_type,
                size_bytes,
                upload_status,
                created_by_user_id
              )
              VALUES ($1, $2, $3, 'file', $4, $5, $6, $7, 'pending', $8)
              RETURNING *
            )
            ${this.selectInsertedDriveItem("inserted")}
          `,
          [
            fileId,
            workspaceId,
            input.parentId,
            input.name,
            objectKey,
            input.mimeType,
            input.sizeBytes,
            currentUserId
          ]
        );

        if (!file) {
          throw badRequest("Drive file could not be created");
        }

        const upload = await transaction.queryOne<DriveUploadRow>(
          `
            INSERT INTO drive_uploads (
              id,
              workspace_id,
              drive_item_id,
              object_key,
              status,
              expected_size_bytes,
              expected_mime_type,
              expires_at,
              created_by_user_id
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              'pending',
              $5,
              $6,
              now() + ($7::int * interval '1 second'),
              $8
            )
            RETURNING
              id,
              workspace_id,
              drive_item_id,
              object_key,
              status,
              expected_size_bytes,
              expected_mime_type,
              expires_at,
              completed_at,
              created_by_user_id,
              created_at,
              updated_at
          `,
          [
            uploadId,
            workspaceId,
            fileId,
            objectKey,
            input.sizeBytes,
            input.mimeType,
            DRIVE_UPLOAD_EXPIRES_SECONDS,
            currentUserId
          ]
        );

        if (!upload) {
          throw badRequest("Drive upload could not be created");
        }

        return { file, upload };
      });

      return {
        file: mapDriveItem(result.file),
        upload: {
          id: result.upload.id,
          fileId: result.upload.drive_item_id,
          status: result.upload.status,
          method: "PUT",
          uploadUrl,
          headers: {
            "Content-Type": result.upload.expected_mime_type
          },
          expiresAt: this.toIsoString(result.upload.expires_at)
        }
      };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw badRequest("Drive item name already exists in this folder");
      }

      throw error;
    }
  }

  async completeUpload(
    currentUserId: string,
    workspaceId: string,
    fileId: string,
    body: CompleteDriveUploadRequest
  ): Promise<DriveItemPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const validFileId = validateDriveItemId(fileId);
    const input = validateCompleteDriveUploadRequest(body);
    const file = await this.findActivePendingFile(workspaceId, validFileId);
    if (!file) {
      throw notFound("Drive file upload not found");
    }

    const upload = await this.findPendingUpload(
      workspaceId,
      validFileId,
      input.uploadId
    );
    if (!upload) {
      throw notFound("Drive upload not found");
    }

    if (this.isExpired(upload.expires_at)) {
      await this.expireUpload(workspaceId, validFileId, input.uploadId, currentUserId);
      throw badRequest("Drive upload has expired");
    }

    const objectSizeBytes = await this.driveStorageService.getObjectSizeBytes(
      upload.object_key
    );
    if (objectSizeBytes === null) {
      throw badRequest("Drive uploaded object was not found");
    }

    const expectedSizeBytes = Number(upload.expected_size_bytes);
    if (
      objectSizeBytes !== expectedSizeBytes ||
      objectSizeBytes > DRIVE_FILE_SIZE_LIMIT_BYTES
    ) {
      throw badRequest("Drive uploaded object size is invalid");
    }

    const completed = await this.database.transaction((transaction) =>
      this.markUploadCompleted(
        transaction,
        workspaceId,
        validFileId,
        input.uploadId,
        currentUserId
      )
    );

    if (!completed) {
      throw notFound("Drive upload not found");
    }

    return mapDriveItem(completed);
  }

  async createDownloadUrl(
    currentUserId: string,
    workspaceId: string,
    fileId: string
  ): Promise<DriveDownloadUrlPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const validFileId = validateDriveItemId(fileId);
    const file = await this.findActiveReadyFile(workspaceId, validFileId);
    if (!file || !file.object_key || !file.mime_type) {
      throw notFound("Drive file not found");
    }

    const downloadUrl = await this.driveStorageService.createDownloadUrl({
      objectKey: file.object_key,
      fileName: file.name,
      mimeType: file.mime_type,
      expiresInSeconds: DRIVE_UPLOAD_EXPIRES_SECONDS
    });

    return {
      file: mapDriveItem(file),
      downloadUrl,
      expiresAt: this.toIsoString(
        new Date(Date.now() + DRIVE_UPLOAD_EXPIRES_SECONDS * 1000)
      )
    };
  }

  async updateItem(
    currentUserId: string,
    workspaceId: string,
    itemId: string,
    body: UpdateDriveItemRequest
  ): Promise<DriveItemPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const validItemId = validateDriveItemId(itemId);
    const input = validateUpdateDriveItemRequest(body);
    const existing = await this.findActiveItem(workspaceId, validItemId);
    if (!existing) {
      throw notFound("Drive item not found");
    }

    try {
      const item = await this.database.queryOne<DriveItemRow>(
        `
          WITH updated AS (
            UPDATE drive_items
            SET
              name = $3,
              updated_by_user_id = $4
            WHERE workspace_id = $1
              AND id = $2
              AND deleted_at IS NULL
            RETURNING *
          )
          ${this.selectInsertedDriveItem("updated")}
        `,
        [workspaceId, validItemId, input.name, currentUserId]
      );

      if (!item) {
        throw notFound("Drive item not found");
      }

      return mapDriveItem(item);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw badRequest("Drive item name already exists in this folder");
      }

      throw error;
    }
  }

  async deleteItem(
    currentUserId: string,
    workspaceId: string,
    itemId: string
  ): Promise<DriveDeletePayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const validItemId = validateDriveItemId(itemId);
    const existing = await this.findActiveItem(workspaceId, validItemId);
    if (!existing) {
      throw notFound("Drive item not found");
    }

    const result = await this.database.queryOne<DriveDeleteCountRow>(
      `
        WITH RECURSIVE target_tree AS (
          SELECT id
          FROM drive_items
          WHERE workspace_id = $1
            AND id = $2
            AND deleted_at IS NULL

          UNION ALL

          SELECT child.id
          FROM drive_items child
          JOIN target_tree parent
            ON parent.id = child.parent_id
          WHERE child.workspace_id = $1
            AND child.deleted_at IS NULL
        ),
        updated AS (
          UPDATE drive_items
          SET
            deleted_at = now(),
            updated_by_user_id = $3
          WHERE workspace_id = $1
            AND id IN (SELECT id FROM target_tree)
            AND deleted_at IS NULL
          RETURNING id
        )
        SELECT COUNT(*)::text AS deleted_item_count
        FROM updated
      `,
      [workspaceId, validItemId, currentUserId]
    );

    return {
      id: validItemId,
      deleted: true,
      deletedItemCount: Number(result?.deleted_item_count ?? 0)
    };
  }

  private listChildren(
    workspaceId: string,
    parentId: string | null
  ): Promise<DriveItemRow[]> {
    return this.database.query<DriveItemRow>(
      `
        ${DRIVE_ITEM_SELECT}
        WHERE drive_items.workspace_id = $1
          AND (
            ($2::uuid IS NULL AND drive_items.parent_id IS NULL)
            OR drive_items.parent_id = $2::uuid
          )
          AND drive_items.deleted_at IS NULL
          AND (
            drive_items.item_type = 'folder'
            OR drive_items.item_type = 'document'
            OR (
              drive_items.item_type = 'file'
              AND drive_items.upload_status = 'ready'
            )
          )
        ORDER BY
          CASE drive_items.item_type
            WHEN 'folder' THEN 0
            WHEN 'document' THEN 1
            ELSE 2
          END,
          drive_items.updated_at DESC,
          lower(drive_items.name) ASC,
          drive_items.id ASC
      `,
      [workspaceId, parentId]
    );
  }

  private listBreadcrumbs(
    workspaceId: string,
    parentId: string
  ): Promise<DriveItemRow[]> {
    return this.database.query<DriveItemRow>(
      `
        WITH RECURSIVE ancestors AS (
          SELECT
            drive_items.*,
            0 AS depth
          FROM drive_items
          WHERE drive_items.workspace_id = $1
            AND drive_items.id = $2
            AND drive_items.deleted_at IS NULL

          UNION ALL

          SELECT
            parent.*,
            ancestors.depth + 1 AS depth
          FROM drive_items parent
          JOIN ancestors
            ON ancestors.parent_id = parent.id
          WHERE parent.workspace_id = $1
            AND parent.deleted_at IS NULL
        )
        SELECT
          ancestors.id,
          ancestors.workspace_id,
          ancestors.parent_id,
          ancestors.item_type,
          ancestors.name,
          ancestors.object_key,
          ancestors.mime_type,
          ancestors.size_bytes,
          ancestors.upload_status,
          ancestors.created_by_user_id,
          ancestors.updated_by_user_id,
          ancestors.created_at,
          ancestors.updated_at,
          ancestors.deleted_at,
          created_by_user.name AS created_by_user_name,
          created_by_user.avatar_url AS created_by_user_avatar_url,
          updated_by_user.name AS updated_by_user_name,
          updated_by_user.avatar_url AS updated_by_user_avatar_url
        FROM ancestors
        JOIN users created_by_user
          ON created_by_user.id = ancestors.created_by_user_id
        LEFT JOIN users updated_by_user
          ON updated_by_user.id = ancestors.updated_by_user_id
        ORDER BY ancestors.depth DESC
      `,
      [workspaceId, parentId]
    );
  }

  private async findActiveFolder(
    workspaceId: string,
    folderId: string,
    message: string
  ): Promise<DriveItemRow> {
    const folder = await this.database.queryOne<DriveItemRow>(
      `
        ${DRIVE_ITEM_SELECT}
        WHERE drive_items.workspace_id = $1
          AND drive_items.id = $2
          AND drive_items.item_type = 'folder'
          AND drive_items.deleted_at IS NULL
      `,
      [workspaceId, folderId]
    );

    if (!folder) {
      throw notFound(message);
    }

    return folder;
  }

  private findActiveItem(
    workspaceId: string,
    itemId: string
  ): Promise<DriveItemRow | null> {
    return this.database.queryOne<DriveItemRow>(
      `
        ${DRIVE_ITEM_SELECT}
        WHERE drive_items.workspace_id = $1
          AND drive_items.id = $2
          AND drive_items.deleted_at IS NULL
      `,
      [workspaceId, itemId]
    );
  }

  private findActivePendingFile(
    workspaceId: string,
    fileId: string
  ): Promise<DriveItemRow | null> {
    return this.database.queryOne<DriveItemRow>(
      `
        ${DRIVE_ITEM_SELECT}
        WHERE drive_items.workspace_id = $1
          AND drive_items.id = $2
          AND drive_items.item_type = 'file'
          AND drive_items.upload_status = 'pending'
          AND drive_items.deleted_at IS NULL
      `,
      [workspaceId, fileId]
    );
  }

  private findActiveReadyFile(
    workspaceId: string,
    fileId: string
  ): Promise<DriveItemRow | null> {
    return this.database.queryOne<DriveItemRow>(
      `
        ${DRIVE_ITEM_SELECT}
        WHERE drive_items.workspace_id = $1
          AND drive_items.id = $2
          AND drive_items.item_type = 'file'
          AND drive_items.upload_status = 'ready'
          AND drive_items.deleted_at IS NULL
      `,
      [workspaceId, fileId]
    );
  }

  private findPendingUpload(
    workspaceId: string,
    fileId: string,
    uploadId: string
  ): Promise<DriveUploadRow | null> {
    return this.database.queryOne<DriveUploadRow>(
      `
        SELECT
          id,
          workspace_id,
          drive_item_id,
          object_key,
          status,
          expected_size_bytes,
          expected_mime_type,
          expires_at,
          completed_at,
          created_by_user_id,
          created_at,
          updated_at
        FROM drive_uploads
        WHERE workspace_id = $1
          AND drive_item_id = $2
          AND id = $3
          AND status = 'pending'
      `,
      [workspaceId, fileId, uploadId]
    );
  }

  private async expireUpload(
    workspaceId: string,
    fileId: string,
    uploadId: string,
    currentUserId: string
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        `
          UPDATE drive_uploads
          SET status = 'expired'
          WHERE workspace_id = $1
            AND drive_item_id = $2
            AND id = $3
            AND status = 'pending'
        `,
        [workspaceId, fileId, uploadId]
      );

      await transaction.execute(
        `
          UPDATE drive_items
          SET
            upload_status = 'failed',
            deleted_at = now(),
            updated_by_user_id = $3
          WHERE workspace_id = $1
            AND id = $2
            AND item_type = 'file'
            AND upload_status = 'pending'
            AND deleted_at IS NULL
        `,
        [workspaceId, fileId, currentUserId]
      );
    });
  }

  private async markUploadCompleted(
    transaction: DatabaseTransaction,
    workspaceId: string,
    fileId: string,
    uploadId: string,
    currentUserId: string
  ): Promise<DriveItemRow | null> {
    await transaction.execute(
      `
        UPDATE drive_uploads
        SET
          status = 'completed',
          completed_at = now()
        WHERE workspace_id = $1
          AND drive_item_id = $2
          AND id = $3
          AND status = 'pending'
      `,
      [workspaceId, fileId, uploadId]
    );

    return transaction.queryOne<DriveItemRow>(
      `
        WITH updated AS (
          UPDATE drive_items
          SET
            upload_status = 'ready',
            updated_by_user_id = $3
          WHERE workspace_id = $1
            AND id = $2
            AND item_type = 'file'
            AND upload_status = 'pending'
            AND deleted_at IS NULL
          RETURNING *
        )
        ${this.selectInsertedDriveItem("updated")}
      `,
      [workspaceId, fileId, currentUserId]
    );
  }

  private selectInsertedDriveItem(alias: "inserted" | "updated"): string {
    return `
      SELECT
        ${alias}.id,
        ${alias}.workspace_id,
        ${alias}.parent_id,
        ${alias}.item_type,
        ${alias}.name,
        ${alias}.object_key,
        ${alias}.mime_type,
        ${alias}.size_bytes,
        ${alias}.upload_status,
        ${alias}.created_by_user_id,
        ${alias}.updated_by_user_id,
        ${alias}.created_at,
        ${alias}.updated_at,
        ${alias}.deleted_at,
        created_by_user.name AS created_by_user_name,
        created_by_user.avatar_url AS created_by_user_avatar_url,
        updated_by_user.name AS updated_by_user_name,
        updated_by_user.avatar_url AS updated_by_user_avatar_url
      FROM ${alias}
      JOIN users created_by_user
        ON created_by_user.id = ${alias}.created_by_user_id
      LEFT JOIN users updated_by_user
        ON updated_by_user.id = ${alias}.updated_by_user_id
    `;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === UNIQUE_VIOLATION_CODE
    );
  }

  private buildObjectKey(
    workspaceId: string,
    fileId: string,
    fileName: string
  ): string {
    return `drive/workspaces/${workspaceId}/items/${fileId}/${this.toSafeFileName(
      fileName
    )}`;
  }

  private toSafeFileName(fileName: string): string {
    const safeFileName = fileName
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f]/g, "_")
      .replace(/\s+/g, "_");

    return safeFileName || "file";
  }

  private isExpired(expiresAt: Date | string): boolean {
    return new Date(expiresAt).getTime() <= Date.now();
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
