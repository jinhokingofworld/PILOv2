import { Mat, type Editor, type TLShapeId } from "tldraw";

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
