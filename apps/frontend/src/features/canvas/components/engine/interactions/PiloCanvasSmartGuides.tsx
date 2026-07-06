"use client";

import { useEditor, type Editor, type TLShape } from "tldraw";
import { useValue } from "@tldraw/state-react";
import { isPiloSnapShape, type PiloSnapShape } from "../shapes/PiloCanvasShapeGuards";

const PILO_SMART_GUIDE_SCREEN_THRESHOLD = 7;
const PILO_SMART_GUIDE_PADDING = 56;

type PiloSnapAnchor = "start" | "center" | "end";

type PiloSmartGuide = {
  axis: "x" | "y";
  value: number;
  start: number;
  end: number;
  anchor: PiloSnapAnchor;
};

type PiloSnapBounds = {
  id: string;
  left: number;
  centerX: number;
  right: number;
  top: number;
  centerY: number;
  bottom: number;
  width: number;
  height: number;
  isCanvasCenter?: boolean;
};

type PiloSnapMatch = PiloSmartGuide & {
  delta: number;
};

type PiloSizeSnapMatch = {
  axis: "x" | "y";
  size: number;
};

function getPiloSnapBounds(shape: PiloSnapShape): PiloSnapBounds {
  const props = shape.props as { w: number; h: number };

  return {
    id: shape.id,
    left: shape.x,
    centerX: shape.x + props.w / 2,
    right: shape.x + props.w,
    top: shape.y,
    centerY: shape.y + props.h / 2,
    bottom: shape.y + props.h,
    width: props.w,
    height: props.h,
  };
}

function getPiloPageBoundsCandidate(
  editor: Editor,
  shape: PiloSnapShape,
): PiloSnapBounds | null {
  const bounds = editor.getShapePageBounds(shape.id);

  if (!bounds) return null;

  return {
    id: shape.id,
    left: bounds.x,
    centerX: bounds.x + bounds.w / 2,
    right: bounds.x + bounds.w,
    top: bounds.y,
    centerY: bounds.y + bounds.h / 2,
    bottom: bounds.y + bounds.h,
    width: bounds.w,
    height: bounds.h,
  };
}

function getViewportCenterSnapCandidate(editor: Editor): PiloSnapBounds {
  const viewport = editor.getViewportScreenBounds();
  const topLeft = editor.screenToPage({
    x: viewport.x,
    y: viewport.y,
  });
  const bottomRight = editor.screenToPage({
    x: viewport.x + viewport.w,
    y: viewport.y + viewport.h,
  });
  const center = editor.screenToPage({
    x: viewport.x + viewport.w / 2,
    y: viewport.y + viewport.h / 2,
  });

  return {
    id: "pilo-canvas-center",
    left: center.x,
    centerX: center.x,
    right: center.x,
    top: topLeft.y,
    centerY: center.y,
    bottom: bottomRight.y,
    width: 0,
    height: 0,
    isCanvasCenter: true,
  };
}

function getPiloSnapCandidates(editor: Editor, activeShapeId: string) {
  const candidates = editor
    .getCurrentPageShapes()
    .filter(
      (shape): shape is PiloSnapShape =>
        shape.id !== activeShapeId && isPiloSnapShape(shape),
    )
    .map((shape) => getPiloPageBoundsCandidate(editor, shape))
    .filter((bounds): bounds is PiloSnapBounds => Boolean(bounds));

  candidates.push(getViewportCenterSnapCandidate(editor));

  return candidates;
}

function getSnapThreshold(editor: Editor) {
  return PILO_SMART_GUIDE_SCREEN_THRESHOLD / editor.getCamera().z;
}

function getXAnchors(bounds: PiloSnapBounds) {
  if (bounds.isCanvasCenter) {
    return [{ anchor: "center" as const, value: bounds.centerX }];
  }

  return [
    { anchor: "start" as const, value: bounds.left },
    { anchor: "center" as const, value: bounds.centerX },
    { anchor: "end" as const, value: bounds.right },
  ];
}

function getYAnchors(bounds: PiloSnapBounds) {
  if (bounds.isCanvasCenter) {
    return [{ anchor: "center" as const, value: bounds.centerY }];
  }

  return [
    { anchor: "start" as const, value: bounds.top },
    { anchor: "center" as const, value: bounds.centerY },
    { anchor: "end" as const, value: bounds.bottom },
  ];
}

function findClosestSnapMatch(
  activeBounds: PiloSnapBounds,
  candidates: PiloSnapBounds[],
  axis: "x" | "y",
  threshold: number,
): PiloSnapMatch | null {
  const activeAnchors =
    axis === "x" ? getXAnchors(activeBounds) : getYAnchors(activeBounds);
  let closest: PiloSnapMatch | null = null;

  for (const candidate of candidates) {
    const candidateAnchors =
      axis === "x" ? getXAnchors(candidate) : getYAnchors(candidate);

    for (const activeAnchor of activeAnchors) {
      for (const candidateAnchor of candidateAnchors) {
        const delta = candidateAnchor.value - activeAnchor.value;
        const distance = Math.abs(delta);

        if (distance > threshold) continue;
        if (closest && distance >= Math.abs(closest.delta)) continue;

        closest = {
          axis,
          value: candidateAnchor.value,
          delta,
          anchor: activeAnchor.anchor,
          start:
            axis === "x"
              ? Math.min(activeBounds.top, candidate.top) -
                PILO_SMART_GUIDE_PADDING
              : Math.min(activeBounds.left, candidate.left) -
                PILO_SMART_GUIDE_PADDING,
          end:
            axis === "x"
              ? Math.max(activeBounds.bottom, candidate.bottom) +
                PILO_SMART_GUIDE_PADDING
              : Math.max(activeBounds.right, candidate.right) +
                PILO_SMART_GUIDE_PADDING,
        };
      }
    }
  }

  return closest;
}

function findClosestSizeSnapMatch(
  activeBounds: PiloSnapBounds,
  candidates: PiloSnapBounds[],
  axis: "x" | "y",
  threshold: number,
): PiloSizeSnapMatch | null {
  const activeSize = axis === "x" ? activeBounds.width : activeBounds.height;
  let closest: PiloSizeSnapMatch | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate.isCanvasCenter) continue;

    const candidateSize = axis === "x" ? candidate.width : candidate.height;
    const distance = Math.abs(candidateSize - activeSize);

    if (distance > threshold || distance >= closestDistance) continue;

    closest = {
      axis,
      size: candidateSize,
    };
    closestDistance = distance;
  }

  return closest;
}

function findClosestDistributionSnapMatch(
  activeBounds: PiloSnapBounds,
  candidates: PiloSnapBounds[],
  axis: "x" | "y",
  threshold: number,
): PiloSnapMatch | null {
  const realCandidates = candidates
    .filter((candidate) => !candidate.isCanvasCenter)
    .sort((a, b) => (axis === "x" ? a.left - b.left : a.top - b.top));
  let closest: PiloSnapMatch | null = null;

  for (let index = 0; index < realCandidates.length - 1; index += 1) {
    const before = realCandidates[index];
    const after = realCandidates[index + 1];
    const gapStart = axis === "x" ? before.right : before.bottom;
    const gapEnd = axis === "x" ? after.left : after.top;
    const activeSize = axis === "x" ? activeBounds.width : activeBounds.height;
    const availableGap = gapEnd - gapStart;

    if (availableGap < activeSize + 16) continue;

    const targetStart = gapStart + (availableGap - activeSize) / 2;
    const activeStart = axis === "x" ? activeBounds.left : activeBounds.top;
    const delta = targetStart - activeStart;
    const distance = Math.abs(delta);

    if (distance > threshold) continue;
    if (closest && distance >= Math.abs(closest.delta)) continue;

    closest = {
      axis,
      value: targetStart + activeSize / 2,
      delta,
      anchor: "center",
      start:
        axis === "x"
          ? Math.min(before.top, activeBounds.top, after.top) -
            PILO_SMART_GUIDE_PADDING
          : Math.min(before.left, activeBounds.left, after.left) -
            PILO_SMART_GUIDE_PADDING,
      end:
        axis === "x"
          ? Math.max(before.bottom, activeBounds.bottom, after.bottom) +
            PILO_SMART_GUIDE_PADDING
          : Math.max(before.right, activeBounds.right, after.right) +
            PILO_SMART_GUIDE_PADDING,
    };
  }

  return closest;
}

function pickClosestSnapMatch(
  first: PiloSnapMatch | null,
  second: PiloSnapMatch | null,
) {
  if (!first) return second;
  if (!second) return first;

  return Math.abs(first.delta) <= Math.abs(second.delta) ? first : second;
}

function applyAxisSnapToShape(
  shape: PiloSnapShape,
  prevShape: PiloSnapShape,
  snap: PiloSnapMatch | null,
  axis: "x" | "y",
) {
  if (!snap || Math.abs(snap.delta) < 0.001) return shape;

  const props = shape.props as { w: number; h: number };
  const prevProps = prevShape.props as { w: number; h: number };
  const nextShape = { ...shape, props: { ...shape.props } } as PiloSnapShape;
  const nextProps = nextShape.props as { w: number; h: number };

  if (axis === "x") {
    const isMoving = shape.x !== prevShape.x;
    const isResizing = props.w !== prevProps.w;

    if (isResizing && snap.anchor === "start") {
      nextShape.x = shape.x + snap.delta;
      nextProps.w = Math.max(40, props.w - snap.delta);
    } else if (isResizing && snap.anchor === "end") {
      nextProps.w = Math.max(40, props.w + snap.delta);
    } else if (isMoving || !isResizing) {
      nextShape.x = shape.x + snap.delta;
    }

    return nextShape;
  }

  const isMoving = shape.y !== prevShape.y;
  const isResizing = props.h !== prevProps.h;

  if (isResizing && snap.anchor === "start") {
    nextShape.y = shape.y + snap.delta;
    nextProps.h = Math.max(40, props.h - snap.delta);
  } else if (isResizing && snap.anchor === "end") {
    nextProps.h = Math.max(40, props.h + snap.delta);
  } else if (isMoving || !isResizing) {
    nextShape.y = shape.y + snap.delta;
  }

  return nextShape;
}

function applySizeSnapToShape(
  shape: PiloSnapShape,
  prevShape: PiloSnapShape,
  snap: PiloSizeSnapMatch | null,
) {
  if (!snap) return shape;

  const props = shape.props as { w: number; h: number };
  const prevProps = prevShape.props as { w: number; h: number };
  const nextShape = { ...shape, props: { ...shape.props } } as PiloSnapShape;
  const nextProps = nextShape.props as { w: number; h: number };

  if (snap.axis === "x") {
    if (props.w === prevProps.w) return shape;

    if (shape.x !== prevShape.x) {
      nextShape.x = shape.x + props.w - snap.size;
    }

    nextProps.w = Math.max(40, snap.size);
    return nextShape;
  }

  if (props.h === prevProps.h) return shape;

  if (shape.y !== prevShape.y) {
    nextShape.y = shape.y + props.h - snap.size;
  }

  nextProps.h = Math.max(40, snap.size);
  return nextShape;
}

export function applyPiloSmartSnap(
  editor: Editor,
  prevShape: TLShape,
  nextShape: TLShape,
) {
  if (!isPiloSnapShape(prevShape) || !isPiloSnapShape(nextShape)) {
    return nextShape;
  }
  if (nextShape.isLocked) return nextShape;

  const selectedShapeIds = editor.getSelectedShapeIds();

  if (selectedShapeIds.length !== 1 || selectedShapeIds[0] !== nextShape.id) {
    return nextShape;
  }

  const props = nextShape.props as { w: number; h: number };
  const prevProps = prevShape.props as { w: number; h: number };
  const changed =
    nextShape.x !== prevShape.x ||
    nextShape.y !== prevShape.y ||
    props.w !== prevProps.w ||
    props.h !== prevProps.h;

  if (!changed) return nextShape;

  const candidates = getPiloSnapCandidates(editor, nextShape.id);

  if (!candidates.length) return nextShape;

  const threshold = getSnapThreshold(editor);
  const activeBounds = getPiloSnapBounds(nextShape);
  const widthSnap = findClosestSizeSnapMatch(
    activeBounds,
    candidates,
    "x",
    threshold,
  );
  const widthSnappedShape = applySizeSnapToShape(
    nextShape,
    prevShape,
    widthSnap,
  );
  const heightSnap = findClosestSizeSnapMatch(
    getPiloSnapBounds(widthSnappedShape),
    candidates,
    "y",
    threshold,
  );
  const sizeSnappedShape = applySizeSnapToShape(
    widthSnappedShape,
    prevShape,
    heightSnap,
  );
  const sizeSnappedBounds = getPiloSnapBounds(sizeSnappedShape);
  const isResizing = props.w !== prevProps.w || props.h !== prevProps.h;
  const xSnap = pickClosestSnapMatch(
    findClosestSnapMatch(sizeSnappedBounds, candidates, "x", threshold),
    isResizing
      ? null
      : findClosestDistributionSnapMatch(
          sizeSnappedBounds,
          candidates,
          "x",
          threshold,
        ),
  );
  const xSnappedShape = applyAxisSnapToShape(
    sizeSnappedShape,
    prevShape,
    xSnap,
    "x",
  );
  const ySnap = findClosestSnapMatch(
    getPiloSnapBounds(xSnappedShape),
    candidates,
    "y",
    threshold,
  );

  return applyAxisSnapToShape(
    xSnappedShape,
    prevShape,
    pickClosestSnapMatch(
      ySnap,
      isResizing
        ? null
        : findClosestDistributionSnapMatch(
            getPiloSnapBounds(xSnappedShape),
            candidates,
            "y",
            threshold,
          ),
    ),
    "y",
  );
}

function getPiloSmartGuides(editor: Editor): PiloSmartGuide[] {
  if (!(editor.inputs.getIsDragging() || editor.inputs.getIsPointing())) {
    return [];
  }

  const selectedShapeIds = editor.getSelectedShapeIds();

  if (selectedShapeIds.length !== 1) return [];

  const selectedShape = editor.getShape(selectedShapeIds[0]);

  if (!isPiloSnapShape(selectedShape)) return [];

  const candidates = getPiloSnapCandidates(editor, selectedShape.id);
  const threshold = getSnapThreshold(editor);
  const activeBounds = getPiloSnapBounds(selectedShape);
  const xSnap = pickClosestSnapMatch(
    findClosestSnapMatch(activeBounds, candidates, "x", threshold),
    findClosestDistributionSnapMatch(activeBounds, candidates, "x", threshold),
  );
  const ySnap = pickClosestSnapMatch(
    findClosestSnapMatch(activeBounds, candidates, "y", threshold),
    findClosestDistributionSnapMatch(activeBounds, candidates, "y", threshold),
  );

  return [xSnap, ySnap].filter((guide): guide is PiloSnapMatch =>
    Boolean(guide),
  );
}

export function SmartGuidesOverlay() {
  const editor = useEditor();
  const guideLines = useValue(
    "pilo-smart-guides",
    () =>
      getPiloSmartGuides(editor).map((guide, index) => {
        if (guide.axis === "x") {
          const start = editor.pageToViewport({
            x: guide.value,
            y: guide.start,
          });
          const end = editor.pageToViewport({
            x: guide.value,
            y: guide.end,
          });

          return {
            key: `${guide.axis}:${guide.value}:${index}`,
            className: "is-vertical",
            left: start.x,
            top: Math.min(start.y, end.y),
            width: 1,
            height: Math.max(1, Math.abs(end.y - start.y)),
          };
        }

        const start = editor.pageToViewport({
          x: guide.start,
          y: guide.value,
        });
        const end = editor.pageToViewport({
          x: guide.end,
          y: guide.value,
        });

        return {
          key: `${guide.axis}:${guide.value}:${index}`,
          className: "is-horizontal",
          left: Math.min(start.x, end.x),
          top: start.y,
          width: Math.max(1, Math.abs(end.x - start.x)),
          height: 1,
        };
      }),
    [editor],
  );

  if (!guideLines.length) return null;

  return (
    <div className="pilo-smart-guides" aria-hidden="true">
      {guideLines.map((guide) => (
        <span
          key={guide.key}
          className={`pilo-smart-guide ${guide.className}`}
          style={{
            left: guide.left,
            top: guide.top,
            width: guide.width,
            height: guide.height,
          }}
        />
      ))}
    </div>
  );
}
