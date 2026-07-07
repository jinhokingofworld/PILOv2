import { QueryResultRow } from "pg";

export const SQL_ERD_REQUEST_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

export type SqlErdSourceFormat = "sql";
export type SqlErdDialect = "auto" | "postgresql" | "mysql";
export type SqlErdJsonObject = Record<string, unknown>;

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
  created_by: string | null;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
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

export type CreateSqlErdSessionRequest = Record<string, unknown>;
export type UpdateSqlErdSessionRequest = Record<string, unknown>;

export interface DeleteSqlErdSessionQuery {
  baseRevision?: unknown;
}
