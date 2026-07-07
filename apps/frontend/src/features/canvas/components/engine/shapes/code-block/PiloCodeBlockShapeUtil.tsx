"use client";

import {
  BaseBoxShapeUtil,
  T,
  type TLResizeInfo,
} from "tldraw";
import { PiloCodeBlockComponent } from "./PiloCodeBlockComponent";
import {
  DEFAULT_PILO_CODE_BLOCK_PROPS,
  type PiloCodeBlockShape,
} from "./PiloCodeBlockShapeTypes";

export type { PiloCodeBlockShape } from "./PiloCodeBlockShapeTypes";

export class PiloCodeBlockShapeUtil extends BaseBoxShapeUtil<PiloCodeBlockShape> {
  static override type = "pilo-code-block" as const;

  static override props = {
    w: T.number,
    h: T.number,
    fileName: T.string,
    language: T.literalEnum(
      "tsx",
      "ts",
      "jsx",
      "js",
      "json",
      "css",
      "html",
      "md",
      "sql",
      "py",
      "c",
    ),
    code: T.string,
    scrollY: T.number.optional(),
  };

  override canEdit() {
    return true;
  }

  override getDefaultProps(): PiloCodeBlockShape["props"] {
    return { ...DEFAULT_PILO_CODE_BLOCK_PROPS };
  }

  override onResize(
    _shape: PiloCodeBlockShape,
    info: TLResizeInfo<PiloCodeBlockShape>,
  ) {
    return {
      props: {
        w: Math.max(300, info.initialShape.props.w * Math.abs(info.scaleX)),
        h: Math.max(190, info.initialShape.props.h * Math.abs(info.scaleY)),
      },
    };
  }

  override component(shape: PiloCodeBlockShape) {
    return <PiloCodeBlockComponent shape={shape} />;
  }

  override getIndicatorPath(shape: PiloCodeBlockShape) {
    const path = new Path2D();

    path.rect(0, 0, shape.props.w, shape.props.h);

    return path;
  }
}
