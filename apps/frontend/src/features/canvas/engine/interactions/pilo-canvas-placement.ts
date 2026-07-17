"use client";

import type { Editor, TLShapeId } from "tldraw";
import {
  createCodeBlockShape,
  createInsertableShape,
  type PiloInsertableTool,
} from "../shapes/pilo-canvas-shape-factory";

export type PiloPlacementRequest =
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
