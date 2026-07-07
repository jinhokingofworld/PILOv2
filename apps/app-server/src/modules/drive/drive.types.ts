import { QueryResultRow } from "pg";

export type DriveItemType = "folder" | "file";
export type DriveUploadStatus = "pending" | "ready" | "failed" | null;

export interface DriveUserPayload {
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface DriveItemPayload {
  id: string;
  workspaceId: string;
  parentId: string | null;
  itemType: DriveItemType;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadStatus: DriveUploadStatus;
  createdByUser: DriveUserPayload;
  updatedByUser: DriveUserPayload | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DriveListPayload {
  parent: DriveItemPayload | null;
  breadcrumbs: DriveItemPayload[];
  items: DriveItemPayload[];
}

export interface DriveDeletePayload {
  id: string;
  deleted: true;
  deletedItemCount: number;
}

export interface DriveItemRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  item_type: DriveItemType;
  name: string;
  object_key: string | null;
  mime_type: string | null;
  size_bytes: string | number | null;
  upload_status: DriveUploadStatus;
  created_by_user_id: string;
  updated_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
  created_by_user_name: string | null;
  created_by_user_avatar_url: string | null;
  updated_by_user_name: string | null;
  updated_by_user_avatar_url: string | null;
}

export interface DriveDeleteCountRow extends QueryResultRow {
  deleted_item_count: string | number;
}

export type CreateDriveFolderRequest = Record<string, unknown>;
export type UpdateDriveItemRequest = Record<string, unknown>;

export interface NormalizedDriveParentInput {
  parentId: string | null;
}

export interface NormalizedCreateDriveFolderInput
  extends NormalizedDriveParentInput {
  name: string;
}

export interface NormalizedUpdateDriveItemInput {
  name: string;
}
