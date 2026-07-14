export const sqlErdClientEvents = {
  join: "sql-erd:join",
  leave: "sql-erd:leave",
  presenceUpdate: "sql-erd:presence:update",
} as const;

export const sqlErdServerEvents = {
  error: "sql-erd:error",
  joined: "sql-erd:joined",
  presenceLeave: "sql-erd:presence:leave",
  presenceUpdate: "sql-erd:presence:update",
  operation: "sql-erd:operation",
} as const;

export function isSqlErdOperationPayload(
  value: unknown
): value is SqlErdOperationPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  const hasValidBasePayload =
    (payload.type === "layout_patch" || payload.type === "source_snapshot")
    && typeof payload.workspaceId === "string"
    && payload.workspaceId.trim().length > 0
    && typeof payload.sessionId === "string"
    && payload.sessionId.trim().length > 0
    && typeof payload.id === "string"
    && payload.id.trim().length > 0
    && typeof payload.actorUserId === "string"
    && payload.actorUserId.trim().length > 0
    && typeof payload.opSeq === "number"
    && Number.isSafeInteger(payload.opSeq)
    && payload.opSeq > 0
    && typeof payload.clientOperationId === "string"
    && payload.clientOperationId.trim().length > 0
    && typeof payload.baseRevision === "number"
    && Number.isSafeInteger(payload.baseRevision)
    && payload.baseRevision > 0
    && typeof payload.appliedOnRevision === "number"
    && Number.isSafeInteger(payload.appliedOnRevision)
    && payload.appliedOnRevision > 0
    && typeof payload.resultRevision === "number"
    && Number.isSafeInteger(payload.resultRevision)
    && payload.resultRevision > 0
    && typeof payload.rebased === "boolean"
    && typeof payload.createdAt === "string"
    && !Number.isNaN(Date.parse(payload.createdAt));
  if (!hasValidBasePayload) return false;
  if (payload.type === "layout_patch") {
    return typeof payload.patch === "object" && payload.patch !== null;
  }
  return typeof payload.sourceSnapshotId === "string" && payload.sourceSnapshotId.trim().length > 0;
}
import type { SqlErdOperationPayload } from "./sql-erd-types";
