import type { TLCreateShapePartial, TLShape } from "tldraw";

export type PiloCanvasFreeformShape = TLCreateShapePartial<TLShape>;

export type PiloCanvasLocalShapeChange = {
  changedShapeIds: string[];
  deletedShapeIds: string[];
  isFreehandDrawing: boolean;
};

export type PiloCanvasLocalInteractionState = {
  currentToolId: string;
  editingShapeId: string | null;
  focusedGroupId: string | null;
  isFreehandDrawing: boolean;
  isFocused: boolean;
  protectedShapeIds: string[];
  selectedShapeIds: string[];
};

export type PiloCanvasViewSetting = {
  zoom: number;
  viewportX: number;
  viewportY: number;
};

export type PiloCanvasViewportBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
};

export type PiloCanvasShapeDetailRequest = {
  shapeId: string;
  zoom: number;
};
