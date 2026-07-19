export type PrReviewFlowDragFileShape = {
  id: string;
  flowId: string;
  pinned: boolean;
};

export type PrReviewFlowPositionedFileShape = {
  flowId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function getPrReviewFlowDragShapeIds({
  fileShapes,
  flowId,
  flowLabelShapeId
}: {
  fileShapes: readonly PrReviewFlowDragFileShape[];
  flowId: string;
  flowLabelShapeId: string;
}) {
  return [
    flowLabelShapeId,
    ...fileShapes
      .filter((shape) => shape.flowId === flowId)
      .map((shape) => shape.id)
  ];
}

export function getPrReviewFlowFileBounds({
  fileShapes,
  flowId
}: {
  fileShapes: readonly PrReviewFlowPositionedFileShape[];
  flowId: string;
}) {
  const members = fileShapes.filter((shape) => shape.flowId === flowId);
  if (members.length === 0) {
    return null;
  }

  return {
    left: Math.min(...members.map((shape) => shape.x)),
    top: Math.min(...members.map((shape) => shape.y)),
    right: Math.max(...members.map((shape) => shape.x + shape.width))
  };
}
