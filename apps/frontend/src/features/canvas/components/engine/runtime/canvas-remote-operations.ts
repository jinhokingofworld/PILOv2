import type { CanvasShapeOperationPayload } from "@/features/canvas/api/canvas-types";
import {
  isRecord,
  normalizeCanvasShape,
} from "@/features/canvas/api/canvas-normalizers";
import { normalizeCanvasFreeformShapes } from "../../../utils/canvas-storage";
import {
  getPiloChildShapeCount,
  isPiloFrameCollapsed,
} from "../../../utils/canvas-collapse";
import type { PiloCanvasFreeformShape, PiloCanvasViewportBounds } from "../types";
import {
  buildFreeformShapeMap,
  getFreeformShapeId,
} from "./canvas-runtime-utils";

const PILO_ARROW_BINDINGS_META_KEY = "piloArrowBindingsV1";

type CanvasRemoteOperationApplyResult = {
  changed: boolean;
  expandedFrameIds: string[];
  loadedShapeIds: string[];
  nextShapes: PiloCanvasFreeformShape[];
  unloadedShapeIds: string[];
};

type CanvasRoomShapePatchApplyResult = CanvasRemoteOperationApplyResult;

function cloneShape(shape: PiloCanvasFreeformShape) {
  return JSON.parse(JSON.stringify(shape)) as PiloCanvasFreeformShape;
}

function getOperationShape(operation: CanvasShapeOperationPayload) {
  if (operation.operationType === "delete") {
    return null;
  }

  const rawShapePayload = isRecord(operation.payload)
    ? operation.payload.shape
    : null;
  const [shape] = normalizeCanvasFreeformShapes([
    normalizeCanvasShape(rawShapePayload),
  ]) as PiloCanvasFreeformShape[];

  return shape ?? null;
}

function hasSerializedArrowBindings(shape: PiloCanvasFreeformShape) {
  return (
    shape.type === "arrow" &&
    isRecord(shape.meta) &&
    Array.isArray(shape.meta[PILO_ARROW_BINDINGS_META_KEY])
  );
}

function preserveArrowBindingMeta(
  currentShape: PiloCanvasFreeformShape | undefined,
  incomingShape: PiloCanvasFreeformShape,
) {
  if (
    incomingShape.type !== "arrow" ||
    hasSerializedArrowBindings(incomingShape) ||
    !currentShape ||
    !hasSerializedArrowBindings(currentShape)
  ) {
    return incomingShape;
  }

  return {
    ...incomingShape,
    meta: {
      ...(isRecord(incomingShape.meta) ? incomingShape.meta : {}),
      [PILO_ARROW_BINDINGS_META_KEY]:
        currentShape.meta?.[PILO_ARROW_BINDINGS_META_KEY],
    },
  };
}

function isShapeParentId(parentId: unknown): parentId is string {
  return typeof parentId === "string" && parentId.startsWith("shape:");
}

function getShapeBounds(shape: PiloCanvasFreeformShape) {
  const props: Record<string, unknown> = isRecord(shape.props)
    ? shape.props
    : {};
  const width =
    typeof props.w === "number" && Number.isFinite(props.w) ? props.w : 1;
  const height =
    typeof props.h === "number" && Number.isFinite(props.h) ? props.h : 1;

  return {
    height: Math.max(1, height),
    width: Math.max(1, width),
    x: typeof shape.x === "number" && Number.isFinite(shape.x) ? shape.x : 0,
    y: typeof shape.y === "number" && Number.isFinite(shape.y) ? shape.y : 0,
  };
}

function intersectsViewport(
  shape: PiloCanvasFreeformShape,
  viewport: PiloCanvasViewportBounds | null,
) {
  if (!viewport) {
    return true;
  }

  const shapeBounds = getShapeBounds(shape);

  return (
    shapeBounds.x + shapeBounds.width >= viewport.x &&
    shapeBounds.x <= viewport.x + viewport.width &&
    shapeBounds.y + shapeBounds.height >= viewport.y &&
    shapeBounds.y <= viewport.y + viewport.height
  );
}

export function collectCanvasFrameDescendantShapeIds(
  shapes: PiloCanvasFreeformShape[],
  frameId: string,
) {
  const descendantIds = new Set<string>();
  let didAddShape = true;

  while (didAddShape) {
    didAddShape = false;

    shapes.forEach((shape) => {
      const shapeId = getFreeformShapeId(shape);
      const parentId = typeof shape.parentId === "string" ? shape.parentId : null;

      if (!shapeId || shapeId === frameId || descendantIds.has(shapeId)) {
        return;
      }

      if (parentId !== frameId && !descendantIds.has(parentId ?? "")) {
        return;
      }

      descendantIds.add(shapeId);
      didAddShape = true;
    });
  }

  return descendantIds;
}

export function applyCanvasRemoteOperation({
  currentShapes,
  operation,
  shapeDetailCache,
  viewportBounds,
}: {
  currentShapes: PiloCanvasFreeformShape[];
  operation: CanvasShapeOperationPayload;
  shapeDetailCache: Map<string, PiloCanvasFreeformShape>;
  viewportBounds: PiloCanvasViewportBounds | null;
}): CanvasRemoteOperationApplyResult {
  const shapeId = operation.shapeId;

  if (!shapeId) {
    return {
      changed: false,
      expandedFrameIds: [],
      loadedShapeIds: [],
      nextShapes: currentShapes,
      unloadedShapeIds: [],
    };
  }

  if (operation.operationType === "delete") {
    shapeDetailCache.delete(shapeId);

    const nextShapes = currentShapes.filter(
      (shape) => getFreeformShapeId(shape) !== shapeId,
    );

    return {
      changed: nextShapes.length !== currentShapes.length,
      expandedFrameIds: [],
      loadedShapeIds: [],
      nextShapes,
      unloadedShapeIds: [],
    };
  }

  const incomingShape = getOperationShape(operation);

  if (!incomingShape) {
    return {
      changed: false,
      expandedFrameIds: [],
      loadedShapeIds: [],
      nextShapes: currentShapes,
      unloadedShapeIds: [],
    };
  }

  const currentShapeMap = buildFreeformShapeMap(currentShapes);
  const currentShape = currentShapeMap.get(shapeId);
  const nextShape = preserveArrowBindingMeta(currentShape, cloneShape(incomingShape));
  const parentId =
    typeof nextShape.parentId === "string" ? nextShape.parentId : null;
  const wasCollapsedFrame = currentShape
    ? isPiloFrameCollapsed(currentShape)
    : false;
  const isCollapsedFrame = isPiloFrameCollapsed(nextShape);

  shapeDetailCache.set(shapeId, nextShape);

  if (isShapeParentId(parentId)) {
    const parentShape =
      currentShapeMap.get(parentId) ?? shapeDetailCache.get(parentId);

    if (!parentShape || isPiloFrameCollapsed(parentShape)) {
      return {
        changed: false,
        expandedFrameIds: [],
        loadedShapeIds: [],
        nextShapes: currentShapes,
        unloadedShapeIds: [shapeId],
      };
    }
  }

  if (!currentShape && !intersectsViewport(nextShape, viewportBounds)) {
    return {
      changed: false,
      expandedFrameIds: [],
      loadedShapeIds: [],
      nextShapes: currentShapes,
      unloadedShapeIds: [],
    };
  }

  let nextShapes = currentShape
    ? currentShapes.map((shape) =>
        getFreeformShapeId(shape) === shapeId ? nextShape : shape,
      )
    : [...currentShapes, nextShape];
  const expandedFrameIds =
    nextShape.type === "frame" &&
    !isCollapsedFrame &&
    (wasCollapsedFrame ||
      (!currentShape && getPiloChildShapeCount(nextShape) > 0))
      ? [shapeId]
      : [];
  let unloadedShapeIds: string[] = [];

  if (isCollapsedFrame) {
    const descendantIds = collectCanvasFrameDescendantShapeIds(
      currentShapes,
      shapeId,
    );

    if (descendantIds.size) {
      unloadedShapeIds = Array.from(descendantIds);
      currentShapes.forEach((shape) => {
        const descendantShapeId = getFreeformShapeId(shape);

        if (descendantShapeId && descendantIds.has(descendantShapeId)) {
          shapeDetailCache.set(descendantShapeId, cloneShape(shape));
        }
      });
      nextShapes = nextShapes.filter((shape) => {
        const nextShapeId = getFreeformShapeId(shape);

        return !nextShapeId || !descendantIds.has(nextShapeId);
      });
    }
  }

  return {
    changed: true,
    expandedFrameIds,
    loadedShapeIds: [shapeId],
    nextShapes,
    unloadedShapeIds,
  };
}

export function applyCanvasRoomShapePatch({
  currentShapes,
  deletedShapeIds,
  shapeDetailCache,
  upsertShapes,
  viewportBounds,
}: {
  currentShapes: PiloCanvasFreeformShape[];
  deletedShapeIds: string[];
  shapeDetailCache: Map<string, PiloCanvasFreeformShape>;
  upsertShapes: PiloCanvasFreeformShape[];
  viewportBounds: PiloCanvasViewportBounds | null;
}): CanvasRoomShapePatchApplyResult {
  const deletedShapeIdSet = new Set(deletedShapeIds);
  const previousShapeMap = buildFreeformShapeMap(currentShapes);
  const previousCachedShapeMap = new Map(shapeDetailCache);
  const incomingShapeMap = buildFreeformShapeMap(
    upsertShapes.filter((shape) => {
      const shapeId = getFreeformShapeId(shape);
      return !shapeId || !deletedShapeIdSet.has(shapeId);
    }),
  );
  const expandedFrameIds = new Set<string>();
  const loadedShapeIds = new Set<string>();
  const unloadedShapeIds = new Set<string>();
  let changed = false;
  let nextShapes = currentShapes;

  if (deletedShapeIdSet.size) {
    const filteredShapes = nextShapes.filter((shape) => {
      const shapeId = getFreeformShapeId(shape);
      return !shapeId || !deletedShapeIdSet.has(shapeId);
    });

    changed = filteredShapes.length !== nextShapes.length;
    nextShapes = filteredShapes;
    deletedShapeIdSet.forEach((shapeId) => {
      shapeDetailCache.delete(shapeId);
    });
  }

  const orderedUpsertShapes = [
    ...upsertShapes.filter((shape) => shape.type === "frame"),
    ...upsertShapes.filter((shape) => shape.type !== "frame"),
  ];

  orderedUpsertShapes.forEach((incomingShape) => {
    const shapeId = getFreeformShapeId(incomingShape);

    if (!shapeId || deletedShapeIdSet.has(shapeId)) {
      return;
    }

    const visibleShapeMap = buildFreeformShapeMap(nextShapes);
    const currentShape = visibleShapeMap.get(shapeId);
    const previousShape =
      previousShapeMap.get(shapeId) ?? previousCachedShapeMap.get(shapeId);
    const nextShape = preserveArrowBindingMeta(
      currentShape ?? previousShape,
      cloneShape(incomingShape),
    );
    const parentId =
      typeof nextShape.parentId === "string" ? nextShape.parentId : null;
    const isCollapsedFrame = isPiloFrameCollapsed(nextShape);
    const wasCollapsedFrame = previousShape
      ? isPiloFrameCollapsed(previousShape)
      : false;

    shapeDetailCache.set(shapeId, nextShape);

    if (isShapeParentId(parentId)) {
      const parentShape =
        visibleShapeMap.get(parentId) ??
        incomingShapeMap.get(parentId) ??
        shapeDetailCache.get(parentId);
      const hasVisibleExpandedParent =
        visibleShapeMap.has(parentId) &&
        parentShape !== undefined &&
        !isPiloFrameCollapsed(parentShape);

      if (!hasVisibleExpandedParent) {
        unloadedShapeIds.add(shapeId);

        if (currentShape) {
          nextShapes = nextShapes.filter(
            (shape) => getFreeformShapeId(shape) !== shapeId,
          );
          changed = true;
        }

        return;
      }
    } else if (!currentShape && !intersectsViewport(nextShape, viewportBounds)) {
      return;
    }

    nextShapes = currentShape
      ? nextShapes.map((shape) =>
          getFreeformShapeId(shape) === shapeId ? nextShape : shape,
        )
      : [...nextShapes, nextShape];
    loadedShapeIds.add(shapeId);
    changed = true;

    if (
      nextShape.type === "frame" &&
      !isCollapsedFrame &&
      (wasCollapsedFrame ||
        (!currentShape && getPiloChildShapeCount(nextShape) > 0))
    ) {
      expandedFrameIds.add(shapeId);
    }

    if (!isCollapsedFrame) {
      return;
    }

    const descendantIds = collectCanvasFrameDescendantShapeIds(
      nextShapes,
      shapeId,
    );

    if (!descendantIds.size) {
      return;
    }

    nextShapes.forEach((shape) => {
      const descendantShapeId = getFreeformShapeId(shape);

      if (descendantShapeId && descendantIds.has(descendantShapeId)) {
        shapeDetailCache.set(descendantShapeId, cloneShape(shape));
        unloadedShapeIds.add(descendantShapeId);
        loadedShapeIds.delete(descendantShapeId);
      }
    });
    nextShapes = nextShapes.filter((shape) => {
      const nextShapeId = getFreeformShapeId(shape);
      return !nextShapeId || !descendantIds.has(nextShapeId);
    });
  });

  return {
    changed,
    expandedFrameIds: [...expandedFrameIds],
    loadedShapeIds: [...loadedShapeIds],
    nextShapes,
    unloadedShapeIds: [...unloadedShapeIds],
  };
}
