export type CanvasPointerInteractionSnapshot = {
  currentToolId: string;
  isDragging: boolean;
  isPointing: boolean;
};

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
