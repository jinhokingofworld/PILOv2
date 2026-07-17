import type { Editor, TLShapeId } from "tldraw";
import type { CanvasAgentViewport } from "../api/canvas-agent-types";

const CANVAS_AGENT_MAX_FOCUS_ZOOM = 1;
const CANVAS_AGENT_FOCUS_INSET = 160;

export function focusCanvasAgentResult(
  editor: Editor,
  shapeIds: string[],
  fallbackViewport: CanvasAgentViewport | null,
) {
  const bounds = combinedShapeBounds(editor, shapeIds);
  const target = bounds ?? (fallbackViewport
    ? {
        x: fallbackViewport.x,
        y: fallbackViewport.y,
        w: fallbackViewport.width,
        h: fallbackViewport.height,
      }
    : null);
  if (!target) return false;

  editor.zoomToBounds(target, {
    animation: { duration: 500 },
    inset: CANVAS_AGENT_FOCUS_INSET,
    targetZoom: CANVAS_AGENT_MAX_FOCUS_ZOOM,
  });
  return bounds !== null;
}

function combinedShapeBounds(editor: Editor, shapeIds: string[]) {
  const bounds = shapeIds.flatMap((shapeId) => {
    const shapeBounds = editor.getShapePageBounds(shapeId as TLShapeId);
    return shapeBounds
      ? [{ x: shapeBounds.x, y: shapeBounds.y, w: shapeBounds.w, h: shapeBounds.h }]
      : [];
  });
  if (!bounds.length) return null;

  const left = Math.min(...bounds.map((item) => item.x));
  const top = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.w));
  const bottom = Math.max(...bounds.map((item) => item.y + item.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}
