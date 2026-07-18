"use client";

import type { Editor, TLShapeId } from "tldraw";
import {
  createCodeBlockShape,
  createDriveFileNodeShape,
  createInsertableShape,
  type PiloInsertableTool,
} from "../shapes/pilo-canvas-shape-factory";
import type { CanvasDriveFileReference } from "../../integrations/drive/canvas-drive-file";
import { findPiloCanvasEmptyPlacementForEditor } from "./pilo-canvas-empty-placement";

export type PiloPlacementRequest =
  | {
      type: "code";
    }
  | {
      type: PiloInsertableTool;
      url: string;
    }
  | {
      type: "drive-file";
      file: CanvasDriveFileReference;
    };

const piloPlacementSizeByType: Record<
  PiloPlacementRequest["type"],
  { height: number; width: number }
> = {
  bookmark: { height: 160, width: 320 },
  code: { height: 260, width: 420 },
  "drive-file": { height: 280, width: 420 },
  embed: { height: 260, width: 420 },
  image: { height: 200, width: 320 },
  video: { height: 220, width: 360 },
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

  if (placementRequest.type === "drive-file") {
    const shape = createDriveFileNodeShape(
      index,
      point,
      placementRequest.file,
    );

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

export function placePiloCanvasShapeInEmptyViewport({
  editor,
  index,
  placementRequest,
}: {
  editor: Editor;
  index: number;
  placementRequest: PiloPlacementRequest;
}) {
  const point = findPiloCanvasEmptyPlacementForEditor(
    editor,
    piloPlacementSizeByType[placementRequest.type],
  );

  return placePiloCanvasShapeAt({
    editor,
    index,
    placementRequest,
    point,
  });
}
