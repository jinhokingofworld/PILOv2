"use client";

import type { Editor } from "tldraw";

export type PiloCanvasPlacementPoint = {
  x: number;
  y: number;
};

export type PiloCanvasPlacementSize = {
  height: number;
  width: number;
};

export type PiloCanvasPlacementBounds = PiloCanvasPlacementPoint &
  PiloCanvasPlacementSize;

const CANVAS_EMPTY_PLACEMENT_GAP_SCREEN_PX = 32;
const CANVAS_EMPTY_PLACEMENT_EDGE_SCREEN_PX = 16;

function intersectsBounds(
  first: PiloCanvasPlacementBounds,
  second: PiloCanvasPlacementBounds,
) {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

function getIntersectionArea(
  first: PiloCanvasPlacementBounds,
  second: PiloCanvasPlacementBounds,
) {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) -
      Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) -
      Math.max(first.y, second.y),
  );

  return width * height;
}

function expandBounds(bounds: PiloCanvasPlacementBounds, amount: number) {
  return {
    height: bounds.height + amount * 2,
    width: bounds.width + amount * 2,
    x: bounds.x - amount,
    y: bounds.y - amount,
  };
}

function toPlacementBounds(
  point: PiloCanvasPlacementPoint,
  size: PiloCanvasPlacementSize,
) {
  return {
    height: size.height,
    width: size.width,
    x: point.x - size.width / 2,
    y: point.y - size.height / 2,
  };
}

function isInsideBounds(
  candidate: PiloCanvasPlacementBounds,
  container: PiloCanvasPlacementBounds,
) {
  return (
    candidate.x >= container.x &&
    candidate.y >= container.y &&
    candidate.x + candidate.width <= container.x + container.width &&
    candidate.y + candidate.height <= container.y + container.height
  );
}

function createCandidatePoints({
  edgePadding,
  gap,
  size,
  viewport,
}: {
  edgePadding: number;
  gap: number;
  size: PiloCanvasPlacementSize;
  viewport: PiloCanvasPlacementBounds;
}) {
  const center = {
    x: viewport.x + viewport.width / 2,
    y: viewport.y + viewport.height / 2,
  };
  const innerViewport = {
    height: Math.max(0, viewport.height - edgePadding * 2),
    width: Math.max(0, viewport.width - edgePadding * 2),
    x: viewport.x + edgePadding,
    y: viewport.y + edgePadding,
  };

  if (size.width > innerViewport.width || size.height > innerViewport.height) {
    return [center];
  }

  const stepX = size.width + gap;
  const stepY = size.height + gap;
  const maxColumn = Math.ceil(innerViewport.width / stepX) + 1;
  const maxRow = Math.ceil(innerViewport.height / stepY) + 1;
  const points = new Map<string, PiloCanvasPlacementPoint>();

  function addPoint(point: PiloCanvasPlacementPoint) {
    const bounds = toPlacementBounds(point, size);
    if (!isInsideBounds(bounds, innerViewport)) return;

    points.set(`${point.x.toFixed(3)}:${point.y.toFixed(3)}`, point);
  }

  addPoint(center);

  for (let row = -maxRow; row <= maxRow; row += 1) {
    for (let column = -maxColumn; column <= maxColumn; column += 1) {
      addPoint({
        x: center.x + column * stepX,
        y: center.y + row * stepY,
      });
    }
  }

  const firstCenterX = innerViewport.x + size.width / 2;
  const firstCenterY = innerViewport.y + size.height / 2;

  for (
    let y = firstCenterY;
    y <= innerViewport.y + innerViewport.height - size.height / 2;
    y += stepY
  ) {
    for (
      let x = firstCenterX;
      x <= innerViewport.x + innerViewport.width - size.width / 2;
      x += stepX
    ) {
      addPoint({ x, y });
    }
  }

  return Array.from(points.values()).sort((left, right) => {
    const leftDistance = Math.hypot(left.x - center.x, left.y - center.y);
    const rightDistance = Math.hypot(right.x - center.x, right.y - center.y);

    return leftDistance - rightDistance || left.y - right.y || left.x - right.x;
  });
}

export function findPiloCanvasEmptyPlacement({
  edgePadding = 0,
  gap,
  occupiedBounds,
  size,
  viewport,
}: {
  edgePadding?: number;
  gap: number;
  occupiedBounds: readonly PiloCanvasPlacementBounds[];
  size: PiloCanvasPlacementSize;
  viewport: PiloCanvasPlacementBounds;
}) {
  const candidates = createCandidatePoints({
    edgePadding,
    gap,
    size,
    viewport,
  });
  const visibleOccupiedBounds = occupiedBounds
    .filter((bounds) => intersectsBounds(bounds, viewport))
    .map((bounds) => expandBounds(bounds, gap / 2));

  for (const point of candidates) {
    const candidateBounds = toPlacementBounds(point, size);

    if (
      visibleOccupiedBounds.every(
        (occupied) => !intersectsBounds(candidateBounds, occupied),
      )
    ) {
      return point;
    }
  }

  return (
    candidates
      .map((point) => ({
        overlap: visibleOccupiedBounds.reduce(
          (total, occupied) =>
            total + getIntersectionArea(toPlacementBounds(point, size), occupied),
          0,
        ),
        point,
      }))
      .sort((left, right) => left.overlap - right.overlap)[0]?.point ?? {
      x: viewport.x + viewport.width / 2,
      y: viewport.y + viewport.height / 2,
    }
  );
}

export function findPiloCanvasEmptyPlacementForEditor(
  editor: Editor,
  size: PiloCanvasPlacementSize,
) {
  const viewport = editor.getViewportPageBounds();
  const zoom = Math.max(0.01, editor.getCamera().z);
  const occupiedBounds = editor.getCurrentPageShapes().flatMap((shape) => {
    const bounds = editor.getShapePageBounds(shape);

    return bounds
      ? [
          {
            height: bounds.h,
            width: bounds.w,
            x: bounds.x,
            y: bounds.y,
          },
        ]
      : [];
  });

  return findPiloCanvasEmptyPlacement({
    edgePadding: CANVAS_EMPTY_PLACEMENT_EDGE_SCREEN_PX / zoom,
    gap: CANVAS_EMPTY_PLACEMENT_GAP_SCREEN_PX / zoom,
    occupiedBounds,
    size,
    viewport: {
      height: viewport.h,
      width: viewport.w,
      x: viewport.x,
      y: viewport.y,
    },
  });
}
