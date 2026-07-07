"use client";

import type { CSSProperties, PointerEvent, WheelEvent } from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  useEditor,
  type TLBaseShape,
  type TLResizeInfo,
} from "tldraw";
import { useValue } from "@tldraw/state-react";

export const piloStickyNoteColors = [
  { value: "butter", label: "버터", fill: "#fff6a8", border: "#d8b52a" },
  { value: "lemon", label: "레몬", fill: "#ffe778", border: "#d6a91f" },
  { value: "peach", label: "복숭아", fill: "#ffbb78", border: "#df8240" },
  { value: "coral", label: "코랄", fill: "#ff9299", border: "#e46370" },
  { value: "pink", label: "핑크", fill: "#f9c1e9", border: "#df6ec0" },
  { value: "magenta", label: "마젠타", fill: "#ef86d8", border: "#ce55b8" },
  { value: "sky", label: "하늘", fill: "#a9c9f7", border: "#6c9ad9" },
  { value: "violet", label: "보라", fill: "#aaa1ef", border: "#7c6ed9" },
  { value: "cyan", label: "시안", fill: "#8edcf0", border: "#4caecb" },
  { value: "blue", label: "파랑", fill: "#82aef0", border: "#4d7ed2" },
  { value: "mint", label: "민트", fill: "#78d8cf", border: "#45aaa0" },
  { value: "green", label: "초록", fill: "#67d886", border: "#3aa65b" },
  { value: "lime", label: "라임", fill: "#cbeca0", border: "#93bf52" },
  { value: "grass", label: "연두", fill: "#aee755", border: "#7eba28" },
  { value: "white", label: "흰색", fill: "#f4f5f7", border: "#c7ccd5" },
  { value: "black", label: "검정", fill: "#171717", border: "#050505" },
] as const;

export type PiloStickyNoteColor =
  (typeof piloStickyNoteColors)[number]["value"];

type PiloStickyNoteShapeProps = {
  w: number;
  h: number;
  color: PiloStickyNoteColor;
  text: string;
};

export type PiloStickyNoteShape = TLBaseShape<
  "pilo-sticky-note",
  PiloStickyNoteShapeProps
>;

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    "pilo-sticky-note": PiloStickyNoteShapeProps;
  }
}

const stickyColorMap = Object.fromEntries(
  piloStickyNoteColors.map((color) => [color.value, color]),
) as Record<PiloStickyNoteColor, (typeof piloStickyNoteColors)[number]>;

function PiloStickyNoteComponent({ shape }: { shape: PiloStickyNoteShape }) {
  const editor = useEditor();
  const isEditing = useValue(
    "pilo-sticky-note-editing",
    () => editor.getEditingShapeId() === shape.id,
    [editor, shape.id],
  );
  const color = stickyColorMap[shape.props.color] ?? stickyColorMap.butter;

  function updateText(text: string) {
    const currentShape = editor.getShape(shape.id);

    if (!currentShape || currentShape.type !== shape.type) return;

    editor.updateShapes([
      {
        id: currentShape.id,
        type: currentShape.type,
        props: { text },
      },
    ]);
  }

  function handleEditorPointerDown(event: PointerEvent<HTMLElement>) {
    editor.markEventAsHandled(event);
    event.stopPropagation();
  }

  function handleNoteWheel(event: WheelEvent<HTMLElement>) {
    event.stopPropagation();
  }

  return (
    <HTMLContainer
      className="pilo-sticky-note-shape"
      style={
        {
          width: shape.props.w,
          height: shape.props.h,
          "--pilo-sticky-fill": color.fill,
          "--pilo-sticky-border": color.border,
        } as CSSProperties
      }
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (editor.getShape(shape.id)?.type === shape.type) {
          editor.setEditingShape(shape.id);
        }
      }}
    >
      <article className="pilo-sticky-note">
        {isEditing ? (
          <textarea
            autoFocus
            aria-label="메모 내용"
            value={shape.props.text}
            placeholder="메모를 입력하세요"
            onBlur={() => editor.setEditingShape(null)}
            onChange={(event) => updateText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                editor.setEditingShape(null);
              }
            }}
            onPointerDown={handleEditorPointerDown}
            onWheelCapture={handleNoteWheel}
          />
        ) : (
          <p onWheelCapture={handleNoteWheel}>{shape.props.text}</p>
        )}
      </article>
    </HTMLContainer>
  );
}

export class PiloStickyNoteShapeUtil extends ShapeUtil<PiloStickyNoteShape> {
  static override type = "pilo-sticky-note" as const;

  static override props = {
    w: T.number,
    h: T.number,
    color: T.literalEnum(
      "butter",
      "lemon",
      "peach",
      "coral",
      "pink",
      "magenta",
      "sky",
      "violet",
      "cyan",
      "blue",
      "mint",
      "green",
      "lime",
      "grass",
      "white",
      "black",
    ),
    text: T.string,
  };

  override canEdit() {
    return true;
  }

  override getDefaultProps(): PiloStickyNoteShape["props"] {
    return {
      w: 156,
      h: 148,
      color: "butter",
      text: "",
    };
  }

  override getGeometry(shape: PiloStickyNoteShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override onResize(
    _shape: PiloStickyNoteShape,
    info: TLResizeInfo<PiloStickyNoteShape>,
  ) {
    return {
      props: {
        w: Math.max(112, info.initialShape.props.w * Math.abs(info.scaleX)),
        h: Math.max(104, info.initialShape.props.h * Math.abs(info.scaleY)),
      },
    };
  }

  override component(shape: PiloStickyNoteShape) {
    return <PiloStickyNoteComponent shape={shape} />;
  }

  override getIndicatorPath(shape: PiloStickyNoteShape) {
    const path = new Path2D();

    path.rect(0, 0, shape.props.w, shape.props.h);

    return path;
  }
}
