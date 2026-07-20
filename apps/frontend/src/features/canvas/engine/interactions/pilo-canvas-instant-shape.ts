"use client";

import {
  createShapeId,
  startEditingShapeWithRichText,
  type Editor,
  type TLCreateShapePartial,
  type TLGeoShapeGeoStyle,
  type TLShape,
  type TLShapeId,
} from "tldraw";

import type { PiloDrawingPreset } from "../editor/canvas-editor-contracts";
import { findPiloCanvasEmptyPlacementForEditor } from "./pilo-canvas-empty-placement";

export type PiloCanvasInstantShapeRequest =
  | { type: "frame" }
  | {
      geo: TLGeoShapeGeoStyle;
      preset: Exclude<PiloDrawingPreset, "pen" | "highlight" | "eraser">;
      type: "geo";
    }
  | { type: "note" }
  | { type: "text" };

const piloInstantShapeSizeByType = {
  frame: { height: 360, width: 640 },
  note: { height: 400, width: 400 },
  text: { height: 96, width: 360 },
} as const;

export function getPiloCanvasInstantGeoSize(
  preset: Exclude<PiloDrawingPreset, "pen" | "highlight" | "eraser">,
) {
  if (preset === "circle") return { height: 240, width: 240 };
  if (preset === "ellipse" || preset === "oval") {
    return { height: 220, width: 360 };
  }
  if (preset.startsWith("arrow-")) {
    return { height: 180, width: 360 };
  }
  if (preset === "rectangle" || preset.startsWith("rhombus")) {
    return { height: 220, width: 320 };
  }
  if (preset === "cloud" || preset === "heart") {
    return { height: 240, width: 280 };
  }

  return { height: 240, width: 240 };
}

function getPiloCanvasInstantShapeSize(
  request: PiloCanvasInstantShapeRequest,
) {
  return request.type === "geo"
    ? getPiloCanvasInstantGeoSize(request.preset)
    : piloInstantShapeSizeByType[request.type];
}

export function createPiloCanvasShapeInEmptyViewport({
  editor,
  request,
}: {
  editor: Editor;
  request: PiloCanvasInstantShapeRequest;
}) {
  const size = getPiloCanvasInstantShapeSize(request);
  const point = findPiloCanvasEmptyPlacementForEditor(editor, size);
  const id = createShapeId();
  let shape: TLCreateShapePartial<TLShape> & { id: TLShapeId };

  if (request.type === "frame") {
    shape = {
      id,
      props: { h: size.height, w: size.width },
      type: "frame",
      x: point.x - size.width / 2,
      y: point.y - size.height / 2,
    };
  } else if (request.type === "geo") {
    shape = {
      id,
      props: {
        geo: request.geo,
        h: size.height,
        w: size.width,
      },
      type: "geo",
      x: point.x - size.width / 2,
      y: point.y - size.height / 2,
    };
  } else if (request.type === "note") {
    shape = {
      id,
      type: "note",
      x: point.x - size.width / 2,
      y: point.y - size.height / 2,
    };
  } else {
    shape = {
      id,
      props: { w: size.width },
      type: "text",
      x: point.x - size.width / 2,
      y: point.y - size.height / 2,
    };
  }

  editor.createShape(shape);

  const createdShape = editor.getShape(id);
  if (!createdShape) return false;

  editor.select(id);

  if (request.type === "text") {
    startEditingShapeWithRichText(editor, createdShape);
  } else {
    editor.setCurrentTool("select.idle");
  }

  return true;
}
