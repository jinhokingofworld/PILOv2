"use client";

import { PiloCodeBlockShapeUtil } from "./code-block/PiloCodeBlockShapeUtil";
import { PiloFrameShapeUtil } from "./frame/PiloFrameShapeUtil";

export const piloCanvasShapeUtils = [
  PiloFrameShapeUtil,
  PiloCodeBlockShapeUtil,
  // TODO(file_node): register the file_node ShapeUtil here after it has
  // rendering, props, geometry, and creation actions.
];
