import { QueryResultRow } from "pg";

export const SQL_ERD_REQUEST_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
export const SQL_ERD_SOURCE_PUBLISH_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

export type SqlErdSourceFormat = "sql";
export type SqlErdDialect = "auto" | "postgresql" | "mysql" | "sqlite";
export type SqlErdWriteProtocol = "snapshot" | "operations_v1";
export type SqlErdJsonObject = Record<string, unknown>;

export interface SqlErdLayoutPatchCollection {
  deleteIds?: string[];
  upsert?: SqlErdJsonObject[];
}

export interface SqlErdLayoutPatch {
  annotations?: Partial<
    Record<"frames" | "links" | "notes" | "strokes" | "texts", SqlErdLayoutPatchCollection>
  >;
  tableLayouts?: SqlErdLayoutPatchCollection;
  viewport?:
    | { action: "delete" }
    | {
        action: "set";
        value: { x: number; y: number; zoom: number };
      };
}

export interface NormalizedSqlErdOperationInput {
  baseRevision: number;
  clientOperationId: string;
  patch: SqlErdLayoutPatch;
  type: "layout_patch";
}

export interface NormalizedListSqlErdOperationsInput {
  afterSeq: number;
  limit: number;
}

export interface NormalizedSqlErdSourcePublishInput {
  baseRevision: number;
  clientOperationId: string;
  dialect: SqlErdDialect;
  leaseId: string;
  modelJson: SqlErdJsonObject;
  sourceFormat: SqlErdSourceFormat;
  sourceText: string;
}

export interface NormalizedSqlErdSourceSnapshotBatchInput {
  ids: string[];
}

export interface NormalizedSqlErdSourceLockInput {
  leaseId: string;
}

export interface NormalizedCreateSqlErdSessionInput {
  title: string;
  sourceFormat: SqlErdSourceFormat;
  dialect: SqlErdDialect;
  sourceText: string;
  modelJson: SqlErdJsonObject;
  layoutJson: SqlErdJsonObject;
  settingsJson: SqlErdJsonObject;
  tableCount: number;
  relationCount: number;
}

export interface NormalizedUpdateSqlErdSessionInput {
  baseRevision: number;
  title?: string;
  sourceFormat?: SqlErdSourceFormat;
  dialect?: SqlErdDialect;
  sourceText?: string;
  modelJson?: SqlErdJsonObject;
  layoutJson?: SqlErdJsonObject;
  settingsJson?: SqlErdJsonObject;
  tableCount?: number;
  relationCount?: number;
}

export interface UpdateSqlErdSessionMetadataRequest {
  baseRevision: number;
  title: string;
}

export interface NormalizedDeleteSqlErdSessionInput {
  baseRevision: number;
}

export interface SqlErdSessionCursor {
  updatedAt: string;
  id: string;
}

export interface NormalizedListSqlErdSessionsInput {
  limit: number;
  cursor: SqlErdSessionCursor | null;
}

export interface SqlErdSessionRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  title: string;
  source_format: SqlErdSourceFormat;
  dialect: SqlErdDialect;
  source_text: string;
  model_json: SqlErdJsonObject;
  layout_json: SqlErdJsonObject;
  settings_json: SqlErdJsonObject;
  table_count: number | string;
  relation_count: number | string;
  revision: number | string;
  write_protocol: SqlErdWriteProtocol;
  latest_op_seq: number | string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

export interface SqlErdSessionSummaryRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  title: string;
  source_format: SqlErdSourceFormat;
  dialect: SqlErdDialect;
  table_count: number | string;
  relation_count: number | string;
  revision: number | string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  cursor_updated_at: string;
}

export interface SqlErdSessionSummaryPayload {
  id: string;
  workspaceId: string;
  title: string;
  sourceFormat: SqlErdSourceFormat;
  dialect: SqlErdDialect;
  tableCount: number;
  relationCount: number;
  revision: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SqlErdSessionListPayload {
  items: SqlErdSessionSummaryPayload[];
  nextCursor: string | null;
}

export interface SqlErdSessionPayload {
  id: string;
  workspaceId: string;
  title: string;
  sourceFormat: SqlErdSourceFormat;
  dialect: SqlErdDialect;
  sourceText: string;
  modelJson: SqlErdJsonObject;
  layoutJson: SqlErdJsonObject;
  settingsJson: SqlErdJsonObject;
  tableCount: number;
  relationCount: number;
  revision: number;
  writeProtocol: SqlErdWriteProtocol;
  latestOpSeq: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SqlErdDeletedSessionPayload {
  id: string;
  deletedAt: string;
  revision: number;
}

export interface SqlErdOperationRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  session_id: string;
  actor_user_id: string;
  operation_type: "layout_patch" | "source_snapshot";
  op_seq: number | string;
  client_operation_id: string;
  base_revision: number | string;
  applied_on_revision: number | string;
  result_revision: number | string;
  payload: SqlErdJsonObject;
  request_fingerprint: string | null;
  source_snapshot_id: string | null;
  created_at: Date | string;
}

export interface SqlErdLayoutPatchOperationPayload {
  actorUserId: string;
  appliedOnRevision: number;
  baseRevision: number;
  clientOperationId: string;
  createdAt: string;
  id: string;
  opSeq: number;
  patch: SqlErdLayoutPatch;
  rebased: boolean;
  resultRevision: number;
  sessionId: string;
  type: "layout_patch";
  workspaceId: string;
}

export interface SqlErdSourceSnapshotOperationPayload {
  actorUserId: string;
  appliedOnRevision: number;
  baseRevision: number;
  clientOperationId: string;
  createdAt: string;
  id: string;
  opSeq: number;
  rebased: boolean;
  resultRevision: number;
  sessionId: string;
  sourceSnapshotId: string;
  type: "source_snapshot";
  workspaceId: string;
}

export type SqlErdOperationPayload =
  | SqlErdLayoutPatchOperationPayload
  | SqlErdSourceSnapshotOperationPayload;

export interface SqlErdOperationWritePayload {
  latestOpSeq: number;
  layoutJson: SqlErdJsonObject;
  operation: SqlErdOperationPayload;
  revision: number;
}

export interface SqlErdOperationListPayload {
  items: SqlErdOperationPayload[];
  latestOpSeq: number;
  nextAfterSeq: number | null;
}

export interface SqlErdSourceLockRow extends QueryResultRow {
  workspace_id: string;
  session_id: string;
  lease_id: string;
  actor_user_id: string;
  source_base_revision: number | string;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface SqlErdSourceLockPayload {
  expiresAt: string;
  leaseId: string;
  sourceBaseRevision: number;
}

export interface SqlErdSourceSnapshotRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  session_id: string;
  source_format: SqlErdSourceFormat;
  dialect: SqlErdDialect;
  source_text: string;
  model_json: SqlErdJsonObject;
  layout_json: SqlErdJsonObject;
  table_count: number | string;
  relation_count: number | string;
  base_revision: number | string;
  result_revision: number | string;
  created_by: string;
  created_at: Date | string;
}

export interface SqlErdSourceSnapshotPayload {
  baseRevision: number;
  createdAt: string;
  createdBy: string;
  dialect: SqlErdDialect;
  id: string;
  layoutJson: SqlErdJsonObject;
  modelJson: SqlErdJsonObject;
  relationCount: number;
  resultRevision: number;
  sourceFormat: SqlErdSourceFormat;
  sourceText: string;
  tableCount: number;
}

export interface SqlErdSourcePublishPayload extends SqlErdOperationWritePayload {
  rebaseSummary: {
    createdTableLayoutIds: string[];
    removedAnnotationLinkIds: string[];
    removedTableLayoutIds: string[];
  };
  snapshot: SqlErdSourceSnapshotPayload;
}

export type CreateSqlErdSessionRequest = Record<string, unknown>;
export type UpdateSqlErdSessionRequest = Record<string, unknown>;
export type ListSqlErdSessionsQuery = Record<string, unknown>;
export type CreateSqlErdOperationRequest = Record<string, unknown>;
export type ListSqlErdOperationsQuery = Record<string, unknown>;
export type SourcePublishRequest = Record<string, unknown>;
export type SourceSnapshotBatchQuery = Record<string, unknown>;
export type AcquireSqlErdSourceLockRequest = Record<string, unknown>;
export type RenewSqlErdSourceLockRequest = Record<string, unknown>;
export type ReleaseSqlErdSourceLockRequest = Record<string, unknown>;

export interface DeleteSqlErdSessionQuery {
  baseRevision?: unknown;
}
