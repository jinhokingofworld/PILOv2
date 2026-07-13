const FILE_NODE_DRAG_THRESHOLD = 5;

type Point = {
  x: number;
  y: number;
};

export type PrReviewFileNodeActivationGesture = {
  moved: boolean;
  reviewFileId: string;
  shapeId: string;
  startPointer: Point;
  startShapePosition: Point;
};

export function createPrReviewFileNodeActivationGesture({
  pointer,
  reviewFileId,
  shapeId,
  shapePosition
}: {
  pointer: Point;
  reviewFileId: string;
  shapeId: string;
  shapePosition: Point;
}): PrReviewFileNodeActivationGesture {
  return {
    moved: false,
    reviewFileId,
    shapeId,
    startPointer: pointer,
    startShapePosition: shapePosition
  };
}

export function updatePrReviewFileNodeActivationGesture(
  gesture: PrReviewFileNodeActivationGesture,
  pointer: Point
): PrReviewFileNodeActivationGesture {
  if (gesture.moved) {
    return gesture;
  }

  const deltaX = pointer.x - gesture.startPointer.x;
  const deltaY = pointer.y - gesture.startPointer.y;

  if (
    deltaX * deltaX + deltaY * deltaY <=
    FILE_NODE_DRAG_THRESHOLD * FILE_NODE_DRAG_THRESHOLD
  ) {
    return gesture;
  }

  return {
    ...gesture,
    moved: true
  };
}

export function shouldActivatePrReviewFileNode(
  gesture: PrReviewFileNodeActivationGesture,
  currentShapePosition: Point
) {
  return (
    !gesture.moved &&
    currentShapePosition.x === gesture.startShapePosition.x &&
    currentShapePosition.y === gesture.startShapePosition.y
  );
}
