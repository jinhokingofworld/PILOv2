export function shouldAcceptPersistedCanvasShape({
  deletedShapeIds,
  roomStateShapeIds,
  shapeId,
}: {
  deletedShapeIds: ReadonlySet<string>;
  roomStateShapeIds: ReadonlySet<string>;
  shapeId: string | null;
}) {
  return (
    shapeId === null ||
    (!deletedShapeIds.has(shapeId) && !roomStateShapeIds.has(shapeId))
  );
}

export function mergeCanvasRoomStateAndPersistedShapes<
  TShape extends { id?: unknown },
>({
  cachedShapes,
  deletedShapeIds,
  persistedShapes,
  roomStateShapeIds,
}: {
  cachedShapes: TShape[];
  deletedShapeIds: ReadonlySet<string>;
  persistedShapes: TShape[];
  roomStateShapeIds: ReadonlySet<string>;
}) {
  const mergedShapes = new Map<string, TShape>();
  const anonymousShapes: TShape[] = [];

  cachedShapes.forEach((shape) => {
    const shapeId = typeof shape.id === "string" ? shape.id : null;

    if (!shapeId) {
      anonymousShapes.push(shape);
      return;
    }
    if (deletedShapeIds.has(shapeId) || !roomStateShapeIds.has(shapeId)) {
      return;
    }

    mergedShapes.set(shapeId, shape);
  });

  persistedShapes.forEach((shape) => {
    const shapeId = typeof shape.id === "string" ? shape.id : null;

    if (!shapeId) {
      anonymousShapes.push(shape);
      return;
    }
    if (deletedShapeIds.has(shapeId) || roomStateShapeIds.has(shapeId)) {
      return;
    }

    mergedShapes.set(shapeId, shape);
  });

  return [...mergedShapes.values(), ...anonymousShapes];
}
