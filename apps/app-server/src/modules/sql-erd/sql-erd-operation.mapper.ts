import {
  SqlErdLayoutPatchOperationPayload,
  SqlErdOperationPayload,
  SqlErdOperationRow
} from "./sql-erd.types";

export function mapSqlErdOperation(
  operation: SqlErdOperationRow
): SqlErdOperationPayload {
  const appliedOnRevision = Number(operation.applied_on_revision);
  const shared = {
    id: operation.id,
    workspaceId: operation.workspace_id,
    sessionId: operation.session_id,
    actorUserId: operation.actor_user_id,
    opSeq: Number(operation.op_seq),
    clientOperationId: operation.client_operation_id,
    baseRevision: Number(operation.base_revision),
    appliedOnRevision,
    resultRevision: Number(operation.result_revision),
    rebased: Number(operation.base_revision) !== appliedOnRevision,
    createdAt:
      operation.created_at instanceof Date
        ? operation.created_at.toISOString()
        : new Date(operation.created_at).toISOString()
  };

  if (operation.operation_type === "source_snapshot") {
    if (!operation.source_snapshot_id) {
      throw new Error("source_snapshot operation is missing source_snapshot_id");
    }
    return {
      ...shared,
      type: "source_snapshot",
      sourceSnapshotId: operation.source_snapshot_id
    };
  }

  return {
    ...shared,
    type: "layout_patch",
    patch: operation.payload as SqlErdLayoutPatchOperationPayload["patch"]
  };
}
