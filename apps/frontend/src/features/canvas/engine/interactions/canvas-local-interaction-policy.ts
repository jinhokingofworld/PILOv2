export type CanvasPointerInteractionSnapshot = {
  currentToolId: string;
  isDragging: boolean;
  isPointing: boolean;
};

export type CanvasMutationInteractionSnapshot =
  CanvasPointerInteractionSnapshot & {
    editingShapeId: string | null;
    selectedShapeIds: readonly string[];
  };

const canvasSelectMutationToolIds = [
  "select.pointing_shape",
  "select.pointing_handle",
  "select.translating",
  "select.resizing",
  "select.rotating",
  "select.dragging_handle",
  "select.crop",
  "select.cropping",
] as const;

export function isCanvasFreehandToolId(toolId: string) {
  return toolId.includes("draw") || toolId.includes("highlight");
}

export function isCanvasFreehandInteractionActive({
  currentToolId,
  isDragging,
  isPointing,
}: CanvasPointerInteractionSnapshot) {
  return isCanvasFreehandToolId(currentToolId) && (isPointing || isDragging);
}

export function isCanvasShapeMutationInteractionActive({
  currentToolId,
  isDragging,
  isPointing,
}: CanvasPointerInteractionSnapshot) {
  if (!isDragging && !isPointing) return false;
  if (isCanvasFreehandToolId(currentToolId)) return true;

  return canvasSelectMutationToolIds.some(
    (toolId) => currentToolId === toolId || currentToolId.startsWith(`${toolId}.`),
  );
}

export function getCanvasActiveMutationShapeIds({
  currentToolId,
  editingShapeId,
  isDragging,
  isPointing,
  selectedShapeIds,
}: CanvasMutationInteractionSnapshot) {
  const activeShapeIds = new Set<string>();

  if (editingShapeId) {
    activeShapeIds.add(editingShapeId);
  }

  if (
    isCanvasShapeMutationInteractionActive({
      currentToolId,
      isDragging,
      isPointing,
    })
  ) {
    selectedShapeIds.forEach((shapeId) => activeShapeIds.add(shapeId));
  }

  return Array.from(activeShapeIds);
}
