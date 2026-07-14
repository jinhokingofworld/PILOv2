"use client";

import { useEffect, useState } from "react";
import { useValue } from "@tldraw/state-react";
import {
  Maximize,
  MousePointer2,
  Palette,
  Square,
  StickyNote,
  Type
} from "lucide-react";
import type { Editor } from "tldraw";

import { isSqlErdFrameShape } from "@/features/sql-erd/shapes/sql-erd-frame-shape";
import { isSqlErdTextShape } from "@/features/sql-erd/shapes/sql-erd-text-shape";
import type { SqltoerdCanvasFrameColor } from "@/features/sql-erd/types";

export type SqlErdCanvasPlacementTool = "note" | "frame" | "text" | null;

type SqlErdCanvasToolbarProps = {
  editor: Editor;
  isFrameLimitReached: boolean;
  isNoteLimitReached: boolean;
  isTextLimitReached: boolean;
  nextFrameColor: SqltoerdCanvasFrameColor;
  nextTextColor: SqltoerdCanvasFrameColor;
  placementTool: SqlErdCanvasPlacementTool;
  onFit: () => void;
  onFrameColorChange: (
    frameId: string,
    color: SqltoerdCanvasFrameColor
  ) => void;
  onSelectTool: () => void;
  onStartPlacement: (tool: Exclude<SqlErdCanvasPlacementTool, null>) => void;
  onTextColorChange: (
    textId: string,
    color: SqltoerdCanvasFrameColor
  ) => void;
  onNextFrameColorChange: (color: SqltoerdCanvasFrameColor) => void;
  onNextTextColorChange: (color: SqltoerdCanvasFrameColor) => void;
};

const annotationColors: readonly {
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
const activeToolbarButtonClassName = "bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700";

export function SqlErdCanvasToolbar({
  editor,
  isFrameLimitReached,
  isNoteLimitReached,
  isTextLimitReached,
  nextFrameColor,
  nextTextColor,
  placementTool,
  onFit,
  onFrameColorChange,
  onSelectTool,
  onStartPlacement,
  onTextColorChange,
  onNextFrameColorChange,
  onNextTextColorChange
}: SqlErdCanvasToolbarProps) {
  const [isColorMenuOpen, setIsColorMenuOpen] = useState(false);
  const selectedShape = useValue(
    "sqltoerd-annotation-toolbar-selected-shape",
    () => editor.getOnlySelectedShape(),
    [editor]
  );
  const selectedFrame = isSqlErdFrameShape(selectedShape) ? selectedShape : null;
  const selectedText = isSqlErdTextShape(selectedShape) ? selectedShape : null;
  const canSetColor = Boolean(
    selectedFrame || selectedText || placementTool === "frame" || placementTool === "text"
  );
  const activeColor = selectedFrame?.props.color ?? selectedText?.props.color ??
    (placementTool === "frame" ? nextFrameColor : nextTextColor);
  const colorTargetLabel = selectedFrame
    ? "프레임 색상"
    : selectedText
      ? "텍스트 색상"
      : placementTool === "frame"
        ? "새 프레임 색상"
        : "새 텍스트 색상";

  useEffect(() => {
    if (!canSetColor) {
      setIsColorMenuOpen(false);
    }
  }, [canSetColor]);

  function applyColor(color: SqltoerdCanvasFrameColor) {
    if (selectedFrame) {
      onFrameColorChange(selectedFrame.props.frameId, color);
    } else if (selectedText) {
      onTextColorChange(selectedText.props.textId, color);
    } else if (placementTool === "frame") {
      onNextFrameColorChange(color);
    } else if (placementTool === "text") {
      onNextTextColorChange(color);
    } else {
      return;
    }

    setIsColorMenuOpen(false);
  }

  return (
    <aside
      aria-label="SQLtoERD 캔버스 도구"
      className="absolute bottom-4 left-1/2 z-20 flex h-12 -translate-x-1/2 items-center gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
      data-sqltoerd-canvas-toolbar
    >
      <button
        aria-label="선택/드래그"
        className={`${toolbarButtonClassName} ${placementTool === null ? activeToolbarButtonClassName : ""}`}
        onClick={onSelectTool}
        title="선택/드래그"
        type="button"
      >
        <MousePointer2 aria-hidden="true" className="size-5" />
      </button>
      <button
        aria-label="메모 추가"
        className={`${toolbarButtonClassName} ${placementTool === "note" ? activeToolbarButtonClassName : ""}`}
        disabled={isNoteLimitReached}
        onClick={() => onStartPlacement("note")}
        title="메모 추가"
        type="button"
      >
        <StickyNote aria-hidden="true" className="size-5" />
      </button>
      <button
        aria-label="프레임 추가"
        className={`${toolbarButtonClassName} ${placementTool === "frame" ? activeToolbarButtonClassName : ""}`}
        disabled={isFrameLimitReached}
        onClick={() => onStartPlacement("frame")}
        title="프레임 추가"
        type="button"
      >
        <Square aria-hidden="true" className="size-5" />
      </button>
      <button
        aria-label="텍스트 추가"
        className={`${toolbarButtonClassName} ${placementTool === "text" ? activeToolbarButtonClassName : ""}`}
        disabled={isTextLimitReached}
        onClick={() => onStartPlacement("text")}
        title="텍스트 추가"
        type="button"
      >
        <Type aria-hidden="true" className="size-5" />
      </button>
      <div aria-hidden="true" className="mx-1 h-8 w-px bg-slate-200" />
      <div className="relative">
        <button
          aria-expanded={isColorMenuOpen}
          aria-haspopup="menu"
          aria-label={colorTargetLabel}
          className={toolbarButtonClassName}
          disabled={!canSetColor}
          onClick={() => setIsColorMenuOpen((isOpen) => !isOpen)}
          title={colorTargetLabel}
          type="button"
        >
          <Palette aria-hidden="true" className="size-5" />
          <span
            aria-hidden="true"
            className={`absolute bottom-1.5 size-2 rounded-full ${annotationColors.find(({ color }) => color === activeColor)?.swatchClassName ?? "bg-slate-500"}`}
          />
        </button>
        {isColorMenuOpen ? (
          <div
            aria-label={`${colorTargetLabel} 선택`}
            className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg"
            role="menu"
          >
            {annotationColors.map(({ color, label, swatchClassName }) => (
              <button
                aria-label={`${label} ${colorTargetLabel}`}
                className="inline-flex size-7 items-center justify-center rounded-md hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                key={color}
                onClick={() => applyColor(color)}
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
      <div aria-hidden="true" className="mx-1 h-8 w-px bg-slate-200" />
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
