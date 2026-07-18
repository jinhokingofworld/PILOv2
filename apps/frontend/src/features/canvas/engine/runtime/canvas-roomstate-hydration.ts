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
