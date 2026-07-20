export function resolveCanvasShapeParentId({
  parentShapeId,
  rawParentId,
  shapeId,
}: {
  parentShapeId: unknown;
  rawParentId: unknown;
  shapeId: string;
}) {
  if (
    typeof parentShapeId === "string" &&
    parentShapeId.startsWith("shape:") &&
    parentShapeId !== shapeId
  ) {
    return parentShapeId;
  }

  if (
    typeof rawParentId === "string" &&
    rawParentId.startsWith("shape:") &&
    rawParentId !== shapeId
  ) {
    return rawParentId;
  }

  return null;
}
