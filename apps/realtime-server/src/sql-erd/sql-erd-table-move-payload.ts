import type {
  SqlErdTableMoveClearPayload,
  SqlErdTableMovePreviewPayload,
} from "./sql-erd-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredId(value: unknown, maxLength = 256) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function readRoom(payload: Record<string, unknown>) {
  const workspaceId = readRequiredId(payload.workspaceId);
  const sessionId = readRequiredId(payload.sessionId);
  return workspaceId && sessionId ? { sessionId, workspaceId } : null;
}

export function readSqlErdTableMovePreviewPayload(
  value: unknown,
): SqlErdTableMovePreviewPayload | null {
  if (!isRecord(value)) return null;
  const room = readRoom(value);
  const dragId = readRequiredId(value.dragId, 128);
  const tableId = readRequiredId(value.tableId);

  if (
    !room ||
    !dragId ||
    !tableId ||
    typeof value.x !== "number" ||
    typeof value.y !== "number" ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    Math.abs(value.x) > 10_000_000 ||
    Math.abs(value.y) > 10_000_000
  ) {
    return null;
  }

  return { ...room, dragId, tableId, x: value.x, y: value.y };
}

export function readSqlErdTableMoveClearPayload(
  value: unknown,
): SqlErdTableMoveClearPayload | null {
  if (!isRecord(value)) return null;
  const room = readRoom(value);
  if (
    !room ||
    !Array.isArray(value.tableIds) ||
    value.tableIds.length === 0 ||
    value.tableIds.length > 100
  ) {
    return null;
  }

  const tableIds = Array.from(
    new Set(value.tableIds.map((tableId) => readRequiredId(tableId))),
  );
  if (tableIds.some((tableId) => tableId === null)) return null;

  return { ...room, tableIds: tableIds as string[] };
}
