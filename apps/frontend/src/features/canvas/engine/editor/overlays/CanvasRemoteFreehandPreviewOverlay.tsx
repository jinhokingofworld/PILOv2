"use client";

import { useSyncExternalStore } from "react";
import { b64Vecs, useEditor } from "tldraw";

import type { CanvasRemoteShapePreviewStore } from "@/features/canvas/collaboration/canvas-remote-shape-preview-store";
import {
  CANVAS_PREVIEW_SHAPE_COLORS,
  CANVAS_PREVIEW_STROKE_WIDTHS,
  getCanvasPreviewStrokeDash,
  getCanvasRemotePreviewShapePageTransform,
} from "./canvas-remote-preview-canvas";

type CanvasRemoteFreehandPreviewOverlayProps = {
  previewStore: CanvasRemoteShapePreviewStore;
};

type CanvasRemoteFreehandShape = {
  id: string;
  opacity: number;
  parentId: string;
  rotation: number;
  type: "draw" | "highlight";
  x: number;
  y: number;
  props: {
    color: string;
    dash: string;
    scale: number;
    scaleX: number;
    scaleY: number;
    segments: Array<{
      path: string;
      type: string;
    }>;
    size: string;
  };
};

type CanvasRemoteFreehandPath = {
  color: string;
  dashArray?: string;
  id: string;
  opacity: number;
  path: string | null;
  point: { x: number; y: number } | null;
  strokeWidth: number;
};

const CANVAS_HIGHLIGHT_STROKE_WIDTHS: Record<string, number> = {
  l: 32,
  m: 24,
  s: 18,
  xl: 42,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function readRemoteFreehandShape(
  value: unknown,
): CanvasRemoteFreehandShape | null {
  if (!isRecord(value) || (value.type !== "draw" && value.type !== "highlight")) {
    return null;
  }

  const props = isRecord(value.props) ? value.props : null;
  const segments = Array.isArray(props?.segments)
    ? props.segments.flatMap((segment) => {
        if (!isRecord(segment) || typeof segment.path !== "string") return [];

        return [
          {
            path: segment.path,
            type: typeof segment.type === "string" ? segment.type : "free",
          },
        ];
      })
    : [];

  if (typeof value.id !== "string" || !props || !segments.length) {
    return null;
  }

  return {
    id: value.id,
    opacity: Math.min(1, Math.max(0, readFiniteNumber(value.opacity, 1))),
    parentId: typeof value.parentId === "string" ? value.parentId : "",
    props: {
      color: typeof props.color === "string" ? props.color : "black",
      dash: typeof props.dash === "string" ? props.dash : "draw",
      scale: Math.max(0.01, readFiniteNumber(props.scale, 1)),
      scaleX: readFiniteNumber(props.scaleX, 1),
      scaleY: readFiniteNumber(props.scaleY, 1),
      segments,
      size: typeof props.size === "string" ? props.size : "m",
    },
    rotation: readFiniteNumber(value.rotation, 0),
    type: value.type,
    x: readFiniteNumber(value.x, 0),
    y: readFiniteNumber(value.y, 0),
  };
}

function toSvgNumber(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function createRemoteFreehandPath({
  actorUserId,
  editor,
  shape,
}: {
  actorUserId: string;
  editor: ReturnType<typeof useEditor>;
  shape: CanvasRemoteFreehandShape;
}): CanvasRemoteFreehandPath | null {
  if (shape.props.dash === "none") return null;

  const pageTransform = getCanvasRemotePreviewShapePageTransform(editor, shape);
  const baseStrokeWidth =
    shape.type === "highlight"
      ? (CANVAS_HIGHLIGHT_STROKE_WIDTHS[shape.props.size] ?? 24)
      : (CANVAS_PREVIEW_STROKE_WIDTHS[shape.props.size] ?? 2.75);
  const strokeWidth = baseStrokeWidth * shape.props.scale;
  const points = shape.props.segments.flatMap((segment) => {
    try {
      return b64Vecs.decodePoints(segment.path).map((point) =>
        pageTransform.applyToPoint({
          x: point.x * shape.props.scaleX,
          y: point.y * shape.props.scaleY,
        }),
      );
    } catch {
      return [];
    }
  });

  if (!points.length) return null;

  const dashArray = getCanvasPreviewStrokeDash(shape.props.dash, strokeWidth);
  const path =
    points.length > 1
      ? points
          .map(
            (point, index) =>
              `${index === 0 ? "M" : "L"} ${toSvgNumber(point.x)} ${toSvgNumber(point.y)}`,
          )
          .join(" ")
      : null;

  return {
    color:
      CANVAS_PREVIEW_SHAPE_COLORS[shape.props.color] ??
      CANVAS_PREVIEW_SHAPE_COLORS.black,
    ...(dashArray.length ? { dashArray: dashArray.join(" ") } : {}),
    id: `${actorUserId}:${shape.id}`,
    opacity: shape.opacity * (shape.type === "highlight" ? 0.42 : 0.92),
    path,
    point:
      points.length === 1
        ? { x: toSvgNumber(points[0].x), y: toSvgNumber(points[0].y) }
        : null,
    strokeWidth,
  };
}

export function CanvasRemoteFreehandPreviewOverlay({
  previewStore,
}: CanvasRemoteFreehandPreviewOverlayProps) {
  const editor = useEditor();
  const previews = useSyncExternalStore(
    previewStore.subscribe,
    previewStore.getSnapshot,
    previewStore.getSnapshot,
  );
  const paths = previews.flatMap((preview) =>
    preview.shapes.flatMap((value) => {
      const shape = readRemoteFreehandShape(value);
      if (!shape) return [];

      const path = createRemoteFreehandPath({
        actorUserId: preview.actorUserId,
        editor,
        shape,
      });

      return path ? [path] : [];
    }),
  );

  return (
    <svg className="canvas-remote-freehand-preview-layer" overflow="visible">
      {paths.map((path) =>
        path.path ? (
          <path
            key={path.id}
            d={path.path}
            fill="none"
            opacity={path.opacity}
            stroke={path.color}
            strokeDasharray={path.dashArray}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={path.strokeWidth}
          />
        ) : path.point ? (
          <circle
            key={path.id}
            cx={path.point.x}
            cy={path.point.y}
            fill={path.color}
            opacity={path.opacity}
            r={Math.max(0.5, path.strokeWidth / 2)}
          />
        ) : null,
      )}
    </svg>
  );
}
