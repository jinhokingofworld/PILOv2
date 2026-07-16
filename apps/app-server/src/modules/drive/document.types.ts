import type { QueryResultRow } from "pg";

import type { DriveItemPayload } from "./drive.types";

export type CreateDocumentRequest = Record<string, unknown>;
export type SaveDocumentSnapshotRequest = Record<string, unknown>;

export type DocumentJson = Record<string, unknown>;

export interface NormalizedCreateDocumentInput {
  name: string;
  parentId: string | null;
}

export interface DocumentRow extends QueryResultRow {
  id: string;
  drive_item_id: string;
  workspace_id: string;
  current_version: string | number;
  latest_snapshot_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

export interface DocumentSnapshotRow extends QueryResultRow {
  id: string;
  document_id: string;
  workspace_id: string;
  version: string | number;
  yjs_state: Buffer;
  content_json: DocumentJson;
  plain_text: string;
  source_update_sequence: string | number;
  created_at: Date | string;
}

export interface DocumentBootstrapRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  item_type: "document";
  name: string;
  object_key: null;
  mime_type: null;
  size_bytes: null;
  upload_status: null;
  created_by_user_id: string;
  updated_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
  created_by_user_name: string | null;
  created_by_user_avatar_url: string | null;
  updated_by_user_name: string | null;
  updated_by_user_avatar_url: string | null;
  document_id: string;
  document_current_version: string | number;
  document_latest_snapshot_id: string | null;
  document_created_at: Date | string;
  document_updated_at: Date | string;
  document_deleted_at: Date | string | null;
  snapshot_id: string;
  snapshot_version: string | number;
  snapshot_yjs_state: Buffer;
  snapshot_content_json: DocumentJson;
  snapshot_plain_text: string;
  snapshot_source_update_sequence: string | number;
  snapshot_created_at: Date | string;
}

export interface LockedDocumentRow extends DocumentRow {
  name: string;
  current_snapshot_content_json: DocumentJson | null;
}

export interface DocumentPayload {
  id: string;
  driveItemId: string;
  workspaceId: string;
  currentVersion: number;
  latestSnapshotId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CreateDocumentPayload {
  item: DriveItemPayload;
  document: DocumentPayload;
}

export interface DocumentSnapshotPayload {
  id: string;
  version: number;
  yjsState: string;
  contentJson: DocumentJson;
  plainText: string;
  sourceUpdateSequence: number;
  createdAt: string;
}

export interface DocumentBootstrapPayload extends CreateDocumentPayload {
  snapshot: DocumentSnapshotPayload;
}

export interface SaveDocumentSnapshotPayload {
  document: DocumentPayload;
  snapshot: DocumentSnapshotPayload;
}

export interface NormalizedSaveDocumentSnapshotInput {
  expectedVersion: number;
  yjsState: Buffer;
  contentJson: DocumentJson;
  plainText: string;
  attachmentFileIds: string[];
}
