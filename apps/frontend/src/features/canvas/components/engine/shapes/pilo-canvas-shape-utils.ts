"use client";

import { PiloCodeBlockShapeUtil } from "./code-block/PiloCodeBlockShapeUtil";
import { PiloStickyNoteShapeUtil } from "./sticky-note/PiloStickyNoteShapeUtil";
import { PiloFrameShapeUtil } from "./frame/PiloFrameShapeUtil";

export const piloCanvasShapeUtils = [
  PiloFrameShapeUtil,
  PiloStickyNoteShapeUtil,
  PiloCodeBlockShapeUtil,
  // TODO(file_node): register the file_node ShapeUtil here after it has
  // rendering, props, geometry, and creation actions.
];
