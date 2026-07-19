"use client";

import { Lock, LockOpen, Trash2 } from "lucide-react";
import { useEffect, useState, type PointerEvent } from "react";
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

export const SQLTOERD_FRAME_SHAPE_TYPE = "sqltoerd_frame";
export const SQLTOERD_FRAME_CHANGE_EVENT = "sqltoerd:frame-change";
export const SQLTOERD_FRAME_DELETE_EVENT = "sqltoerd:frame-delete";
export type SqlErdFrameChangeEventDetail = {
  frameId: string;
  patch: Partial<Pick<SqlErdFrameShapeProps, "title" | "color" | "isLocked">>;
};
export type SqlErdFrameDeleteEventDetail = { frameId: string };
export type SqlErdFrameShapeProps = {
  w: number; h: number; frameId: string; title: string;
  color: SqltoerdCanvasFrameColor; isLocked: boolean;
};
export type SqlErdFrameShape = TLBaseShape<typeof SQLTOERD_FRAME_SHAPE_TYPE, SqlErdFrameShapeProps>;
export function isSqlErdFrameShape(shape: TLShape | null | undefined): shape is SqlErdFrameShape {
  return shape?.type === SQLTOERD_FRAME_SHAPE_TYPE;
}
declare module "@tldraw/tlschema" { interface TLGlobalShapePropsMap { [SQLTOERD_FRAME_SHAPE_TYPE]: SqlErdFrameShapeProps; } }
const frameClasses: Record<SqltoerdCanvasFrameColor, string> = {
  slate: "border-slate-400 bg-slate-100/35 text-slate-700", blue: "border-blue-400 bg-blue-100/35 text-blue-800", green: "border-emerald-400 bg-emerald-100/35 text-emerald-800", amber: "border-amber-400 bg-amber-100/35 text-amber-800", rose: "border-rose-400 bg-rose-100/35 text-rose-800"
};

export function getSqlErdFrameControlScale(width: number, height: number) {
  return Math.min(2, Math.max(1, Math.min(width / 640, height / 420)));
}
export class SqlErdFrameShapeUtil extends ShapeUtil<SqlErdFrameShape> {
  static override type = SQLTOERD_FRAME_SHAPE_TYPE;
  static override props = { w: T.number, h: T.number, frameId: T.string, title: T.string, color: T.string, isLocked: T.boolean };
  override canBind() { return false; }
  override hideRotateHandle() { return true; }
  override canResize(shape: SqlErdFrameShape) { return !shape.props.isLocked; }
  override onResize(shape: SqlErdFrameShape, info: TLResizeInfo<SqlErdFrameShape>) {
    return resizeBox(shape, info, { minWidth: 200, minHeight: 120 });
  }
  override onBeforeUpdate(prev: SqlErdFrameShape, next: SqlErdFrameShape) {
    if (!prev.props.isLocked) return;
    return { ...next, x: prev.x, y: prev.y, props: { ...next.props, w: prev.props.w, h: prev.props.h } };
  }
  override getDefaultProps(): SqlErdFrameShape["props"] { return { w: 640, h: 420, frameId: "", title: "프레임", color: "blue", isLocked: false }; }
  override getGeometry(shape: SqlErdFrameShape) { return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: false }); }
  override component(shape: SqlErdFrameShape) {
    return <SqlErdFrameBox shape={shape} />;
  }
  override getIndicatorPath(shape: SqlErdFrameShape) { const path = new Path2D(); path.roundRect(0, 0, shape.props.w, shape.props.h, 6); return path; }
}

function SqlErdFrameBox({ shape }: { shape: SqlErdFrameShape }) {
  const editor = useEditor();
  const controlScale = getSqlErdFrameControlScale(shape.props.w, shape.props.h);
  const [title, setTitle] = useState(shape.props.title);
  useEffect(() => setTitle(shape.props.title), [shape.props.title]);
  function emit(patch: SqlErdFrameChangeEventDetail["patch"]) {
    window.dispatchEvent(new CustomEvent<SqlErdFrameChangeEventDetail>(SQLTOERD_FRAME_CHANGE_EVENT, {
      detail: { frameId: shape.props.frameId, patch }
    }));
  }

  function stopCanvasPointerHandling(event: PointerEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function handleLockToggle() {
    editor.select(shape.id);
    emit({ isLocked: !shape.props.isLocked });
  }

  return <HTMLContainer style={{ height: shape.props.h, pointerEvents: "none", width: shape.props.w }}>
    <div className={`h-full w-full rounded-md border-2 ${frameClasses[shape.props.color]}`} data-sqltoerd-frame-id={shape.props.frameId}>
      <div
        className="flex items-center gap-1 px-3 py-2"
        style={{
          pointerEvents: "auto",
          transform: `scale(${controlScale})`,
          transformOrigin: "top left",
          width: `${100 / controlScale}%`
        }}
      >
        <input aria-label="프레임 제목" className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" maxLength={200} onBlur={() => title !== shape.props.title && emit({ title })} onChange={(event) => setTitle(event.target.value)} onPointerDown={stopCanvasPointerHandling} value={title} />
        <select aria-label="프레임 색상" className="rounded border bg-white/80 text-xs" onChange={(event) => emit({ color: event.target.value as SqltoerdCanvasFrameColor })} onPointerDown={stopCanvasPointerHandling} value={shape.props.color}>
          <option value="slate">회색</option><option value="blue">파랑</option><option value="green">초록</option><option value="amber">노랑</option><option value="rose">분홍</option>
        </select>
        <button aria-label={shape.props.isLocked ? "프레임 잠금 해제" : "프레임 잠금"} className="rounded p-1 hover:bg-white/60" onClick={handleLockToggle} onPointerDown={stopCanvasPointerHandling} type="button">
          {shape.props.isLocked ? <Lock aria-hidden="true" className="size-3.5" /> : <LockOpen aria-hidden="true" className="size-3.5" />}
        </button>
        {!shape.props.isLocked ? (
          <button aria-label="프레임 삭제" className="rounded p-1 hover:bg-white/60" onClick={() => window.dispatchEvent(new CustomEvent<SqlErdFrameDeleteEventDetail>(SQLTOERD_FRAME_DELETE_EVENT, { detail: { frameId: shape.props.frameId } }))} onPointerDown={stopCanvasPointerHandling} type="button">
            <Trash2 aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  </HTMLContainer>;
}
