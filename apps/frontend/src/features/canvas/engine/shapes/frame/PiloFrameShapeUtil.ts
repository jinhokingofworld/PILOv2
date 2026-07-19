"use client";

import { createElement } from "react";
import { useValue } from "@tldraw/state-react";
import { FrameShapeUtil, type Editor, type TLShape } from "tldraw";

import {
  isPiloFrameShape,
  type PiloFrameShape,
} from "../PiloCanvasShapeGuards";

const PILO_EMPTY_FRAME_NAME = "\u200B";

function isBlankFrameName(name: string) {
  return name.replaceAll(PILO_EMPTY_FRAME_NAME, "").trim() === "";
}

export function normalizeBlankFrameName(name: string) {
  return isBlankFrameName(name) ? PILO_EMPTY_FRAME_NAME : name;
}

const piloFrameDisplayColors: Partial<
  Record<
    PiloFrameShape["props"]["color"],
    {
      fill: string;
      stroke: string;
      headingText: string;
    }
  >
> = {
  black: { fill: "#edf0f4", stroke: "#5b6472", headingText: "#111827" },
  grey: { fill: "#d9dde4", stroke: "#7b8492", headingText: "#111827" },
  "light-violet": { fill: "#eadcff", stroke: "#a379e6", headingText: "#3b2470" },
  violet: { fill: "#dec8ff", stroke: "#7c4bd6", headingText: "#35176f" },
  blue: { fill: "#d4e2ff", stroke: "#4c6fe8", headingText: "#173a8a" },
  "light-blue": { fill: "#d6ecff", stroke: "#4595d9", headingText: "#0e4d78" },
  yellow: { fill: "#fff0a6", stroke: "#d79b1f", headingText: "#704900" },
  orange: { fill: "#ffd8b8", stroke: "#df7a28", headingText: "#783500" },
  green: { fill: "#cdf2db", stroke: "#2b9b55", headingText: "#10542c" },
  "light-green": { fill: "#d8f6cf", stroke: "#5dad45", headingText: "#285f1b" },
  "light-red": { fill: "#ffd2d2", stroke: "#e06b6b", headingText: "#831f1f" },
  red: { fill: "#ffc3c3", stroke: "#d94949", headingText: "#7a1111" },
  white: { fill: "#ffffff", stroke: "#cbd2df", headingText: "#111827" },
};

const PiloBaseFrameShapeUtil = FrameShapeUtil.configure({
  showColors: true,
  getCustomDisplayValues(_editor, shape) {
    const colors =
      piloFrameDisplayColors[shape.props.color] ?? piloFrameDisplayColors.black;

    if (!colors) return {};

    return {
      showColorsFillColor: colors.fill,
      showColorsStrokeColor: colors.stroke,
      showColorsHeadingFillColor: "transparent",
      showColorsHeadingStrokeColor: "transparent",
      showColorsHeadingTextColor: colors.headingText,
    };
  },
});

export class PiloFrameShapeUtil extends PiloBaseFrameShapeUtil {
  override shouldClipChild(_child: TLShape) {
    return false;
  }

  override component(shape: PiloFrameShape) {
    const frameComponent = super.component(shape);
    // ShapeUtil components render inside tldraw's tracked React component.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const showHeading = useValue(
      `pilo-frame-heading:${shape.id}`,
      () => {
        const currentShape = this.editor.getShape(shape.id);
        const parentShape = currentShape
          ? this.editor.getShape(currentShape.parentId)
          : undefined;
        const isNestedFrame = isPiloFrameShape(parentShape);

        return (
          !isNestedFrame ||
          this.editor.getSelectedShapeIds().includes(shape.id) ||
          this.editor.getEditingShapeId() === shape.id
        );
      },
      [this.editor, shape.id],
    );

    return createElement(
      "div",
      {
        className: showHeading
          ? "pilo-frame-shape"
          : "pilo-frame-shape pilo-frame-shape--heading-hidden",
        style: { display: "contents" },
      },
      frameComponent,
    );
  }
}

export function resolveNextFrameName(editor: Editor) {
  const usedFrameNumbers = new Set<number>();

  editor.getCurrentPageShapes().forEach((shape) => {
    if (!isPiloFrameShape(shape)) return;

    const match = isBlankFrameName(shape.props.name)
      ? null
      : shape.props.name.match(/^(?:Frame|프레임)\s+(\d+)$/);
    const frameNumber = match ? Number(match[1]) : NaN;

    if (Number.isFinite(frameNumber) && frameNumber > 0) {
      usedFrameNumbers.add(frameNumber);
    }
  });

  let nextFrameNumber = 1;

  while (usedFrameNumbers.has(nextFrameNumber)) {
    nextFrameNumber += 1;
  }

  return `프레임 ${nextFrameNumber}`;
}
