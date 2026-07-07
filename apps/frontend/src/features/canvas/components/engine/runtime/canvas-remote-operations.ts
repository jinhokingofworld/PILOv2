import type { CanvasShapeOperationPayload } from "@/features/canvas/api/canvas-types";
import {
  isRecord,
  normalizeCanvasShape,
} from "@/features/canvas/api/canvas-normalizers";
import { normalizeCanvasFreeformShapes } from "../../../utils/canvas-storage";
import { isPiloFrameCollapsed } from "../../../utils/canvas-collapse";
import type { PiloCanvasFreeformShape, PiloCanvasViewportBounds } from "../types";
import {
  buildFreeformShapeMap,
  getFreeformShapeId,
} from "./canvas-runtime-utils";

const PILO_ARROW_BINDINGS_META_KEY = "piloArrowBindingsV1";

type CanvasRemoteOperationApplyResult = {
  changed: boolean;
  nextShapes: PiloCanvasFreeformShape[];
};

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
      nextShapes: currentShapes,
    };
  }

  if (operation.operationType === "delete") {
    shapeDetailCache.delete(shapeId);

    const nextShapes = currentShapes.filter(
      (shape) => getFreeformShapeId(shape) !== shapeId,
    );

    return {
      changed: nextShapes.length !== currentShapes.length,
      nextShapes,
    };
  }

  const incomingShape = getOperationShape(operation);

  if (!incomingShape) {
    return {
      changed: false,
      nextShapes: currentShapes,
    };
  }

  const currentShapeMap = buildFreeformShapeMap(currentShapes);
  const currentShape = currentShapeMap.get(shapeId);
  const nextShape = preserveArrowBindingMeta(currentShape, cloneShape(incomingShape));
  const parentId =
    typeof nextShape.parentId === "string" ? nextShape.parentId : null;

  shapeDetailCache.set(shapeId, nextShape);

  if (isShapeParentId(parentId)) {
    const parentShape =
      currentShapeMap.get(parentId) ?? shapeDetailCache.get(parentId);

    if (!parentShape || isPiloFrameCollapsed(parentShape)) {
      return {
        changed: false,
        nextShapes: currentShapes,
      };
    }
  }

  if (!currentShape && !intersectsViewport(nextShape, viewportBounds)) {
    return {
      changed: false,
      nextShapes: currentShapes,
    };
  }

  const nextShapes = currentShape
    ? currentShapes.map((shape) =>
        getFreeformShapeId(shape) === shapeId ? nextShape : shape,
      )
    : [...currentShapes, nextShape];

  return {
    changed: true,
    nextShapes,
  };
}
