"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor, type Editor } from "tldraw";
import { useValue } from "@tldraw/state-react";
import {
  isPiloFrameShape,
  type PiloFramePartial,
  type PiloFrameShape,
} from "../PiloCanvasShapeGuards";
import {
  getPiloChildShapeCount,
  isPiloFrameCollapsed,
} from "./canvas-frame-collapse";
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

const FRAME_TOOLBAR_BASE_WIDTH = 264;

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
  const currentShape = editor.getShape(shape.id);

  if (!isPiloFrameShape(currentShape)) return;

  editor.updateShapes([partial]);
  editor.select(shape.id);
}

export function FrameSelectionToolbar({
  onFrameCollapsedChange,
}: {
  onFrameCollapsedChange?: (
    frame: PiloFrameShape,
    nextCollapsed: boolean,
  ) => void;
}) {
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
      const camera = editor.getCamera();
      const topCenter = editor.pageToViewport({
        x: bounds.x + bounds.w / 2,
        y: bounds.y + bounds.h,
      });
      const frameViewportWidth = bounds.w * camera.z;
      const toolbarScale = Math.min(
        1,
        Math.max(0.01, frameViewportWidth / FRAME_TOOLBAR_BASE_WIDTH),
      );
      const toolbarHalfWidth = (FRAME_TOOLBAR_BASE_WIDTH * toolbarScale) / 2;
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
        scale: toolbarScale,
        top: topCenter.y + 12 * toolbarScale,
      };
    },
    [editor],
  );

  if (!toolbarState) return null;

  const selectedFrame = toolbarState.frame;
  const isCollapsed = isPiloFrameCollapsed(selectedFrame);
  const childShapeCount = getPiloChildShapeCount(selectedFrame);

  if (isCollapsed) return null;

  function toggleMenu(menu: "ratio" | "color") {
    setOpenMenu((currentMenu) => (currentMenu === menu ? null : menu));
  }

  function applyFramePreset(preset: (typeof frameRatioPresets)[number]) {
    const currentFrame = editor.getShape(selectedFrame.id);

    if (!isPiloFrameShape(currentFrame)) return;

    updateFrame(
      editor,
      currentFrame,
      buildFrameSizePartial(currentFrame, preset),
    );
    setOpenMenu(null);
  }

  function applyFrameColor(color: PiloFrameShape["props"]["color"]) {
    const currentFrame = editor.getShape(selectedFrame.id);

    if (!isPiloFrameShape(currentFrame)) return;

    updateFrame(editor, currentFrame, {
      id: currentFrame.id,
      type: currentFrame.type,
      props: {
        color,
      },
    });
    setOpenMenu(null);
  }

  function toggleFrameLock() {
    const currentFrame = editor.getShape(selectedFrame.id);

    if (!isPiloFrameShape(currentFrame)) return;

    setOpenMenu(null);
    editor.toggleLock([currentFrame.id]);
    editor.select(currentFrame.id);
  }

  function toggleFrameCollapsed() {
    const currentFrame = editor.getShape(selectedFrame.id);

    if (!isPiloFrameShape(currentFrame)) return;

    const nextCollapsed = !isCollapsed;

    setOpenMenu(null);
    onFrameCollapsedChange?.(currentFrame, nextCollapsed);
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
        transform: `translateX(-50%) scale(${toolbarState.scale})`,
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
      <button
        type="button"
        aria-label={isCollapsed ? "프레임 펼치기" : "프레임 접기"}
        data-tooltip={
          isCollapsed
            ? `펼치기${childShapeCount ? ` · 내부 ${childShapeCount}개` : ""}`
            : `접기${childShapeCount ? ` · 내부 ${childShapeCount}개` : ""}`
        }
        onClick={toggleFrameCollapsed}
      >
        <FrameToolbarIcon type={isCollapsed ? "expand" : "collapse"} />
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

function FrameToolbarIcon({
  type,
}: {
  type: "collapse" | "expand" | "lock" | "unlock";
}) {
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

  if (type === "collapse") {
    return (
      <svg {...commonProps}>
        <rect x="5" y="6" width="14" height="12" rx="2.5" />
        <path d="M8.5 12h7" />
      </svg>
    );
  }

  if (type === "expand") {
    return (
      <svg {...commonProps}>
        <rect x="5" y="6" width="14" height="12" rx="2.5" />
        <path d="M8.5 12h7" />
        <path d="M12 8.5v7" />
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
