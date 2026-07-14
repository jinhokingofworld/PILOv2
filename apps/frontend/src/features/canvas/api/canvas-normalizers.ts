import type {
  CanvasBoardDetail,
  CanvasBoardSummary,
  CanvasOperationsCatchupPayload,
  CanvasShapeOperationPayload,
  CanvasViewSetting,
} from "./canvas-types";
import {
  PILO_CHILD_SHAPE_COUNT_META_KEY,
  isRecord as isCanvasRecord,
} from "../utils/canvas-collapse";

const defaultCanvasBoardId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

export const isRecord = isCanvasRecord;

export function defaultCanvasViewSetting(): CanvasViewSetting {
  return {
    zoom: 0.8,
    viewportX: 0,
    viewportY: 0,
  };
}

export function unwrapCanvasApiData(value: unknown) {
  if (isRecord(value) && value.success === true && "data" in value) {
    return value.data;
  }

  return value;
}

export function normalizeCanvasShape(value: unknown) {
  if (!isRecord(value) || !isRecord(value.rawShape)) {
    return value;
  }

  const rawShape = { ...value.rawShape };
  const meta = isRecord(rawShape.meta) ? { ...rawShape.meta } : {};
  const childShapeCount = normalizeNumber(value.childShapeCount, 0);
  const id = normalizeString(value.id, normalizeString(rawShape.id));
  const shapeType = normalizeString(
    value.shapeType,
    normalizeString(rawShape.type),
  );

  if (id) {
    rawShape.id = id;
  }

  if (shapeType) {
    rawShape.type = shapeType;
  }

  if (
    typeof value.parentShapeId === "string" &&
    value.parentShapeId.startsWith("shape:")
  ) {
    rawShape.parentId = value.parentShapeId;
  } else {
    delete rawShape.parentId;
  }

  if (childShapeCount > 0) {
    meta[PILO_CHILD_SHAPE_COUNT_META_KEY] = childShapeCount;
  }

  rawShape.meta = meta;

  if (typeof value.revision === "number" && Number.isInteger(value.revision)) {
    rawShape.revision = value.revision;
  }

  if (typeof value.contentHash === "string") {
    rawShape.contentHash = value.contentHash;
  }

  return rawShape;
}

export function normalizeCanvasShapes(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeCanvasShape);
}

function normalizeNumber(value: unknown, fallback = 0) {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : fallback;

  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeOptionalNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeNumber(value);
}

export function normalizeCanvasOperation(
  value: unknown,
): CanvasShapeOperationPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const operationType =
    value.operationType === "create" ||
    value.operationType === "update" ||
    value.operationType === "delete"
      ? value.operationType
      : "update";

  return {
    id: normalizeString(value.id),
    workspaceId: normalizeString(value.workspaceId),
    canvasId: normalizeString(value.canvasId),
    shapeId: normalizeString(value.shapeId),
    operationType,
    opSeq: normalizeNumber(value.opSeq),
    actorUserId: normalizeString(value.actorUserId),
    clientOperationId: normalizeString(value.clientOperationId),
    baseRevision: normalizeOptionalNumber(value.baseRevision),
    resultRevision: normalizeNumber(value.resultRevision),
    contentHash: normalizeString(value.contentHash),
    payload: isRecord(value.payload) ? value.payload : {},
    createdAt: normalizeString(value.createdAt),
  };
}

export function normalizeCanvasOperationsCatchup(
  value: unknown,
): CanvasOperationsCatchupPayload {
  if (!isRecord(value)) {
    return {
      latestOpSeq: 0,
      operations: [],
    };
  }

  const operations = Array.isArray(value.operations)
    ? value.operations.flatMap((operation) => {
        const normalizedOperation = normalizeCanvasOperation(operation);

        return normalizedOperation === null ? [] : [normalizedOperation];
      })
    : [];

  return {
    latestOpSeq: normalizeNumber(value.latestOpSeq),
    operations,
  };
}

export function createMockCanvasBoardDetail(
  workspaceId = "pilo-local-workspace",
): CanvasBoardDetail {
  return {
    id: defaultCanvasBoardId,
    workspaceId,
    title: "PILO Canvas",
    boardType: "freeform",
    zoom: 0.8,
    viewportX: 0,
    viewportY: 0,
    shapeCount: 0,
    updatedAt: "2026-06-28T00:00:00.000Z",
    shapes: [],
    viewSetting: defaultCanvasViewSetting(),
    userState: null,
  };
}

export function toBoardSummary(board: CanvasBoardDetail): CanvasBoardSummary {
  return {
    id: board.id,
    workspaceId: board.workspaceId,
    title: board.title,
    boardType: board.boardType,
    zoom: board.zoom,
    viewportX: board.viewportX,
    viewportY: board.viewportY,
    shapeCount: board.shapeCount,
    updatedAt: board.updatedAt,
  };
}

export function normalizeCanvasBoardDetail(
  rawBoard: unknown,
  { workspaceId }: { workspaceId?: string } = {},
): CanvasBoardDetail {
  if (!isRecord(rawBoard)) {
    return createMockCanvasBoardDetail(workspaceId);
  }

  const fallback = createMockCanvasBoardDetail(
    workspaceId ??
      (typeof rawBoard.workspaceId === "string"
        ? rawBoard.workspaceId
        : undefined),
  );
  const rawViewSetting = rawBoard.viewSetting;

  return {
    ...fallback,
    id: typeof rawBoard.id === "string" ? rawBoard.id : fallback.id,
    workspaceId:
      typeof rawBoard.workspaceId === "string"
        ? rawBoard.workspaceId
        : fallback.workspaceId,
    title: typeof rawBoard.title === "string" ? rawBoard.title : fallback.title,
    boardType:
      typeof rawBoard.boardType === "string"
        ? rawBoard.boardType
        : fallback.boardType,
    zoom: typeof rawBoard.zoom === "number" ? rawBoard.zoom : fallback.zoom,
    viewportX:
      typeof rawBoard.viewportX === "number"
        ? rawBoard.viewportX
        : fallback.viewportX,
    viewportY:
      typeof rawBoard.viewportY === "number"
        ? rawBoard.viewportY
        : fallback.viewportY,
    shapeCount:
      typeof rawBoard.shapeCount === "number"
        ? rawBoard.shapeCount
        : fallback.shapeCount,
    updatedAt:
      typeof rawBoard.updatedAt === "string"
        ? rawBoard.updatedAt
        : fallback.updatedAt,
    shapes: normalizeCanvasShapes(rawBoard.shapes),
    viewSetting: isRecord(rawViewSetting)
      ? {
          zoom:
            typeof rawViewSetting.zoom === "number"
              ? rawViewSetting.zoom
              : fallback.viewSetting.zoom,
          viewportX:
            typeof rawViewSetting.viewportX === "number"
              ? rawViewSetting.viewportX
              : fallback.viewSetting.viewportX,
          viewportY:
            typeof rawViewSetting.viewportY === "number"
              ? rawViewSetting.viewportY
              : fallback.viewSetting.viewportY,
        }
      : fallback.viewSetting,
    userState: isRecord(rawBoard.userState) ? rawBoard.userState : null,
  };
}
