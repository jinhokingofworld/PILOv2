"use client";

import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { useValue } from "@tldraw/state-react";
import { b64Vecs, useEditor } from "tldraw";

import type { CanvasRemoteShapePreviewStore } from "@/features/canvas/collaboration/canvas-remote-shape-preview-store";
import {
  CANVAS_PREVIEW_SHAPE_COLORS,
  CANVAS_PREVIEW_STROKE_WIDTHS,
  getCanvasPreviewStrokeDash,
  getCanvasRemotePreviewShapePageTransform,
  prepareCanvasPreviewContext,
  useCanvasOverlayRect,
  type CanvasOverlayRect,
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

function drawRemoteFreehandShape({
  context,
  editor,
  overlayRect,
  shape,
}: {
  context: CanvasRenderingContext2D;
  editor: ReturnType<typeof useEditor>;
  overlayRect: CanvasOverlayRect;
  shape: CanvasRemoteFreehandShape;
}) {
  const pageTransform = getCanvasRemotePreviewShapePageTransform(editor, shape);
  const cameraZoom = editor.getCamera().z;
  const baseStrokeWidth =
    shape.type === "highlight"
      ? (CANVAS_HIGHLIGHT_STROKE_WIDTHS[shape.props.size] ?? 24)
      : (CANVAS_PREVIEW_STROKE_WIDTHS[shape.props.size] ?? 2.75);
  const strokeWidth = baseStrokeWidth * shape.props.scale * cameraZoom;
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

  if (!points.length || shape.props.dash === "none") return;

  context.save();
  context.globalAlpha =
    shape.opacity * (shape.type === "highlight" ? 0.42 : 0.92);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Math.max(1, strokeWidth);
  context.strokeStyle =
    CANVAS_PREVIEW_SHAPE_COLORS[shape.props.color] ??
    CANVAS_PREVIEW_SHAPE_COLORS.black;
  context.setLineDash(
    getCanvasPreviewStrokeDash(shape.props.dash, strokeWidth),
  );
  context.beginPath();

  points.forEach((point, index) => {
    const screenPoint = editor.pageToScreen(point);
    const x = screenPoint.x - overlayRect.left;
    const y = screenPoint.y - overlayRect.top;

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  if (points.length === 1) {
    const screenPoint = editor.pageToScreen(points[0]);
    context.arc(
      screenPoint.x - overlayRect.left,
      screenPoint.y - overlayRect.top,
      Math.max(1, strokeWidth / 2),
      0,
      Math.PI * 2,
    );
    context.fillStyle = context.strokeStyle;
    context.fill();
  } else {
    context.stroke();
  }

  context.restore();
}

export function CanvasRemoteFreehandPreviewOverlay({
  previewStore,
}: CanvasRemoteFreehandPreviewOverlayProps) {
  const editor = useEditor();
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRect = useCanvasOverlayRect(overlayRef);
  const previews = useSyncExternalStore(
    previewStore.subscribe,
    previewStore.getSnapshot,
    previewStore.getSnapshot,
  );
  const camera = useValue(
    "pilo-remote-freehand-preview-camera",
    () => editor.getCamera(),
    [editor],
  );

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !overlayRect) return undefined;

    const animationFrame = window.requestAnimationFrame(() => {
      const context = overlay.getContext("2d");
      if (!context) return;

      prepareCanvasPreviewContext({ context, overlay, overlayRect });

      previews.forEach((preview) => {
        preview.shapes.forEach((value) => {
          const shape = readRemoteFreehandShape(value);
          if (!shape) return;

          drawRemoteFreehandShape({
            context,
            editor,
            overlayRect,
            shape,
          });
        });
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [camera.x, camera.y, camera.z, editor, overlayRect, previews]);

  return (
    <canvas
      ref={overlayRef}
      aria-hidden="true"
      className="canvas-remote-freehand-preview-layer"
    />
  );
}
