"use client";

import { useEffect, useState } from "react";
import { useValue } from "@tldraw/state-react";
import {
  Maximize,
  MousePointer2,
  Palette,
  Square,
  StickyNote
} from "lucide-react";
import type { Editor } from "tldraw";

import { isSqlErdFrameShape } from "@/features/sql-erd/shapes/sql-erd-frame-shape";
import type { SqltoerdCanvasFrameColor } from "@/features/sql-erd/types";

type SqlErdCanvasToolbarProps = {
  editor: Editor;
  isFrameLimitReached: boolean;
  isNoteLimitReached: boolean;
  onAddFrame: () => void;
  onAddNote: () => void;
  onFit: () => void;
  onFrameColorChange: (
    frameId: string,
    color: SqltoerdCanvasFrameColor
  ) => void;
};

const frameColors: readonly {
  color: SqltoerdCanvasFrameColor;
  label: string;
  swatchClassName: string;
}[] = [
  { color: "slate", label: "회색", swatchClassName: "bg-slate-500" },
  { color: "blue", label: "파랑", swatchClassName: "bg-blue-500" },
  { color: "green", label: "초록", swatchClassName: "bg-emerald-500" },
  { color: "amber", label: "노랑", swatchClassName: "bg-amber-500" },
  { color: "rose", label: "분홍", swatchClassName: "bg-rose-500" }
];

const toolbarButtonClassName =
  "inline-flex size-10 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-40";

export function SqlErdCanvasToolbar({
  editor,
  isFrameLimitReached,
  isNoteLimitReached,
  onAddFrame,
  onAddNote,
  onFit,
  onFrameColorChange
}: SqlErdCanvasToolbarProps) {
  const [isColorMenuOpen, setIsColorMenuOpen] = useState(false);
  const selectedShape = useValue(
    "sqltoerd-annotation-toolbar-selected-shape",
    () => editor.getOnlySelectedShape(),
    [editor]
  );

  useEffect(() => {
    if (!isSqlErdFrameShape(selectedShape)) {
      setIsColorMenuOpen(false);
    }
  }, [selectedShape]);

  return (
    <aside
      aria-label="SQLtoERD 캔버스 도구"
      className="absolute left-4 top-4 z-20 flex w-12 flex-col items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
    >
      <button
        aria-label="선택/드래그"
        className={toolbarButtonClassName}
        onClick={() => {
          editor.cancel();
          editor.setCurrentTool("select.idle");
        }}
        title="선택/드래그"
        type="button"
      >
        <MousePointer2 aria-hidden="true" className="size-5" />
      </button>
      <button
        aria-label="메모 추가"
        className={toolbarButtonClassName}
        disabled={isNoteLimitReached}
        onClick={onAddNote}
        title="메모 추가"
        type="button"
      >
        <StickyNote aria-hidden="true" className="size-5" />
      </button>
      <button
        aria-label="프레임 추가"
        className={toolbarButtonClassName}
        disabled={isFrameLimitReached}
        onClick={onAddFrame}
        title="프레임 추가"
        type="button"
      >
        <Square aria-hidden="true" className="size-5" />
      </button>
      {isSqlErdFrameShape(selectedShape) ? (
        <div className="relative">
          <button
            aria-expanded={isColorMenuOpen}
            aria-haspopup="menu"
            aria-label="프레임 색상"
            className={toolbarButtonClassName}
            onClick={() => setIsColorMenuOpen((isOpen) => !isOpen)}
            title="프레임 색상"
            type="button"
          >
            <Palette aria-hidden="true" className="size-5" />
          </button>
          {isColorMenuOpen ? (
            <div
              aria-label="프레임 색상 선택"
              className="absolute left-full top-0 ml-2 flex gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg"
              role="menu"
            >
              {frameColors.map(({ color, label, swatchClassName }) => (
                <button
                  aria-label={`${label} 프레임 색상`}
                  className="inline-flex size-7 items-center justify-center rounded-md hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  key={color}
                  onClick={() => {
                    if (!isSqlErdFrameShape(selectedShape)) {
                      return;
                    }

                    onFrameColorChange(selectedShape.props.frameId, color);
                    setIsColorMenuOpen(false);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`size-4 rounded-full ${swatchClassName}`}
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div aria-hidden="true" className="my-1 h-px w-8 bg-slate-200" />
      <button
        aria-label="화면 맞춤"
        className={toolbarButtonClassName}
        onClick={onFit}
        title="화면 맞춤"
        type="button"
      >
        <Maximize aria-hidden="true" className="size-5" />
      </button>
    </aside>
  );
}
