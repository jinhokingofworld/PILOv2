import type { QueryResultRow } from "pg";

import type { DriveItemPayload } from "./drive.types";

export type CreateDocumentRequest = Record<string, unknown>;

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
  created_at: Date | string;
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
