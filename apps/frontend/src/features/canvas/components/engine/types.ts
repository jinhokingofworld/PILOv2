import type { TLCreateShapePartial, TLShape } from "tldraw";

export type PiloCanvasFreeformShape = TLCreateShapePartial<TLShape>;

export type PiloCanvasViewSetting = {
  zoom: number;
  viewportX: number;
  viewportY: number;
};
