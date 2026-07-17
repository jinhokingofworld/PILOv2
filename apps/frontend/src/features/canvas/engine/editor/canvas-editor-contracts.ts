import type { PointerEvent } from "react";
import type { PiloCanvasFreeformShape } from "../canvas-engine-types";
import type { PiloInsertableTool } from "../shapes/pilo-canvas-shape-factory";

export type CanvasAiChatAnchor = {
  x: number;
  y: number;
};

export type PiloCanvasTool =
  | "select"
  | "hand"
  | "note"
  | "draw"
  | "text"
  | "arrow"
  | "line"
  | "geo"
  | "frame"
  | "code";

export type PiloCanvasColor =
  | "default"
  | "black"
  | "grey"
  | "white"
  | "light-violet"
  | "violet"
  | "blue"
  | "light-blue"
  | "green"
  | "light-green"
  | "yellow"
  | "orange"
  | "light-red"
  | "red";

export type PiloDrawingPreset =
  | "pen"
  | "highlight"
  | "eraser"
  | "rectangle"
  | "circle"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "ellipse"
  | "oval"
  | "rhombus"
  | "rhombus-2"
  | "star"
  | "cloud"
  | "heart"
  | "x-box"
  | "check-box"
  | "arrow-left"
  | "arrow-up"
  | "arrow-down"
  | "arrow-right";

export type PiloCanvasFill = "none" | "semi" | "solid" | "fill";
export type PiloCanvasDash = "draw" | "dashed" | "dotted" | "solid";
export type PiloCanvasSize = "s" | "m" | "l" | "xl";

export type PiloCanvasSelectionAction =
  | "select-all"
  | "duplicate"
  | "group"
  | "ungroup"
  | "bring-to-front"
  | "send-to-back"
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-top"
  | "align-middle"
  | "align-bottom"
  | "distribute-horizontal"
  | "distribute-vertical";

export type PiloCanvasExportFormat = "png" | "svg";
export type PiloCanvasExportScope = "selection" | "canvas";
export type PiloCanvasUserPreference =
  | "paste-at-cursor"
  | "wrap-text"
  | "reduce-motion";
export type PiloCanvasUserPreferenceState = Record<
  PiloCanvasUserPreference,
  boolean
>;

export type PiloCanvasStyleState = {
  dash: PiloCanvasDash | null;
  fill: PiloCanvasFill | null;
  opacity: number | null;
  size: PiloCanvasSize | null;
};

export type PiloCanvasActions = {
  markUiEventAsHandled: (event: PointerEvent<HTMLElement>) => void;
  openCanvasAiChat: (anchor: CanvasAiChatAnchor) => void;
  selectTool: (tool: PiloCanvasTool) => void;
  selectDrawingPreset: (preset: PiloDrawingPreset) => void;
  setColor: (color: PiloCanvasColor) => void;
  setFill: (fill: PiloCanvasFill) => void;
  setDash: (dash: PiloCanvasDash) => void;
  setSize: (size: PiloCanvasSize) => void;
  setOpacity: (opacity: number) => void;
  getStyleState: () => PiloCanvasStyleState;
  createInsertableShape: (tool: PiloInsertableTool, url: string) => void;
  groupSelection: () => void;
  performSelectionAction: (action: PiloCanvasSelectionAction) => void;
  exportCanvas: (
    format: PiloCanvasExportFormat,
    scope: PiloCanvasExportScope,
    background: boolean,
  ) => Promise<boolean>;
  setUserPreference: (
    preference: PiloCanvasUserPreference,
    enabled: boolean,
  ) => PiloCanvasUserPreferenceState;
  getUserPreferences: () => PiloCanvasUserPreferenceState;
  setSmartGuidesEnabled: (enabled: boolean) => void;
  createNote: () => void;
  createCodeBlock: () => void;
  clearSelection: () => void;
  deleteSelection: () => void;
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  undo: () => void;
  redo: () => void;
};

export type PiloCanvasHistoryState = {
  canUndo: boolean;
  canRedo: boolean;
};

export type PiloCanvasSnapState = {
  isSmartGuideEnabled: boolean;
};

export type PiloCanvasShapePatch = {
  deletedShapeIds: string[];
  upsertShapes: PiloCanvasFreeformShape[];
};
