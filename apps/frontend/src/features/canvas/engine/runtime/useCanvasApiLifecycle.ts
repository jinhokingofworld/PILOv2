import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  createCanvasShapeSyncQueue,
  type CanvasShapeSyncQueue,
} from "@/features/canvas/persistence/canvas-shape-sync";
import type {
  CanvasBoardDetail,
  CanvasRuntimeStorageMode,
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
  onShapeSyncError?: (error: unknown) => void;
  pendingShapeDetailRef: RuntimeRef<string | null>;
  queryClient: QueryClient;
  remoteShapeRevisionRef: RuntimeRef<Map<string, number>>;
  shapeSyncQueueRef: RuntimeRef<CanvasShapeSyncQueue | null>;
  storageMode: CanvasRuntimeStorageMode;
  viewportShapeLoadTimerRef: RuntimeRef<ReturnType<typeof setTimeout> | null>;
};

export function useCanvasApiLifecycle({
  board,
  canvasClient,
  latestViewportBoundsRef,
  onShapeSyncError,
  pendingShapeDetailRef,
  queryClient,
  remoteShapeRevisionRef,
  shapeSyncQueueRef,
  storageMode,
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
        onShapeSyncError?.(error);
        console.error("Canvas API shape sync failed", error);
      },
      onSynced(operations, result) {
        result.shapeRevisions.forEach((revision, shapeId) => {
          remoteShapeRevisionRef.current.set(
            shapeId,
            Math.max(
              remoteShapeRevisionRef.current.get(shapeId) ?? 0,
              revision,
            ),
          );
        });

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
      if (viewportShapeLoadTimerRef.current) {
        clearTimeout(viewportShapeLoadTimerRef.current);
        viewportShapeLoadTimerRef.current = null;
      }

      latestViewportBoundsRef.current = null;
      pendingShapeDetailRef.current = null;

      void (async () => {
        await enterPromise;

        try {
          await shapeSyncQueue.flush();
        } catch (error) {
          console.error("Canvas API shape sync failed", error);
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
    onShapeSyncError,
    pendingShapeDetailRef,
    queryClient,
    remoteShapeRevisionRef,
    shapeSyncQueueRef,
    storageMode,
    viewportShapeLoadTimerRef,
  ]);
}
