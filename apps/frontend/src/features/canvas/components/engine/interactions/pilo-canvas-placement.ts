"use client";

import type { Editor, TLShapeId } from "tldraw";
import {
  createCodeBlockShape,
  createInsertableShape,
  createStickyNoteShape,
  type PiloInsertableTool,
} from "../shapes/pilo-canvas-shape-factory";
import type { PiloStickyNoteColor } from "../shapes/sticky-note/PiloStickyNoteShapeUtil";

export type PiloPlacementRequest =
  | {
      type: "sticky";
      color?: PiloStickyNoteColor;
    }
  | {
      type: "sticky-stack";
      color?: PiloStickyNoteColor;
    }
  | {
      type: "code";
    }
  | {
      type: PiloInsertableTool;
      url: string;
    };

export function placePiloCanvasShapeAt({
  editor,
  index,
  placementRequest,
  point,
}: {
  editor: Editor;
  index: number;
  placementRequest: PiloPlacementRequest;
  point: { x: number; y: number };
}) {
  if (placementRequest.type === "sticky") {
    const shape = createStickyNoteShape(index, point, placementRequest.color);

    editor.createShapes([shape]);
    editor.select(shape.id as TLShapeId);
    return { placed: true, createdCount: 1 };
  }

  if (placementRequest.type === "sticky-stack") {
    const stackColors: PiloStickyNoteColor[] = placementRequest.color
      ? [
          placementRequest.color,
          placementRequest.color,
          placementRequest.color,
        ]
      : ["butter", "peach", "pink"];
    const shapes = stackColors.map((stackColor, stackIndex) =>
      createStickyNoteShape(index + stackIndex, point, stackColor),
    );

    editor.createShapes(shapes);
    editor.select(shapes[shapes.length - 1].id as TLShapeId);
    return { placed: true, createdCount: shapes.length };
  }

  if (placementRequest.type === "code") {
    const shape = createCodeBlockShape(index, point);

    editor.createShapes([shape]);
    editor.select(shape.id as TLShapeId);
    return { placed: true, createdCount: 1 };
  }

  const { asset, shape } = createInsertableShape(index, point, placementRequest);

  if (asset) {
    editor.createAssets([asset]);
  }

  editor.createShapes([shape]);
  editor.select(shape.id as TLShapeId);
  return { placed: true, createdCount: 1 };
}
