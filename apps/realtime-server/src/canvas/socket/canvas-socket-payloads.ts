import type {
  CanvasJoinPayload,
  CanvasPresenceEditingMode,
  CanvasPresencePoint,
  CanvasPresenceUpdatePayload,
  CanvasRoomRef,
  CanvasRoomShapePatchPayload,
  CanvasShapeOperationPayload,
  CanvasShapePreviewClearRequestPayload,
  CanvasShapePreviewPayload,
  CanvasViewportLoadedPayload,
} from "../contracts/canvas-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];

  if (typeof value !== "string") return null;
  if (!value.trim()) return null;

  return value;
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isCanvasPresencePoint(value: unknown): value is CanvasPresencePoint {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y)
  );
}

function isCanvasPresenceViewport(
  value: unknown,
): value is CanvasPresenceUpdatePayload["viewport"] {
  return (
    isRecord(value) &&
    typeof value.height === "number" &&
    typeof value.width === "number" &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.zoom === "number" &&
    Number.isFinite(value.height) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.zoom)
  );
}

function isCanvasPresenceEditingMode(
  value: unknown,
): value is CanvasPresenceEditingMode {
  return (
    value === "code" ||
    value === "draw" ||
    value === "hand" ||
    value === "move" ||
    value === "placement" ||
    value === "resize" ||
    value === "select" ||
    value === "text"
  );
}

function readShapeIdList(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    !value.every((shapeId) => typeof shapeId === "string")
  ) {
    return null;
  }

  return Array.from(
    new Set(value.map((shapeId) => shapeId.trim()).filter(Boolean)),
  );
}

function isShapePreviewPhase(
  value: unknown,
): value is CanvasShapePreviewPayload["phase"] {
  return (
    value === "delete" ||
    value === "move" ||
    value === "resize" ||
    value === "unknown"
  );
}

export function readCanvasRoomRef(payload: unknown): CanvasRoomRef | null {
  if (!isRecord(payload)) return null;

  const workspaceId = readRequiredString(payload, "workspaceId");
  const canvasId = readRequiredString(payload, "canvasId");

  if (!workspaceId || !canvasId) return null;

  return { canvasId, workspaceId };
}

export function readCanvasJoinPayload(
  payload: unknown,
): CanvasJoinPayload | null {
  const room = readCanvasRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const initialViewportBounds =
    payload.initialViewportBounds === undefined
      ? null
      : readCanvasLoadedViewportBounds(payload.initialViewportBounds);
  const lastSeenOpSeq = payload.lastSeenOpSeq;

  if (
    payload.initialViewportBounds !== undefined &&
    initialViewportBounds === null
  ) {
    return null;
  }

  return {
    ...room,
    ...(initialViewportBounds ? { initialViewportBounds } : {}),
    ...(typeof lastSeenOpSeq === "number" &&
    Number.isInteger(lastSeenOpSeq) &&
    lastSeenOpSeq >= 0
      ? { lastSeenOpSeq }
      : {}),
  };
}

export function readCanvasPresenceUpdatePayload(
  payload: unknown,
): CanvasPresenceUpdatePayload | null {
  const room = readCanvasRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const cursor = payload.cursor;
  const selectedShapeIds = payload.selectedShapeIds;
  const editingShapeId = payload.editingShapeId;
  const editingMode = payload.editingMode;
  const sentAt = payload.sentAt;
  const viewport = payload.viewport;
  const validCursor = cursor === null || isCanvasPresencePoint(cursor);

  if (!validCursor) return null;
  if (
    editingShapeId !== undefined &&
    editingShapeId !== null &&
    typeof editingShapeId !== "string"
  ) {
    return null;
  }
  if (
    editingMode !== undefined &&
    editingMode !== null &&
    !isCanvasPresenceEditingMode(editingMode)
  ) {
    return null;
  }
  if (sentAt !== undefined && !isIsoDateString(sentAt)) return null;
  if (viewport !== undefined && !isCanvasPresenceViewport(viewport)) return null;
  if (
    !Array.isArray(selectedShapeIds) ||
    !selectedShapeIds.every((shapeId) => typeof shapeId === "string")
  ) {
    return null;
  }

  return {
    ...room,
    cursor,
    editingMode: editingMode ?? null,
    editingShapeId:
      typeof editingShapeId === "string" && editingShapeId
        ? editingShapeId
        : null,
    selectedShapeIds,
    ...(sentAt ? { sentAt } : {}),
    ...(viewport ? { viewport } : {}),
  };
}

export function readCanvasShapePreviewPayload(
  payload: unknown,
): CanvasShapePreviewPayload | null {
  const room = readCanvasRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const shapes = payload.shapes;
  const deletedShapeIds =
    payload.deletedShapeIds === undefined
      ? undefined
      : readShapeIdList(payload.deletedShapeIds);

  if (!Array.isArray(shapes) || !shapes.every(isRecord)) return null;
  if (payload.deletedShapeIds !== undefined && !deletedShapeIds) return null;
  if (!shapes.length && !deletedShapeIds?.length) return null;

  return {
    ...room,
    ...(deletedShapeIds?.length ? { deletedShapeIds } : {}),
    phase: isShapePreviewPhase(payload.phase) ? payload.phase : "unknown",
    shapes,
  };
}

export function readCanvasShapePreviewClearPayload(
  payload: unknown,
): CanvasShapePreviewClearRequestPayload | null {
  const room = readCanvasRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const shapeIds = readShapeIdList(payload.shapeIds);

  if (!shapeIds?.length) return null;

  return {
    ...room,
    shapeIds,
  };
}

export function readCanvasLoadedViewportBounds(
  bounds: unknown,
): CanvasViewportLoadedPayload["bounds"] | null {
  if (!isRecord(bounds)) return null;

  const { height, margin, width, x, y } = bounds;

  if (
    typeof height !== "number" ||
    typeof margin !== "number" ||
    typeof width !== "number" ||
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(height) ||
    !Number.isFinite(margin) ||
    !Number.isFinite(width) ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    height <= 0 ||
    width <= 0 ||
    margin < 0
  ) {
    return null;
  }

  return { height, margin, width, x, y };
}

export function readCanvasViewportLoadedPayload(
  payload: unknown,
): CanvasViewportLoadedPayload | null {
  const room = readCanvasRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const bounds = readCanvasLoadedViewportBounds(payload.bounds);
  const shapes = payload.shapes;

  if (!bounds) return null;
  if (!Array.isArray(shapes) || !shapes.every(isRecord)) {
    return null;
  }

  return {
    ...room,
    bounds,
    shapes,
  };
}

export function readCanvasRoomShapePatchPayload(
  payload: unknown,
): CanvasRoomShapePatchPayload | null {
  const room = readCanvasRoomRef(payload);

  if (!room || !isRecord(payload)) return null;

  const upsertShapes = payload.upsertShapes;
  const deletedShapeIds = readShapeIdList(payload.deletedShapeIds);

  if (!Array.isArray(upsertShapes) || !upsertShapes.every(isRecord)) {
    return null;
  }
  if (!deletedShapeIds) return null;
  if (!upsertShapes.length && !deletedShapeIds.length) return null;

  return {
    ...room,
    deletedShapeIds,
    upsertShapes,
  };
}

export function isCanvasShapeOperationPayload(
  value: unknown,
): value is CanvasShapeOperationPayload {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.canvasId === "string" &&
    typeof value.shapeId === "string" &&
    typeof value.actorUserId === "string" &&
    typeof value.clientOperationId === "string" &&
    typeof value.contentHash === "string" &&
    isIsoDateString(value.createdAt) &&
    (value.operationType === "create" ||
      value.operationType === "update" ||
      value.operationType === "delete") &&
    typeof value.opSeq === "number" &&
    Number.isInteger(value.opSeq) &&
    value.opSeq > 0 &&
    (value.baseRevision === null ||
      (typeof value.baseRevision === "number" &&
        Number.isInteger(value.baseRevision) &&
        value.baseRevision > 0)) &&
    typeof value.resultRevision === "number" &&
    Number.isInteger(value.resultRevision) &&
    value.resultRevision > 0 &&
    isRecord(value.payload)
  );
}
