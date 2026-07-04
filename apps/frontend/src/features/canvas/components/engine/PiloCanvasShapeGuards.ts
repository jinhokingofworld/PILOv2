"use client";

import type {
  Editor,
  TLShape,
  TLShapeId,
  TLShapePartial,
} from "tldraw";
import type { PiloCodeBlockShape } from "./PiloCodeBlockShapeUtil";
import type { PiloStickyNoteShape } from "./PiloStickyNoteShapeUtil";

export type PiloFrameShape = Extract<TLShape, { type: "frame" }>;
export type PiloFramePartial = TLShapePartial<PiloFrameShape> & {
  id: TLShapeId;
};
export type PiloSnapShape =
  | PiloFrameShape
  | PiloStickyNoteShape
  | PiloCodeBlockShape;

export function isPiloFrameShape(
  shape: TLShape | undefined,
): shape is PiloFrameShape {
  return Boolean(shape && shape.type === "frame");
}

export function isPiloCodeBlockShape(
  shape: TLShape | undefined,
): shape is PiloCodeBlockShape {
  return Boolean(shape && shape.type === "pilo-code-block");
}

export function isPiloSnapShape(
  shape: TLShape | undefined,
): shape is PiloSnapShape {
  return Boolean(
    shape &&
      (isPiloFrameShape(shape) ||
        shape.type === "pilo-sticky-note" ||
        isPiloCodeBlockShape(shape)),
  );
}

export function isPiloTextShape(shape: TLShape | undefined) {
  return Boolean(shape && shape.type === "text");
}

export function getPiloTextShapeIds(editor: Editor) {
  return editor
    .getCurrentPageShapes()
    .filter(isPiloTextShape)
    .map((shape) => shape.id as TLShapeId);
}

export function bringPiloTextShapesToFront(
  editor: Editor,
  textShapeIds = getPiloTextShapeIds(editor),
) {
  if (!textShapeIds.length) return;

  editor.bringToFront(textShapeIds);
}
