import { isDeepStrictEqual } from "node:util";
import { forbidden } from "../../common/api-error";
import type { CanvasShapeRow, ShapeWriteValues } from "./canvas.types";

export const PR_REVIEW_FILE_NODE_SHAPE_TYPE = "pr_review_file_node";
export const PR_REVIEW_RELATION_EDGE_SHAPE_TYPE = "pr_review_relation_edge";

const PR_REVIEW_SYSTEM_SHAPE_TYPES = new Set([
  PR_REVIEW_FILE_NODE_SHAPE_TYPE,
  PR_REVIEW_RELATION_EDGE_SHAPE_TYPE
]);

export function isPrReviewSystemShapeType(shapeType: string): boolean {
  return PR_REVIEW_SYSTEM_SHAPE_TYPES.has(shapeType);
}

export function assertUserCanCreateCanvasShape(shapeType: string): void {
  if (isPrReviewSystemShapeType(shapeType)) {
    throw forbidden("PR Review system shapes can only be created by PR Review");
  }
}

export function prepareUserCanvasShapeUpdate(
  currentShape: CanvasShapeRow,
  values: ShapeWriteValues
): ShapeWriteValues {
  if (
    currentShape.shape_type !== PR_REVIEW_FILE_NODE_SHAPE_TYPE &&
    currentShape.shape_type !== PR_REVIEW_RELATION_EDGE_SHAPE_TYPE
  ) {
    if (
      values.shapeType !== undefined &&
      isPrReviewSystemShapeType(values.shapeType)
    ) {
      throw forbidden("Canvas shapes cannot be changed into PR Review system shapes");
    }

    return values;
  }

  if (currentShape.shape_type === PR_REVIEW_RELATION_EDGE_SHAPE_TYPE) {
    throw forbidden("PR Review relation edges cannot be changed by users");
  }

  assertUnchanged(values.shapeType, currentShape.shape_type);
  assertUnchanged(values.title, currentShape.title);
  assertUnchanged(values.textContent, currentShape.text_content);
  assertUnchanged(values.rotation, Number(currentShape.rotation));

  if (
    values.rawShape !== undefined &&
    !hasSameProtectedFileNodeRawShape(
      currentShape.raw_shape,
      values.rawShape
    )
  ) {
    throw forbidden("PR Review file node system fields cannot be changed by users");
  }

  if (values.width === null || values.height === null) {
    throw forbidden("PR Review file node size cannot be null");
  }

  return {
    ...values,
    rawShape: mergeFileNodeLayout(currentShape.raw_shape, values)
  };
}

export function assertUserCanDeleteCanvasShape(
  currentShape: CanvasShapeRow
): void {
  if (isPrReviewSystemShapeType(currentShape.shape_type)) {
    throw forbidden("PR Review system shapes cannot be deleted by users");
  }
}

function assertUnchanged<T>(nextValue: T | undefined, currentValue: T): void {
  if (nextValue !== undefined && !isDeepStrictEqual(nextValue, currentValue)) {
    throw forbidden("PR Review file node system fields cannot be changed by users");
  }
}

function hasSameProtectedFileNodeRawShape(
  currentRawShape: Record<string, unknown>,
  nextRawShape: Record<string, unknown>
): boolean {
  return isDeepStrictEqual(
    omitFileNodeLayout(currentRawShape),
    omitFileNodeLayout(nextRawShape)
  );
}

function omitFileNodeLayout(
  rawShape: Record<string, unknown>
): Record<string, unknown> {
  const protectedShape = { ...rawShape };
  delete protectedShape.x;
  delete protectedShape.y;
  delete protectedShape.parentId;
  delete protectedShape.index;

  if (isRecord(protectedShape.props)) {
    const protectedProps = { ...protectedShape.props };
    delete protectedProps.w;
    delete protectedProps.h;
    protectedShape.props = protectedProps;
  }

  return protectedShape;
}

function mergeFileNodeLayout(
  currentRawShape: Record<string, unknown>,
  values: ShapeWriteValues
): Record<string, unknown> {
  const rawShape = { ...currentRawShape };
  const currentProps = isRecord(currentRawShape.props)
    ? currentRawShape.props
    : {};
  const nextRawShape = values.rawShape;
  const nextProps = isRecord(nextRawShape?.props) ? nextRawShape.props : {};
  const props = { ...currentProps };

  if (values.x !== undefined) rawShape.x = values.x;
  if (values.y !== undefined) rawShape.y = values.y;

  if (values.parentShapeId !== undefined) {
    if (values.parentShapeId === null) {
      delete rawShape.parentId;
    } else {
      rawShape.parentId = values.parentShapeId;
    }
  }

  if (values.zIndex !== undefined && typeof nextRawShape?.index === "string") {
    rawShape.index = nextRawShape.index;
  }

  if (values.width !== undefined) props.w = values.width;
  if (values.height !== undefined) props.h = values.height;

  rawShape.props = props;
  return rawShape;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
