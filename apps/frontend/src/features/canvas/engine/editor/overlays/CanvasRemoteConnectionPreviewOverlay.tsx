"use client";

import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { useValue } from "@tldraw/state-react";
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
  prepareCanvasPreviewContext,
  useCanvasOverlayRect,
  type CanvasOverlayRect,
} from "./canvas-remote-preview-canvas";

type CanvasRemoteConnectionPreviewOverlayProps = {
  previewStore: CanvasRemoteShapePreviewStore;
};

function drawArrowhead({
  context,
  from,
  strokeWidth,
  tip,
  type,
}: {
  context: CanvasRenderingContext2D;
  from: CanvasPreviewPoint;
  strokeWidth: number;
  tip: CanvasPreviewPoint;
  type: string;
}) {
  if (type === "none") return;

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

  context.save();
  context.setLineDash([]);
  context.beginPath();
  context.moveTo(left.x, left.y);
  context.lineTo(tip.x, tip.y);
  context.lineTo(right.x, right.y);

  if (type === "triangle" || type === "arrow") {
    context.closePath();
    context.fillStyle = context.strokeStyle;
    context.fill();
  } else {
    context.stroke();
  }

  context.restore();
}

function drawRemoteConnectionPreview({
  context,
  editor,
  overlayRect,
  shape,
}: {
  context: CanvasRenderingContext2D;
  editor: ReturnType<typeof useEditor>;
  overlayRect: CanvasOverlayRect;
  shape: CanvasRemoteConnectionPreviewShape;
}) {
  if (shape.props.dash === "none") return;

  const pageTransform = getCanvasRemotePreviewShapePageTransform(editor, shape);
  const cameraZoom = editor.getCamera().z;
  const strokeWidth =
    (CANVAS_PREVIEW_STROKE_WIDTHS[shape.props.size] ?? 2.75) *
    shape.props.scale *
    cameraZoom;
  const toOverlayPoint = (point: CanvasPreviewPoint) => {
    const screenPoint = editor.pageToScreen(
      pageTransform.applyToPoint(point),
    );

    return {
      x: screenPoint.x - overlayRect.left,
      y: screenPoint.y - overlayRect.top,
    };
  };
  const path = getRemoteConnectionPreviewPath(shape);
  const strokeColor =
    CANVAS_PREVIEW_SHAPE_COLORS[shape.props.color] ??
    CANVAS_PREVIEW_SHAPE_COLORS.black;

  context.save();
  context.globalAlpha = shape.opacity * 0.9;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Math.max(1, strokeWidth);
  context.strokeStyle = strokeColor;
  context.setLineDash(
    getCanvasPreviewStrokeDash(shape.props.dash, strokeWidth),
  );
  context.beginPath();

  let startPoint: CanvasPreviewPoint;
  let startDirectionPoint: CanvasPreviewPoint;
  let endPoint: CanvasPreviewPoint;
  let endDirectionPoint: CanvasPreviewPoint;

  if (path.kind === "quadratic") {
    startPoint = toOverlayPoint(path.start);
    startDirectionPoint = toOverlayPoint(path.control);
    endDirectionPoint = startDirectionPoint;
    endPoint = toOverlayPoint(path.end);
    context.moveTo(startPoint.x, startPoint.y);
    context.quadraticCurveTo(
      startDirectionPoint.x,
      startDirectionPoint.y,
      endPoint.x,
      endPoint.y,
    );
  } else {
    const points = path.points.map(toOverlayPoint);
    if (!points.length) {
      context.restore();
      return;
    }

    startPoint = points[0];
    startDirectionPoint = points[1] ?? points[0];
    endPoint = points[points.length - 1];
    endDirectionPoint = points[points.length - 2] ?? endPoint;
    points.forEach((point, index) => {
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
  }

  context.stroke();

  if (shape.type === "arrow") {
    drawArrowhead({
      context,
      from: startDirectionPoint,
      strokeWidth,
      tip: startPoint,
      type: shape.props.arrowheadStart,
    });
    drawArrowhead({
      context,
      from: endDirectionPoint,
      strokeWidth,
      tip: endPoint,
      type: shape.props.arrowheadEnd,
    });
  }

  context.restore();
}

export function CanvasRemoteConnectionPreviewOverlay({
  previewStore,
}: CanvasRemoteConnectionPreviewOverlayProps) {
  const editor = useEditor();
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRect = useCanvasOverlayRect(overlayRef);
  const previews = useSyncExternalStore(
    previewStore.subscribe,
    previewStore.getSnapshot,
    previewStore.getSnapshot,
  );
  const camera = useValue(
    "pilo-remote-connection-preview-camera",
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
          const shape = readRemoteConnectionPreviewShape(value);
          if (!shape) return;

          drawRemoteConnectionPreview({
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
      className="canvas-remote-connection-preview-layer"
    />
  );
}
