import { Magnet, Trash2 } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  PiloCanvasActions,
  PiloCanvasSnapState,
} from "../surface/PiloTldrawCanvas";
import type { CanvasViewSetting } from "./canvas-runtime-types";

type CanvasZoomControlsProps = {
  canvasActions: PiloCanvasActions | null;
  canvasSnapState: PiloCanvasSnapState;
  onToggleSmartGuides: () => void;
  viewSetting: CanvasViewSetting;
};

export function CanvasZoomControls({
  canvasActions,
  canvasSnapState,
  onToggleSmartGuides,
  viewSetting,
}: CanvasZoomControlsProps) {
  function markCanvasUiEvent(event: ReactPointerEvent<HTMLElement>) {
    canvasActions?.markUiEventAsHandled(event);
    event.stopPropagation();
  }

  return (
    <div
      className="canvas-zoom-controls"
      aria-label="캔버스 확대/축소"
      onPointerDownCapture={markCanvasUiEvent}
      onPointerUpCapture={markCanvasUiEvent}
    >
      <button
        type="button"
        aria-label="축소"
        data-canvas-agent-target="controls.zoom_out"
        onClick={() => {
          canvasActions?.zoomOut();
        }}
      >
        -
      </button>
      <strong>{Math.round(viewSetting.zoom * 100)}%</strong>
      <button
        type="button"
        aria-label="확대"
        data-canvas-agent-target="controls.zoom_in"
        onClick={() => {
          canvasActions?.zoomIn();
        }}
      >
        +
      </button>
      <button
        type="button"
        aria-label="스마트가이드"
        className={
          canvasSnapState.isSmartGuideEnabled ? "is-active" : undefined
        }
        data-canvas-agent-target="controls.smart_guides"
        data-tooltip="스마트가이드"
        disabled={!canvasActions}
        onClick={onToggleSmartGuides}
      >
        <Magnet />
      </button>
      <button
        type="button"
        aria-label="선택 삭제"
        className="canvas-trash-drop-zone"
        data-canvas-agent-target="controls.trash"
        data-tooltip="휴지통"
        disabled={!canvasActions}
        onClick={() => {
          canvasActions?.deleteSelection();
        }}
      >
        <Trash2 />
      </button>
    </div>
  );
}
