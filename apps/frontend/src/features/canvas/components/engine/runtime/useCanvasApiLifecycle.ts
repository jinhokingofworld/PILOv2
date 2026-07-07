import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  createCanvasShapeSyncQueue,
  type CanvasShapeSyncQueue,
} from "../../../utils/canvas-shape-sync";
import type {
  CanvasBoardDetail,
  CanvasRuntimeStorageMode,
  CanvasViewSetting,
  CanvasViewSettingApiClient,
} from "./canvas-runtime-types";
import { buildShapeDetailQueryKey } from "./canvas-runtime-utils";

type RuntimeRef<T> = {
  current: T;
};

type UseCanvasApiLifecycleOptions = {
  board: CanvasBoardDetail;
  canvasClient: CanvasViewSettingApiClient | null;
  latestViewportBoundsRef: RuntimeRef<unknown>;
  pendingShapeDetailRef: RuntimeRef<string | null>;
  pendingViewSettingRef: RuntimeRef<CanvasViewSetting | null>;
  queryClient: QueryClient;
  shapeSyncQueueRef: RuntimeRef<CanvasShapeSyncQueue | null>;
  storageMode: CanvasRuntimeStorageMode;
  viewSettingSyncTimerRef: RuntimeRef<ReturnType<typeof setTimeout> | null>;
  viewportShapeLoadTimerRef: RuntimeRef<ReturnType<typeof setTimeout> | null>;
};

export function useCanvasApiLifecycle({
  board,
  canvasClient,
  latestViewportBoundsRef,
  pendingShapeDetailRef,
  pendingViewSettingRef,
  queryClient,
  shapeSyncQueueRef,
  storageMode,
  viewSettingSyncTimerRef,
  viewportShapeLoadTimerRef,
}: UseCanvasApiLifecycleOptions) {
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
      onSynced(operations) {
        void queryClient.invalidateQueries({
          queryKey: ["canvas", board.workspaceId, board.id, "viewport-shapes"],
        });

        operations.forEach((operation) => {
          void queryClient.invalidateQueries({
            queryKey: buildShapeDetailQueryKey({
              shapeId: operation.shapeId,
              workspaceId: board.workspaceId,
            }),
          });
        });
      },
      workspaceId: board.workspaceId,
    });

    shapeSyncQueueRef.current = shapeSyncQueue;

    const enterPromise = canvasClient.enterCanvas
      ? canvasClient
          .enterCanvas(board.id, {
            workspaceId: board.workspaceId,
          })
          .catch((error: unknown) => {
            console.error("Canvas API enter failed", error);
          })
      : Promise.resolve();

    return () => {
      if (viewSettingSyncTimerRef.current) {
        clearTimeout(viewSettingSyncTimerRef.current);
        viewSettingSyncTimerRef.current = null;
      }

      if (viewportShapeLoadTimerRef.current) {
        clearTimeout(viewportShapeLoadTimerRef.current);
        viewportShapeLoadTimerRef.current = null;
      }

      const pendingViewSetting = pendingViewSettingRef.current;
      pendingViewSettingRef.current = null;
      latestViewportBoundsRef.current = null;
      pendingShapeDetailRef.current = null;

      void (async () => {
        await enterPromise;

        try {
          await shapeSyncQueue.flush();
        } catch (error) {
          console.error("Canvas API shape sync failed", error);
        }

        if (pendingViewSetting) {
          try {
            await canvasClient.updateViewSetting(board.id, pendingViewSetting, {
              workspaceId: board.workspaceId,
            });
          } catch (error) {
            console.error("Canvas API view setting sync failed", error);
          }
        }

        try {
          await canvasClient.leaveCanvas?.(board.id, {
            workspaceId: board.workspaceId,
          });
        } catch (error) {
          console.error("Canvas API leave failed", error);
        }
      })();

      if (shapeSyncQueueRef.current === shapeSyncQueue) {
        shapeSyncQueueRef.current = null;
      }
    };
  }, [
    board.id,
    board.workspaceId,
    canvasClient,
    latestViewportBoundsRef,
    pendingShapeDetailRef,
    pendingViewSettingRef,
    queryClient,
    shapeSyncQueueRef,
    storageMode,
    viewSettingSyncTimerRef,
    viewportShapeLoadTimerRef,
  ]);
}
