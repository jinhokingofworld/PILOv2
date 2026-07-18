"use client";

import { PiloCodeBlockShapeUtil } from "./code-block/PiloCodeBlockShapeUtil";
import { PiloFrameShapeUtil } from "./frame/PiloFrameShapeUtil";
import { PiloFileNodeShapeUtil } from "./file-node/PiloFileNodeShapeUtil";

export const piloCanvasShapeUtils = [
  PiloFrameShapeUtil,
  PiloCodeBlockShapeUtil,
  PiloFileNodeShapeUtil,
];
