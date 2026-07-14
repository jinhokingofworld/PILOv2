"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type TLBaseShape,
  type TLShape
} from "tldraw";

export const SQLTOERD_NOTE_SHAPE_TYPE = "sqltoerd_note";
export const SQLTOERD_NOTE_CHANGE_EVENT = "sqltoerd:note-change";
export const SQLTOERD_NOTE_DELETE_EVENT = "sqltoerd:note-delete";

export type SqlErdNoteChangeEventDetail = { noteId: string; text: string };
export type SqlErdNoteDeleteEventDetail = { noteId: string };

export type SqlErdNoteShapeProps = {
  w: number;
  h: number;
  noteId: string;
  text: string;
};

export type SqlErdNoteShape = TLBaseShape<
  typeof SQLTOERD_NOTE_SHAPE_TYPE,
  SqlErdNoteShapeProps
>;

export function isSqlErdNoteShape(
  shape: TLShape | null | undefined
): shape is SqlErdNoteShape {
  return shape?.type === SQLTOERD_NOTE_SHAPE_TYPE;
}

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    [SQLTOERD_NOTE_SHAPE_TYPE]: SqlErdNoteShapeProps;
  }
}

export class SqlErdNoteShapeUtil extends ShapeUtil<SqlErdNoteShape> {
  static override type = SQLTOERD_NOTE_SHAPE_TYPE;
  static override props = {
    w: T.number,
    h: T.number,
    noteId: T.string,
    text: T.string
  };

  override canBind() { return false; }
  override canEdit() { return false; }
  override canResize() { return true; }
  override getDefaultProps(): SqlErdNoteShape["props"] {
    return { w: 240, h: 160, noteId: "", text: "" };
  }
  override getGeometry(shape: SqlErdNoteShape) {
    return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true });
  }
  override component(shape: SqlErdNoteShape) {
    return <SqlErdNoteCard shape={shape} />;
  }
  override getIndicatorPath(shape: SqlErdNoteShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 6);
    return path;
  }
}

function SqlErdNoteCard({ shape }: { shape: SqlErdNoteShape }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(shape.props.text);

  useEffect(() => setDraft(shape.props.text), [shape.props.text]);

  function commit() {
    if (draft !== shape.props.text) {
      window.dispatchEvent(new CustomEvent<SqlErdNoteChangeEventDetail>(SQLTOERD_NOTE_CHANGE_EVENT, {
        detail: { noteId: shape.props.noteId, text: draft }
      }));
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(shape.props.text);
      textareaRef.current?.blur();
    }
  }

  return <HTMLContainer style={{ height: shape.props.h, width: shape.props.w }}>
    <div className="h-full w-full rounded-md border border-amber-300 bg-amber-100 p-3 text-sm text-slate-800 shadow-sm" data-sqltoerd-note-id={shape.props.noteId}>
      <div className="mb-2 flex justify-end">
        <button aria-label="메모 삭제" className="rounded p-1 hover:bg-amber-200" onClick={() => window.dispatchEvent(new CustomEvent<SqlErdNoteDeleteEventDetail>(SQLTOERD_NOTE_DELETE_EVENT, { detail: { noteId: shape.props.noteId } }))} type="button">
          <Trash2 aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      <textarea className="h-[calc(100%-2rem)] w-full resize-none bg-transparent outline-none" maxLength={2000} onBlur={commit} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} ref={textareaRef} value={draft} />
    </div>
  </HTMLContainer>;
}
