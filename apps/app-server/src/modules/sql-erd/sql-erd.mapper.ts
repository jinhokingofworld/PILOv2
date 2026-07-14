import {
  SqlErdDeletedSessionPayload,
  SqlErdSessionPayload,
  SqlErdSessionRow,
  SqlErdSessionSummaryPayload,
  SqlErdSessionSummaryRow
} from "./sql-erd.types";

export function mapSqlErdSession(
  session: SqlErdSessionRow
): SqlErdSessionPayload {
  return {
    id: session.id,
    workspaceId: session.workspace_id,
    title: session.title,
    sourceFormat: session.source_format,
    dialect: session.dialect,
    sourceText: session.source_text,
    modelJson: session.model_json ?? {},
    layoutJson: session.layout_json ?? {},
    settingsJson: session.settings_json ?? {},
    tableCount: Number(session.table_count),
    relationCount: Number(session.relation_count),
    revision: Number(session.revision),
    writeProtocol: session.write_protocol,
    latestOpSeq: Number(session.latest_op_seq),
    createdBy: session.created_by,
    updatedBy: session.updated_by,
    createdAt: toIsoString(session.created_at),
    updatedAt: toIsoString(session.updated_at),
    deletedAt:
      session.deleted_at === null ? null : toIsoString(session.deleted_at)
  };
}

export function mapSqlErdSessionSummary(
  session: SqlErdSessionSummaryRow
): SqlErdSessionSummaryPayload {
  return {
    id: session.id,
    workspaceId: session.workspace_id,
    title: session.title,
    sourceFormat: session.source_format,
    dialect: session.dialect,
    tableCount: Number(session.table_count),
    relationCount: Number(session.relation_count),
    revision: Number(session.revision),
    createdBy: session.created_by,
    updatedBy: session.updated_by,
    createdAt: toIsoString(session.created_at),
    updatedAt: toIsoString(session.updated_at)
  };
}

export function mapDeletedSqlErdSession(
  id: string,
  deletedAt: Date | string,
  revision: number | string
): SqlErdDeletedSessionPayload {
  return {
    id,
    deletedAt: toIsoString(deletedAt),
    revision: Number(revision)
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
