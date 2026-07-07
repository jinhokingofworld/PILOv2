import { Injectable } from "@nestjs/common";
import { badRequest, notFound } from "../../common/api-error";
import { DatabaseService } from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { mapDriveItem } from "./drive.mapper";
import {
  CreateDriveFolderRequest,
  DriveDeleteCountRow,
  DriveDeletePayload,
  DriveItemPayload,
  DriveItemRow,
  DriveListPayload,
  UpdateDriveItemRequest
} from "./drive.types";
import {
  validateCreateDriveFolderRequest,
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

@Injectable()
export class DriveService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService
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
            OR (
              drive_items.item_type = 'file'
              AND drive_items.upload_status = 'ready'
            )
          )
        ORDER BY
          CASE drive_items.item_type WHEN 'folder' THEN 0 ELSE 1 END,
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
}
