import type {
  PrReviewCanvasShape,
  PrReviewCanvasViewportQuery,
  UpdatePrReviewCanvasFileShapeInput
} from "@/features/pr-review/types";
import type { CanvasShapeOperationPayload } from "@/shared/canvas-realtime/canvas-realtime-types";

export const PR_REVIEW_CANVAS_LOAD_QUERY: PrReviewCanvasViewportQuery = {
  x: -100_000,
  y: -100_000,
  width: 200_000,
  height: 200_000,
  margin: 0
};

export type PrReviewCanvasFileShapeSnapshot = {
  id: string;
  parentId: string;
  x: number;
  y: number;
  index: string;
  props: {
    w: number;
    h: number;
    pinned: boolean;
  };
};

export type PrReviewRelationEdgeGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  routePoints: Array<{ x: number; y: number }>;
};

export function isPrReviewCanvasSystemShape(shape: PrReviewCanvasShape) {
  return (
    shape.shapeType === "pr_review_file_node" ||
    shape.shapeType === "pr_review_relation_edge"
  );
}

export function isPrReviewCanvasFileShape(shape: PrReviewCanvasShape) {
  return shape.shapeType === "pr_review_file_node";
}

export function getPrReviewFileShapeGeometryKey(
  shape: PrReviewCanvasFileShapeSnapshot
) {
  return [
    shape.parentId,
    shape.x,
    shape.y,
    shape.index,
    shape.props.w,
    shape.props.h,
    shape.props.pinned
  ].join("\u0000");
}

export function buildPrReviewFileShapeUpdateInput(
  storedShape: PrReviewCanvasShape,
  currentShape: PrReviewCanvasFileShapeSnapshot,
  clientOperationId: string
): UpdatePrReviewCanvasFileShapeInput {
  const width = requireFinitePositiveNumber(
    currentShape.props.w,
    "PR Review file shape width"
  );
  const height = requireFinitePositiveNumber(
    currentShape.props.h,
    "PR Review file shape height"
  );
  const parentShapeId = currentShape.parentId.startsWith("shape:")
    ? currentShape.parentId
    : null;
  const rawShape = { ...storedShape.rawShape };
  const rawProps = isRecord(rawShape.props) ? { ...rawShape.props } : {};

  rawShape.x = currentShape.x;
  rawShape.y = currentShape.y;
  rawShape.index = currentShape.index;
  rawProps.w = width;
  rawProps.h = height;
  rawProps.pinned = currentShape.props.pinned;
  rawShape.props = rawProps;

  if (parentShapeId) {
    rawShape.parentId = parentShapeId;
  } else {
    delete rawShape.parentId;
  }

  return {
    parentShapeId,
    x: currentShape.x,
    y: currentShape.y,
    width,
    height,
    zIndex: storedShape.zIndex,
    rawShape,
    baseRevision: storedShape.revision,
    clientOperationId
  };
}

export function applyPrReviewFileShapeUpdate(
  storedShape: PrReviewCanvasShape,
  input: UpdatePrReviewCanvasFileShapeInput,
  revision: number
): PrReviewCanvasShape {
  return {
    ...storedShape,
    parentShapeId: input.parentShapeId,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    zIndex: input.zIndex,
    rawShape: input.rawShape,
    revision
  };
}

export function readPrReviewCanvasOperationShape(
  operation: CanvasShapeOperationPayload
): PrReviewCanvasShape | null {
  const shape = operation.payload.shape;
  if (
    operation.operationType !== "update" ||
    !isRecord(shape) ||
    shape.id !== operation.shapeId ||
    shape.canvasId !== operation.canvasId ||
    shape.shapeType !== "pr_review_file_node" ||
    !isNullableString(shape.parentShapeId) ||
    !isNullableString(shape.title) ||
    !isNullableString(shape.textContent) ||
    !isFiniteNumber(shape.x) ||
    !isFiniteNumber(shape.y) ||
    !isNullableFiniteNumber(shape.width) ||
    !isNullableFiniteNumber(shape.height) ||
    !isFiniteNumber(shape.rotation) ||
    !isFiniteNumber(shape.zIndex) ||
    !isRecord(shape.rawShape) ||
    typeof shape.contentHash !== "string" ||
    typeof shape.revision !== "number" ||
    !Number.isSafeInteger(shape.revision) ||
    shape.revision !== operation.resultRevision ||
    shape.contentHash !== operation.contentHash
  ) {
    return null;
  }

  return {
    id: shape.id,
    canvasId: shape.canvasId,
    parentShapeId: shape.parentShapeId,
    shapeType: shape.shapeType,
    title: shape.title,
    textContent: shape.textContent,
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
    rotation: shape.rotation,
    zIndex: shape.zIndex,
    rawShape: shape.rawShape,
    contentHash: shape.contentHash,
    revision: shape.revision
  };
}

export function buildPrReviewRelationEdgeGeometry(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number }
): PrReviewRelationEdgeGeometry {
  const fromCenterX = from.x + from.width / 2;
  const fromCenterY = from.y + from.height / 2;
  const toCenterX = to.x + to.width / 2;
  const toCenterY = to.y + to.height / 2;
  const dx = toCenterX - fromCenterX;
  const dy = toCenterY - fromCenterY;
  let startX: number;
  let startY: number;
  let endX: number;
  let endY: number;

  if (Math.abs(dx) >= Math.abs(dy)) {
    startX = dx >= 0 ? from.x + from.width : from.x;
    startY = fromCenterY;
    endX = dx >= 0 ? to.x : to.x + to.width;
    endY = toCenterY;
  } else {
    startX = fromCenterX;
    startY = dy >= 0 ? from.y + from.height : from.y;
    endX = toCenterX;
    endY = dy >= 0 ? to.y : to.y + to.height;
  }

  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const routePoints =
    startX === endX || startY === endY
      ? [
          { x: startX - x, y: startY - y },
          { x: endX - x, y: endY - y }
        ]
      : [
          { x: startX - x, y: startY - y },
          { x: startX + (endX - startX) / 2 - x, y: startY - y },
          { x: startX + (endX - startX) / 2 - x, y: endY - y },
          { x: endX - x, y: endY - y }
        ];

  return {
    x,
    y,
    width: Math.max(1, Math.abs(endX - startX)),
    height: Math.max(1, Math.abs(endY - startY)),
    startX: startX - x,
    startY: startY - y,
    endX: endX - x,
    endY: endY - y,
    routePoints
  };
}

function requireFinitePositiveNumber(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}
