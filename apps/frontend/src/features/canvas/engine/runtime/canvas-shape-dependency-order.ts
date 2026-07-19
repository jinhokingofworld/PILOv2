type CanvasShapeDependency = {
  id?: unknown;
  parentId?: unknown;
};

function isShapeParentId(parentId: unknown): parentId is string {
  return typeof parentId === "string" && parentId.startsWith("shape:");
}

export function orderCanvasShapesByParentDependency<
  TShape extends CanvasShapeDependency,
>({
  candidateShapes,
  visibleShapeIds,
}: {
  candidateShapes: TShape[];
  visibleShapeIds: ReadonlySet<string>;
}) {
  const remainingShapes = new Map(
    candidateShapes.flatMap((shape) =>
      typeof shape.id === "string" ? [[shape.id, shape] as const] : []
    ),
  );
  const availableShapeIds = new Set(visibleShapeIds);
  const orderedShapeIds: string[] = [];
  let appliedInPass = true;

  while (remainingShapes.size && appliedInPass) {
    appliedInPass = false;

    remainingShapes.forEach((shape, shapeId) => {
      if (
        isShapeParentId(shape.parentId) &&
        !availableShapeIds.has(shape.parentId)
      ) {
        return;
      }

      remainingShapes.delete(shapeId);
      availableShapeIds.add(shapeId);
      orderedShapeIds.push(shapeId);
      appliedInPass = true;
    });
  }

  return {
    orderedShapeIds,
    unresolvedShapeIds: [...remainingShapes.keys()],
  };
}
