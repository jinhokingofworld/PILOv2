"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  normalizeCanvasFreeformShapes,
  readCanvasStorage,
  writeCanvasStorage,
} from "../../utils/canvas-storage";
import {
  createCanvasShapeSyncQueue,
  syncCanvasFreeformShapes,
  type CanvasShapeSyncQueue,
  type CanvasShapeApiClient,
} from "../../utils/canvas-shape-sync";
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
  shapes?: unknown[];
  viewSetting: CanvasViewSetting;
};

type PiloCanvasRuntimeProps = {
  board: CanvasBoardDetail;
  canvasClient?: CanvasShapeApiClient | null;
  onReady: (actions: PiloCanvasActions | null) => void;
  storageMode?: "api" | "local";
};

function clampZoom(value: number) {
  return Math.min(2, Math.max(0.5, Math.round(value * 100) / 100));
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
  canvasClient = null,
  onReady,
  storageMode = "local",
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
  const shapeSyncQueueRef = useRef<CanvasShapeSyncQueue | null>(null);
  const [canvasHydrationVersion, setCanvasHydrationVersion] = useState(0);

  useEffect(() => {
    onReady(canvasActions);
  }, [canvasActions, onReady]);

  useEffect(() => {
    let cancelled = false;
    const boardFreeformShapes = normalizeCanvasFreeformShapes(
      board.shapes,
    ) as PiloCanvasFreeformShape[];
    const storedFreeformShapes =
      storageMode === "local"
        ? (normalizeCanvasFreeformShapes(
            readCanvasStorage("freeform-shapes", board.id),
          ) as PiloCanvasFreeformShape[])
        : boardFreeformShapes;

    queueMicrotask(() => {
      if (cancelled) return;

      setFreeformShapes(storedFreeformShapes);
      setViewSetting(board.viewSetting);

      setCanvasHydrationVersion((version) => version + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [board.id, board.shapes, board.viewSetting, storageMode]);

  useEffect(() => {
    if (storageMode !== "api" || !canvasClient) {
      shapeSyncQueueRef.current?.cancel();
      shapeSyncQueueRef.current = null;
      return;
    }

    const shapeSyncQueue = createCanvasShapeSyncQueue({
      boardId: board.id,
      canvasClient,
      onError(error: unknown) {
        console.error("Canvas API shape sync failed", error);
      },
      workspaceId: board.workspaceId,
    });

    shapeSyncQueueRef.current = shapeSyncQueue;

    return () => {
      void shapeSyncQueue.flush().catch((error: unknown) => {
        console.error("Canvas API shape sync failed", error);
      });

      if (shapeSyncQueueRef.current === shapeSyncQueue) {
        shapeSyncQueueRef.current = null;
      }
    };
  }, [board.id, board.workspaceId, canvasClient, storageMode]);

  const persistFreeformShapes = useCallback(
    (nextFreeformShapes: PiloCanvasFreeformShape[]) => {
      setFreeformShapes((currentFreeformShapes) => {
        if (
          buildFreeformShapesKey(currentFreeformShapes) ===
          buildFreeformShapesKey(nextFreeformShapes)
        ) {
          return currentFreeformShapes;
        }

        if (storageMode === "api" && canvasClient) {
          const shapeSyncQueue = shapeSyncQueueRef.current;
          const syncInput = {
            nextShapes: nextFreeformShapes,
            previousShapes: currentFreeformShapes,
          };

          if (shapeSyncQueue) {
            shapeSyncQueue.enqueue(syncInput);
          } else {
            void syncCanvasFreeformShapes({
              boardId: board.id,
              canvasClient,
              ...syncInput,
              workspaceId: board.workspaceId,
            }).catch((error: unknown) => {
              console.error("Canvas API shape sync failed", error);
            });
          }
        } else {
          writeCanvasStorage("freeform-shapes", board.id, nextFreeformShapes);
        }

        return nextFreeformShapes;
      });
    },
    [board.id, board.workspaceId, canvasClient, storageMode],
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
    },
    [],
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
          hydrationVersion={canvasHydrationVersion}
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
