export type PrReviewFlowDragFileShape = {
  id: string;
  flowId: string;
  pinned: boolean;
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
