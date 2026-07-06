import type { TLCreateShapePartial, TLShape } from "tldraw";

export type PiloCanvasFreeformShape = TLCreateShapePartial<TLShape>;

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
