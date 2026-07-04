"use client";

import {
  useCallback,
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  normalizeCanvasFreeformShapes,
  readCanvasStorage,
  writeCanvasStorage,
} from "../../utils/canvas-storage";
import {
  PiloTldrawCanvas,
  type PiloCanvasActions,
  type PiloCanvasFreeformShape,
} from "./PiloTldrawCanvas";

export type CanvasViewSetting = {
  zoom: number;
  viewportX: number;
  viewportY: number;
};

export type CanvasBoardDetail = {
  id: string;
  title: string;
  workspaceId: string;
  shapeCount: number;
  viewSetting: CanvasViewSetting;
};

type PiloCanvasRuntimeProps = {
  board: CanvasBoardDetail;
  onReady: (actions: PiloCanvasActions | null) => void;
};

function clampZoom(value: number) {
  return Math.min(2, Math.max(0.5, Math.round(value * 100) / 100));
}

function isCanvasViewSetting(value: unknown): value is CanvasViewSetting {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const setting = value as Record<string, unknown>;

  return (
    typeof setting.zoom === "number" &&
    Number.isFinite(setting.zoom) &&
    typeof setting.viewportX === "number" &&
    Number.isFinite(setting.viewportX) &&
    typeof setting.viewportY === "number" &&
    Number.isFinite(setting.viewportY)
  );
}

function areViewSettingsEqual(
  current: CanvasViewSetting,
  next: CanvasViewSetting,
) {
  return (
    current.zoom === next.zoom &&
    current.viewportX === next.viewportX &&
    current.viewportY === next.viewportY
  );
}

function buildFreeformShapesKey(shapes: PiloCanvasFreeformShape[]) {
  return JSON.stringify(shapes);
}

export function PiloCanvasRuntime({
  board,
  onReady,
}: PiloCanvasRuntimeProps) {
  const [canvasActions, setCanvasActions] = useState<PiloCanvasActions | null>(
    null,
  );
  const [freeformShapes, setFreeformShapes] = useState<
    PiloCanvasFreeformShape[]
  >([]);
  const [viewSetting, setViewSetting] = useState<CanvasViewSetting>({
    zoom: 1,
    viewportX: 0,
    viewportY: 0,
  });
  const [hasStoredViewSetting, setHasStoredViewSetting] = useState(false);
  const [canvasHydrationVersion, setCanvasHydrationVersion] = useState(0);

  useEffect(() => {
    onReady(canvasActions);
  }, [canvasActions, onReady]);

  useEffect(() => {
    let cancelled = false;
    const storedViewSetting = readCanvasStorage("view-setting", board.id);
    const storedFreeformShapes = normalizeCanvasFreeformShapes(
      readCanvasStorage("freeform-shapes", board.id),
    ) as PiloCanvasFreeformShape[];

    queueMicrotask(() => {
      if (cancelled) return;

      setFreeformShapes(storedFreeformShapes);

      if (isCanvasViewSetting(storedViewSetting)) {
        setViewSetting(storedViewSetting);
        setHasStoredViewSetting(true);
      } else {
        setViewSetting(board.viewSetting);
        setHasStoredViewSetting(false);
      }

      setCanvasHydrationVersion((version) => version + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [board.id, board.viewSetting]);

  const persistFreeformShapes = useCallback(
    (nextFreeformShapes: PiloCanvasFreeformShape[]) => {
      setFreeformShapes((currentFreeformShapes) => {
        if (
          buildFreeformShapesKey(currentFreeformShapes) ===
          buildFreeformShapesKey(nextFreeformShapes)
        ) {
          return currentFreeformShapes;
        }

        writeCanvasStorage("freeform-shapes", board.id, nextFreeformShapes);

        return nextFreeformShapes;
      });
    },
    [board.id],
  );

  const persistViewSetting = useCallback(
    (nextViewSetting: CanvasViewSetting) => {
      const normalizedViewSetting = {
        zoom: clampZoom(nextViewSetting.zoom),
        viewportX: nextViewSetting.viewportX,
        viewportY: nextViewSetting.viewportY,
      };

      setViewSetting((currentViewSetting) =>
        areViewSettingsEqual(currentViewSetting, normalizedViewSetting)
          ? currentViewSetting
          : normalizedViewSetting,
      );
      setHasStoredViewSetting(true);
      writeCanvasStorage("view-setting", board.id, normalizedViewSetting);
    },
    [board.id],
  );

  const markCanvasUiEvent = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      canvasActions?.markUiEventAsHandled(event);
      event.stopPropagation();
    },
    [canvasActions],
  );

  return (
    <>
      <section className="canvas-content" aria-label="캔버스 보드">
        <PiloTldrawCanvas
          board={board}
          freeformShapes={freeformShapes}
          hasStoredViewSetting={hasStoredViewSetting}
          hydrationVersion={canvasHydrationVersion}
          viewSetting={viewSetting}
          onReady={setCanvasActions}
          onFreeformShapesChange={persistFreeformShapes}
          onViewChange={persistViewSetting}
        />
      </section>

      <div
        className="canvas-zoom-controls"
        aria-label="캔버스 확대/축소"
        onPointerDownCapture={markCanvasUiEvent}
        onPointerUpCapture={markCanvasUiEvent}
      >
        <button
          type="button"
          aria-label="화면 맞춤"
          onClick={() => canvasActions?.fit()}
        >
          맞춤
        </button>
        <button
          type="button"
          aria-label="축소"
          onClick={() => {
            canvasActions?.zoomOut();
            persistViewSetting({
              ...viewSetting,
              zoom: clampZoom(viewSetting.zoom - 0.1),
            });
          }}
        >
          -
        </button>
        <strong>{Math.round(viewSetting.zoom * 100)}%</strong>
        <button
          type="button"
          aria-label="확대"
          onClick={() => {
            canvasActions?.zoomIn();
            persistViewSetting({
              ...viewSetting,
              zoom: clampZoom(viewSetting.zoom + 0.1),
            });
          }}
        >
          +
        </button>
      </div>
    </>
  );
}
