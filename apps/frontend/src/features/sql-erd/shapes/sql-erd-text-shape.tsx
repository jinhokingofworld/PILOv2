"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useValue } from "@tldraw/state-react";
import {
  HTMLContainer,
  Rectangle2d,
  resizeBox,
  ShapeUtil,
  T,
  useEditor,
  type TLBaseShape,
  type TLResizeInfo,
  type TLShape
} from "tldraw";

import type { SqltoerdCanvasFrameColor } from "@/features/sql-erd/types";

export const SQLTOERD_TEXT_SHAPE_TYPE = "sqltoerd_text";
export const SQLTOERD_TEXT_CHANGE_EVENT = "sqltoerd:text-change";

export type SqlErdTextChangeEventDetail = {
  textId: string;
  patch: Partial<Pick<SqlErdTextShapeProps, "text" | "color">>;
};

export type SqlErdTextShapeProps = {
  w: number;
  h: number;
  textId: string;
  text: string;
  color: SqltoerdCanvasFrameColor;
};

export type SqlErdTextShape = TLBaseShape<
  typeof SQLTOERD_TEXT_SHAPE_TYPE,
  SqlErdTextShapeProps
>;

export function isSqlErdTextShape(
  shape: TLShape | null | undefined
): shape is SqlErdTextShape {
  return shape?.type === SQLTOERD_TEXT_SHAPE_TYPE;
}

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    [SQLTOERD_TEXT_SHAPE_TYPE]: SqlErdTextShapeProps;
  }
}

const textColorClasses: Record<SqltoerdCanvasFrameColor, string> = {
  slate: "text-slate-700",
  blue: "text-blue-700",
  green: "text-emerald-700",
  amber: "text-amber-700",
  rose: "text-rose-700"
};

export class SqlErdTextShapeUtil extends ShapeUtil<SqlErdTextShape> {
  static override type = SQLTOERD_TEXT_SHAPE_TYPE;
  static override props = {
    w: T.number,
    h: T.number,
    textId: T.string,
    text: T.string,
    color: T.string
  };

  override canBind() {
    return false;
  }

  override canEdit() {
    return false;
  }

  override hideRotateHandle() { return true; }

  override canResize() {
    return true;
  }

  override onResize(shape: SqlErdTextShape, info: TLResizeInfo<SqlErdTextShape>) {
    return resizeBox(shape, info, { minWidth: 80, minHeight: 40 });
  }

  override getDefaultProps(): SqlErdTextShape["props"] {
    return {
      w: 240,
      h: 72,
      textId: "",
      text: "",
      color: "slate"
    };
  }

  override getGeometry(shape: SqlErdTextShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: false
    });
  }

  override component(shape: SqlErdTextShape) {
    return <SqlErdTextBox shape={shape} />;
  }

  override getIndicatorPath(shape: SqlErdTextShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}

function SqlErdTextBox({ shape }: { shape: SqlErdTextShape }) {
  const editor = useEditor();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(shape.props.text);
  const isSelected = useValue(
    `sqltoerd-text-selected-${shape.id}`,
    () => editor.getOnlySelectedShape()?.id === shape.id,
    [editor, shape.id]
  );

  useEffect(() => setDraft(shape.props.text), [shape.props.text]);

  function commit() {
    if (draft !== shape.props.text) {
      window.dispatchEvent(
        new CustomEvent<SqlErdTextChangeEventDetail>(SQLTOERD_TEXT_CHANGE_EVENT, {
          detail: { textId: shape.props.textId, patch: { text: draft } }
        })
      );
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(shape.props.text);
      textareaRef.current?.blur();
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLTextAreaElement>) {
    event.stopPropagation();
  }

  return (
    <HTMLContainer style={{ height: shape.props.h, width: shape.props.w }}>
      <textarea
        aria-label="텍스트 annotation"
        className={`h-full w-full resize-none bg-transparent text-base leading-6 outline-none ${textColorClasses[shape.props.color]}`}
        data-sqltoerd-text-id={shape.props.textId}
        maxLength={2000}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        ref={textareaRef}
        style={{ pointerEvents: isSelected ? "auto" : "none" }}
        value={draft}
      />
    </HTMLContainer>
  );
}
