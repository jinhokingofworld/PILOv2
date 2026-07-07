import { DriveItemPayload, DriveItemRow } from "./drive.types";

export function mapDriveItem(row: DriveItemRow): DriveItemPayload {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    parentId: row.parent_id,
    itemType: row.item_type,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    uploadStatus: row.upload_status,
    createdByUser: {
      id: row.created_by_user_id,
      name: row.created_by_user_name,
      avatarUrl: row.created_by_user_avatar_url
    },
    updatedByUser:
      row.updated_by_user_id === null
        ? null
        : {
            id: row.updated_by_user_id,
            name: row.updated_by_user_name,
            avatarUrl: row.updated_by_user_avatar_url
          },
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    deletedAt: row.deleted_at === null ? null : toIsoString(row.deleted_at)
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
