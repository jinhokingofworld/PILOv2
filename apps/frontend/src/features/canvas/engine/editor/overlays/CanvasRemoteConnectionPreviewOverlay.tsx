"use client";

import { useSyncExternalStore } from "react";
import { useEditor } from "tldraw";

import type { CanvasRemoteShapePreviewStore } from "@/features/canvas/collaboration/canvas-remote-shape-preview-store";
import {
  getRemoteConnectionPreviewPath,
  readRemoteConnectionPreviewShape,
  type CanvasPreviewPoint,
  type CanvasRemoteConnectionPreviewShape,
} from "./canvas-remote-connection-preview";
import {
  CANVAS_PREVIEW_SHAPE_COLORS,
  CANVAS_PREVIEW_STROKE_WIDTHS,
  getCanvasPreviewStrokeDash,
  getCanvasRemotePreviewShapePageTransform,
} from "./canvas-remote-preview-canvas";

type CanvasRemoteConnectionPreviewOverlayProps = {
  previewStore: CanvasRemoteShapePreviewStore;
};

type CanvasRemoteArrowheadPath = {
  fill: boolean;
  path: string;
};

type CanvasRemoteConnectionPath = {
  arrowheads: CanvasRemoteArrowheadPath[];
  color: string;
  dashArray?: string;
  id: string;
  opacity: number;
  path: string;
  strokeWidth: number;
};

function toSvgNumber(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function createSvgPolylinePath(points: CanvasPreviewPoint[]) {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${toSvgNumber(point.x)} ${toSvgNumber(point.y)}`,
    )
    .join(" ");
}

function createArrowheadPath({
  from,
  strokeWidth,
  tip,
  type,
}: {
  from: CanvasPreviewPoint;
  strokeWidth: number;
  tip: CanvasPreviewPoint;
  type: string;
}): CanvasRemoteArrowheadPath | null {
  if (type === "none") return null;

  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const arrowLength = Math.max(8, strokeWidth * 4);
  const spread = Math.PI / 7;
  const left = {
    x: tip.x - Math.cos(angle - spread) * arrowLength,
    y: tip.y - Math.sin(angle - spread) * arrowLength,
  };
  const right = {
    x: tip.x - Math.cos(angle + spread) * arrowLength,
    y: tip.y - Math.sin(angle + spread) * arrowLength,
  };

  return {
    fill: type === "triangle" || type === "arrow",
    path: `${createSvgPolylinePath([left, tip, right])}${
      type === "triangle" || type === "arrow" ? " Z" : ""
    }`,
  };
}

function createRemoteConnectionPath({
  actorUserId,
  editor,
  shape,
}: {
  actorUserId: string;
  editor: ReturnType<typeof useEditor>;
  shape: CanvasRemoteConnectionPreviewShape;
}): CanvasRemoteConnectionPath | null {
  if (shape.props.dash === "none") return null;

  const pageTransform = getCanvasRemotePreviewShapePageTransform(editor, shape);
  const strokeWidth =
    (CANVAS_PREVIEW_STROKE_WIDTHS[shape.props.size] ?? 2.75) *
    shape.props.scale;
  const toPagePoint = (point: CanvasPreviewPoint) =>
    pageTransform.applyToPoint(point);
  const previewPath = getRemoteConnectionPreviewPath(shape);
  let startPoint: CanvasPreviewPoint;
  let startDirectionPoint: CanvasPreviewPoint;
  let endPoint: CanvasPreviewPoint;
  let endDirectionPoint: CanvasPreviewPoint;
  let path: string;

  if (previewPath.kind === "quadratic") {
    startPoint = toPagePoint(previewPath.start);
    startDirectionPoint = toPagePoint(previewPath.control);
    endDirectionPoint = startDirectionPoint;
    endPoint = toPagePoint(previewPath.end);
    path = [
      `M ${toSvgNumber(startPoint.x)} ${toSvgNumber(startPoint.y)}`,
      `Q ${toSvgNumber(startDirectionPoint.x)} ${toSvgNumber(startDirectionPoint.y)}`,
      `${toSvgNumber(endPoint.x)} ${toSvgNumber(endPoint.y)}`,
    ].join(" ");
  } else {
    const points = previewPath.points.map(toPagePoint);
    if (!points.length) return null;

    startPoint = points[0];
    startDirectionPoint = points[1] ?? points[0];
    endPoint = points[points.length - 1];
    endDirectionPoint = points[points.length - 2] ?? endPoint;
    path = createSvgPolylinePath(points);
  }

  const arrowheads =
    shape.type === "arrow"
      ? [
          createArrowheadPath({
            from: startDirectionPoint,
            strokeWidth,
            tip: startPoint,
            type: shape.props.arrowheadStart,
          }),
          createArrowheadPath({
            from: endDirectionPoint,
            strokeWidth,
            tip: endPoint,
            type: shape.props.arrowheadEnd,
          }),
        ].filter((value): value is CanvasRemoteArrowheadPath => Boolean(value))
      : [];
  const dashArray = getCanvasPreviewStrokeDash(shape.props.dash, strokeWidth);

  return {
    arrowheads,
    color:
      CANVAS_PREVIEW_SHAPE_COLORS[shape.props.color] ??
      CANVAS_PREVIEW_SHAPE_COLORS.black,
    ...(dashArray.length ? { dashArray: dashArray.join(" ") } : {}),
    id: `${actorUserId}:${shape.id}`,
    opacity: shape.opacity * 0.9,
    path,
    strokeWidth,
  };
}

export function CanvasRemoteConnectionPreviewOverlay({
  previewStore,
}: CanvasRemoteConnectionPreviewOverlayProps) {
  const editor = useEditor();
  const previews = useSyncExternalStore(
    previewStore.subscribe,
    previewStore.getSnapshot,
    previewStore.getSnapshot,
  );
  const paths = previews.flatMap((preview) =>
    preview.shapes.flatMap((value) => {
      const shape = readRemoteConnectionPreviewShape(value);
      if (!shape) return [];

      const path = createRemoteConnectionPath({
        actorUserId: preview.actorUserId,
        editor,
        shape,
      });

      return path ? [path] : [];
    }),
  );

  return (
    <svg className="canvas-remote-connection-preview-layer" overflow="visible">
      {paths.map((path) => (
        <g key={path.id} opacity={path.opacity}>
          <path
            d={path.path}
            fill="none"
            stroke={path.color}
            strokeDasharray={path.dashArray}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={path.strokeWidth}
          />
          {path.arrowheads.map((arrowhead, index) => (
            <path
              key={`${path.id}:arrowhead:${index}`}
              d={arrowhead.path}
              fill={arrowhead.fill ? path.color : "none"}
              stroke={path.color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={path.strokeWidth}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
