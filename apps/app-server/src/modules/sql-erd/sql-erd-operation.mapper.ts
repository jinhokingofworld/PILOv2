import {
  SqlErdOperationPayload,
  SqlErdOperationRow
} from "./sql-erd.types";

export function mapSqlErdOperation(
  operation: SqlErdOperationRow
): SqlErdOperationPayload {
  const appliedOnRevision = Number(operation.applied_on_revision);

  return {
    id: operation.id,
    workspaceId: operation.workspace_id,
    sessionId: operation.session_id,
    actorUserId: operation.actor_user_id,
    type: operation.operation_type,
    opSeq: Number(operation.op_seq),
    clientOperationId: operation.client_operation_id,
    baseRevision: Number(operation.base_revision),
    appliedOnRevision,
    resultRevision: Number(operation.result_revision),
    rebased: Number(operation.base_revision) !== appliedOnRevision,
    patch: operation.payload,
    createdAt:
      operation.created_at instanceof Date
        ? operation.created_at.toISOString()
        : new Date(operation.created_at).toISOString()
  };
}
