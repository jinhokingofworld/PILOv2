"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor, type Editor } from "tldraw";
import { useValue } from "@tldraw/state-react";
import {
  isPiloFrameShape,
  type PiloFramePartial,
  type PiloFrameShape,
} from "../PiloCanvasShapeGuards";
import { normalizeBlankFrameName } from "./PiloFrameShapeUtil";

const frameColorOptions: {
  label: string;
  value: PiloFrameShape["props"]["color"];
}[] = [
  { label: "검정", value: "black" },
  { label: "회색", value: "grey" },
  { label: "보라", value: "violet" },
  { label: "파랑", value: "blue" },
  { label: "노랑", value: "yellow" },
  { label: "주황", value: "orange" },
  { label: "초록", value: "green" },
  { label: "빨강", value: "red" },
  { label: "흰색", value: "white" },
];

const frameRatioPresets = [
  { key: "16-9", label: "16:9", width: 480, height: 270 },
  { key: "4-3", label: "4:3", width: 400, height: 300 },
  { key: "1-1", label: "1:1", width: 320, height: 320 },
  { key: "phone", label: "휴대폰", width: 210, height: 380 },
  { key: "browser", label: "브라우저", width: 520, height: 325 },
];

function buildFrameSizePartial(
  shape: PiloFrameShape,
  preset: (typeof frameRatioPresets)[number],
): PiloFramePartial {
  const center = {
    x: shape.x + shape.props.w / 2,
    y: shape.y + shape.props.h / 2,
  };

  return {
    id: shape.id,
    type: shape.type,
    x: center.x - preset.width / 2,
    y: center.y - preset.height / 2,
    props: {
      w: preset.width,
      h: preset.height,
      name: normalizeBlankFrameName(shape.props.name),
    },
  };
}

function updateFrame(
  editor: Editor,
  shape: PiloFrameShape,
  partial: PiloFramePartial,
) {
  editor.updateShapes([partial]);
  editor.select(shape.id);
}

export function FrameSelectionToolbar() {
  const editor = useEditor();
  const [openMenu, setOpenMenu] = useState<"ratio" | "color" | null>(null);
  const toolbarState = useValue(
    "pilo-selected-frame-toolbar",
    () => {
      const selectedFrame = editor.getSelectedShapes().find(isPiloFrameShape);

      if (!selectedFrame) return null;

      const bounds = editor.getShapePageBounds(selectedFrame.id);

      if (!bounds) return null;

      const viewportBounds = editor.getViewportScreenBounds();
      const topCenter = editor.pageToViewport({
        x: bounds.x + bounds.w / 2,
        y: bounds.y + bounds.h,
      });
      const toolbarHalfWidth = 132;
      const clampedLeft = Math.min(
        Math.max(topCenter.x, toolbarHalfWidth + 12),
        Math.max(
          toolbarHalfWidth + 12,
          viewportBounds.w - toolbarHalfWidth - 12,
        ),
      );

      return {
        frame: selectedFrame,
        left: clampedLeft,
        top: topCenter.y + 12,
      };
    },
    [editor],
  );

  if (!toolbarState) return null;

  const selectedFrame = toolbarState.frame;

  function toggleMenu(menu: "ratio" | "color") {
    setOpenMenu((currentMenu) => (currentMenu === menu ? null : menu));
  }

  function applyFramePreset(preset: (typeof frameRatioPresets)[number]) {
    updateFrame(
      editor,
      selectedFrame,
      buildFrameSizePartial(selectedFrame, preset),
    );
    setOpenMenu(null);
  }

  function applyFrameColor(color: PiloFrameShape["props"]["color"]) {
    updateFrame(editor, selectedFrame, {
      id: selectedFrame.id,
      type: selectedFrame.type,
      props: {
        color,
      },
    });
    setOpenMenu(null);
  }

  function toggleFrameLock() {
    setOpenMenu(null);
    editor.toggleLock([selectedFrame.id]);
    editor.select(selectedFrame.id);
  }

  function handleToolbarPointerEvent(event: ReactPointerEvent<HTMLElement>) {
    editor.markEventAsHandled(event);
    event.stopPropagation();
  }

  return (
    <div
      className="pilo-frame-toolbar"
      style={{
        left: toolbarState.left,
        top: toolbarState.top,
      }}
      onPointerDownCapture={handleToolbarPointerEvent}
      onPointerUpCapture={handleToolbarPointerEvent}
    >
      <button
        type="button"
        className="pilo-frame-toolbar-ratio"
        data-tooltip="프레임 비율"
        onClick={() => toggleMenu("ratio")}
      >
        <span>비율</span>
      </button>
      <button
        type="button"
        aria-label="프레임 색상"
        data-tooltip="프레임 색상"
        onClick={() => toggleMenu("color")}
      >
        <span
          className={`pilo-frame-toolbar-swatch is-${selectedFrame.props.color}`}
        />
      </button>
      <button
        type="button"
        aria-label={selectedFrame.isLocked ? "프레임 잠금 해제" : "프레임 잠금"}
        data-tooltip={selectedFrame.isLocked ? "잠금 해제" : "잠금"}
        onClick={toggleFrameLock}
      >
        <FrameToolbarIcon type={selectedFrame.isLocked ? "unlock" : "lock"} />
      </button>
      {openMenu === "ratio" ? (
        <div className="pilo-frame-dropdown pilo-frame-ratio-menu">
          {frameRatioPresets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={`pilo-frame-ratio-option is-${preset.key}`}
              data-tooltip={preset.label}
              onClick={() => applyFramePreset(preset)}
            >
              <span aria-hidden="true" />
              <strong>{preset.label}</strong>
            </button>
          ))}
        </div>
      ) : null}
      {openMenu === "color" ? (
        <div className="pilo-frame-dropdown pilo-frame-color-menu">
          <strong>색상</strong>
          <div className="pilo-frame-color-grid">
            {frameColorOptions.map((color) => (
              <button
                key={color.value}
                type="button"
                className={`pilo-frame-color-option is-${color.value}`}
                data-tooltip={color.label}
                aria-label={`${color.label} 적용`}
                onClick={() => applyFrameColor(color.value)}
              >
                {selectedFrame.props.color === color.value ? (
                  <span aria-hidden="true">✓</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FrameToolbarIcon({ type }: { type: "lock" | "unlock" }) {
  const commonProps = {
    "aria-hidden": true,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (type === "unlock") {
    return (
      <svg {...commonProps}>
        <rect x="5.5" y="10" width="13" height="10" rx="2.4" />
        <path d="M8.5 10V7.2a3.5 3.5 0 0 1 6.4-2" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <rect x="5.5" y="10" width="13" height="10" rx="2.4" />
      <path d="M8.5 10V7.2a3.5 3.5 0 0 1 7 0V10" />
    </svg>
  );
}
