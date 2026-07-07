import { hasCanvasFreeformShapeChanged } from "../../../utils/canvas-shape-sync";
import type { PiloCanvasFreeformShape, PiloCanvasViewportBounds } from "../types";
import type { CanvasViewSetting } from "./canvas-runtime-types";

export const DEFAULT_VIEW_SETTING_SYNC_DEBOUNCE_MS = 360;
export const DEFAULT_VIEWPORT_SHAPE_LOAD_DEBOUNCE_MS = 280;
export const DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN = 320;
export const CANVAS_SHAPE_DETAIL_MIN_ZOOM = 0.75;
export const CANVAS_VIEWPORT_SHAPE_STALE_TIME_MS = 5_000;
export const CANVAS_SHAPE_DETAIL_STALE_TIME_MS = 30_000;

export function clampZoom(value: number) {
  return Math.min(8, Math.max(0.12, Math.round(value * 100) / 100));
}

export function areViewSettingsEqual(
  current: CanvasViewSetting,
  next: CanvasViewSetting,
) {
  return (
    current.zoom === next.zoom &&
    current.viewportX === next.viewportX &&
    current.viewportY === next.viewportY
  );
}

export function getFreeformShapeId(shape: PiloCanvasFreeformShape) {
  return typeof shape.id === "string" ? shape.id : null;
}

export function buildFreeformShapeMap(shapes: PiloCanvasFreeformShape[]) {
  const shapeMap = new Map<string, PiloCanvasFreeformShape>();

  shapes.forEach((shape) => {
    const shapeId = getFreeformShapeId(shape);

    if (!shapeId) return;

    shapeMap.set(shapeId, shape);
  });

  return shapeMap;
}

export function getChangedFreeformShapeIds(
  currentShapes: PiloCanvasFreeformShape[],
  nextShapes: PiloCanvasFreeformShape[],
) {
  const currentShapeMap = buildFreeformShapeMap(currentShapes);
  const nextShapeMap = buildFreeformShapeMap(nextShapes);
  const changedShapeIds = new Set<string>();

  nextShapeMap.forEach((nextShape, shapeId) => {
    const currentShape = currentShapeMap.get(shapeId);

    if (
      !currentShape ||
      hasCanvasFreeformShapeChanged(currentShape, nextShape)
    ) {
      changedShapeIds.add(shapeId);
    }
  });

  currentShapeMap.forEach((_currentShape, shapeId) => {
    if (!nextShapeMap.has(shapeId)) {
      changedShapeIds.add(shapeId);
    }
  });

  return changedShapeIds;
}

export function mergeFreeformShapesById(
  currentShapes: PiloCanvasFreeformShape[],
  nextShapes: PiloCanvasFreeformShape[],
) {
  const mergedShapeMap = new Map<string, PiloCanvasFreeformShape>();
  const orderedShapeIds: string[] = [];

  currentShapes.forEach((shape) => {
    const shapeId = getFreeformShapeId(shape);

    if (!shapeId) return;

    mergedShapeMap.set(shapeId, shape);
    orderedShapeIds.push(shapeId);
  });

  nextShapes.forEach((shape) => {
    const shapeId = getFreeformShapeId(shape);

    if (!shapeId) return;

    if (!mergedShapeMap.has(shapeId)) {
      orderedShapeIds.push(shapeId);
    }

    mergedShapeMap.set(shapeId, shape);
  });

  return orderedShapeIds
    .map((shapeId) => mergedShapeMap.get(shapeId))
    .filter((shape): shape is PiloCanvasFreeformShape => Boolean(shape));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeViewSetting(
  value: unknown,
  fallback: CanvasViewSetting,
): CanvasViewSetting {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !isFiniteNumber((value as CanvasViewSetting).zoom) ||
    !isFiniteNumber((value as CanvasViewSetting).viewportX) ||
    !isFiniteNumber((value as CanvasViewSetting).viewportY)
  ) {
    return fallback;
  }

  return {
    zoom: clampZoom((value as CanvasViewSetting).zoom),
    viewportX: (value as CanvasViewSetting).viewportX,
    viewportY: (value as CanvasViewSetting).viewportY,
  };
}

export function buildViewportShapeQueryKey({
  boardId,
  bounds,
  workspaceId,
}: {
  boardId: string;
  bounds: PiloCanvasViewportBounds;
  workspaceId: string;
}) {
  const round = (value: number) => Math.round(value * 100) / 100;

  return [
    "canvas",
    workspaceId,
    boardId,
    "viewport-shapes",
    round(bounds.x),
    round(bounds.y),
    round(bounds.width),
    round(bounds.height),
    round(bounds.zoom),
    DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN,
  ] as const;
}

export function buildShapeDetailQueryKey({
  shapeId,
  workspaceId,
}: {
  shapeId: string;
  workspaceId: string;
}) {
  return ["canvas", workspaceId, "shape-detail", shapeId] as const;
}

export function buildFrameChildrenQueryKey({
  boardId,
  frameId,
  workspaceId,
}: {
  boardId: string;
  frameId: string;
  workspaceId: string;
}) {
  return ["canvas", workspaceId, boardId, "frame-children", frameId] as const;
}
