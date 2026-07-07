import type {
  CanvasBoardDetail,
  CanvasBoardSummary,
  CanvasViewSetting,
} from "./canvas-types";

const defaultCanvasBoardId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function defaultCanvasViewSetting(): CanvasViewSetting {
  return {
    zoom: 1,
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
  return isRecord(value) && isRecord(value.rawShape) ? value.rawShape : value;
}

export function normalizeCanvasShapes(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeCanvasShape);
}

export function createMockCanvasBoardDetail(
  workspaceId = "pilo-local-workspace",
): CanvasBoardDetail {
  return {
    id: defaultCanvasBoardId,
    workspaceId,
    title: "PILO Canvas",
    boardType: "freeform",
    zoom: 1,
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
