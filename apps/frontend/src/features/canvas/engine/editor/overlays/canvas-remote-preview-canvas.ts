"use client";

import {
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";
import { Mat, type Editor, type TLShapeId } from "tldraw";

export type CanvasOverlayRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export type CanvasRemotePreviewShapeTransform = {
  parentId: string;
  rotation: number;
  x: number;
  y: number;
};

export const CANVAS_PREVIEW_STROKE_WIDTHS: Record<string, number> = {
  l: 3.5,
  m: 2.75,
  s: 2,
  xl: 6,
};

export const CANVAS_PREVIEW_SHAPE_COLORS: Record<string, string> = {
  black: "#1d1d1d",
  blue: "#4263eb",
  green: "#2f9e44",
  grey: "#868e96",
  "light-blue": "#74c0fc",
  "light-green": "#8ce99a",
  "light-red": "#ffa8a8",
  "light-violet": "#b197fc",
  orange: "#f76707",
  red: "#e03131",
  violet: "#7048e8",
  white: "#ffffff",
  yellow: "#f59f00",
};

function hasSameOverlayRect(
  previousRect: CanvasOverlayRect | null,
  nextRect: CanvasOverlayRect,
) {
  return (
    previousRect?.height === nextRect.height &&
    previousRect.left === nextRect.left &&
    previousRect.top === nextRect.top &&
    previousRect.width === nextRect.width
  );
}

export function useCanvasOverlayRect(
  overlayRef: RefObject<HTMLCanvasElement | null>,
) {
  const [overlayRect, setOverlayRect] = useState<CanvasOverlayRect | null>(null);

  useLayoutEffect(() => {
    const overlayElement = overlayRef.current;
    if (!overlayElement) return undefined;
    const measuredOverlay = overlayElement;

    function updateOverlayRect() {
      const rect = measuredOverlay.getBoundingClientRect();
      const nextRect = {
        height: rect.height,
        left: rect.left,
        top: rect.top,
        width: rect.width,
      };

      setOverlayRect((currentRect) =>
        hasSameOverlayRect(currentRect, nextRect) ? currentRect : nextRect,
      );
    }

    updateOverlayRect();

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateOverlayRect);

    resizeObserver?.observe(measuredOverlay);
    window.addEventListener("resize", updateOverlayRect);
    window.addEventListener("scroll", updateOverlayRect, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateOverlayRect);
      window.removeEventListener("scroll", updateOverlayRect, true);
    };
  }, [overlayRef]);

  return overlayRect;
}

export function getCanvasRemotePreviewShapePageTransform(
  editor: Editor,
  shape: CanvasRemotePreviewShapeTransform,
) {
  const localTransform = Mat.Identity()
    .translate(shape.x, shape.y)
    .rotate(shape.rotation);
  const parentShape = shape.parentId
    ? editor.getShape(shape.parentId as TLShapeId)
    : null;

  return parentShape
    ? Mat.Compose(editor.getShapePageTransform(parentShape), localTransform)
    : localTransform;
}

export function getCanvasPreviewStrokeDash(
  dash: string,
  strokeWidth: number,
): number[] {
  if (dash === "dashed") return [strokeWidth * 2, strokeWidth * 2];
  if (dash === "dotted") return [0.1, strokeWidth * 2];

  return [];
}

export function prepareCanvasPreviewContext({
  context,
  overlay,
  overlayRect,
}: {
  context: CanvasRenderingContext2D;
  overlay: HTMLCanvasElement;
  overlayRect: CanvasOverlayRect;
}) {
  const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(
    1,
    Math.round(overlayRect.width * devicePixelRatio),
  );
  const pixelHeight = Math.max(
    1,
    Math.round(overlayRect.height * devicePixelRatio),
  );

  if (overlay.width !== pixelWidth || overlay.height !== pixelHeight) {
    overlay.width = pixelWidth;
    overlay.height = pixelHeight;
  }

  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.clearRect(0, 0, overlayRect.width, overlayRect.height);
}
