"use client";

import { BaseBoxShapeUtil, T, type TLResizeInfo } from "tldraw";

import { PiloFileNodeComponent } from "./PiloFileNodeComponent";
import {
  DEFAULT_PILO_FILE_NODE_PROPS,
  type PiloFileNodeShape,
} from "./PiloFileNodeShapeTypes";

export const PILO_FILE_NODE_SHAPE_TYPE = "file_node" as const;

export class PiloFileNodeShapeUtil extends BaseBoxShapeUtil<PiloFileNodeShape> {
  static override type = PILO_FILE_NODE_SHAPE_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    fileId: T.string,
    fileName: T.string,
    mimeType: T.string,
  };

  override getDefaultProps() {
    return { ...DEFAULT_PILO_FILE_NODE_PROPS };
  }

  override onResize(
    _shape: PiloFileNodeShape,
    info: TLResizeInfo<PiloFileNodeShape>,
  ) {
    return {
      props: {
        w: Math.max(280, info.initialShape.props.w * Math.abs(info.scaleX)),
        h: Math.max(180, info.initialShape.props.h * Math.abs(info.scaleY)),
      },
    };
  }

  override component(shape: PiloFileNodeShape) {
    return <PiloFileNodeComponent shape={shape} />;
  }

  override getIndicatorPath(shape: PiloFileNodeShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 12);
    return path;
  }
}
