import { useCallback } from "react";
import { writeCanvasStorage } from "../../../utils/canvas-storage";
import {
  areCanvasFreeformShapesEqual,
  syncCanvasFreeformShapes,
  type CanvasShapeSyncQueue,
} from "../../../utils/canvas-shape-sync";
import type { PiloCanvasFreeformShape } from "../types";
import type {
  CanvasBoardDetail,
  CanvasRuntimeStorageMode,
  CanvasViewSettingApiClient,
} from "./canvas-runtime-types";
import {
  buildFreeformShapeMap,
  getChangedFreeformShapeIds,
  getFreeformShapeId,
  mergeFreeformShapesById,
} from "./canvas-runtime-utils";

type RuntimeRef<T> = {
  current: T;
};

type UseCanvasShapePersistenceOptions = {
  board: CanvasBoardDetail;
  canvasClient: CanvasViewSettingApiClient | null;
  freeformShapesRef: RuntimeRef<PiloCanvasFreeformShape[]>;
  localShapeVersionRef: RuntimeRef<number>;
  onLocalShapeSyncIdle?: () => void;
  pendingLocalShapeVersionsRef: RuntimeRef<Map<string, number>>;
  setCanvasHydrationVersion: (updater: (version: number) => number) => void;
  setFreeformShapes: (
    updater:
      | PiloCanvasFreeformShape[]
      | ((currentFreeformShapes: PiloCanvasFreeformShape[]) => PiloCanvasFreeformShape[]),
  ) => void;
  shapeDetailCacheRef: RuntimeRef<Map<string, PiloCanvasFreeformShape>>;
  shapeSyncQueueRef: RuntimeRef<CanvasShapeSyncQueue | null>;
  storageMode: CanvasRuntimeStorageMode;
  unloadedShapeIdsRef: RuntimeRef<Set<string>>;
};

export function useCanvasShapePersistence({
  board,
  canvasClient,
  freeformShapesRef,
  localShapeVersionRef,
  onLocalShapeSyncIdle,
  pendingLocalShapeVersionsRef,
  setCanvasHydrationVersion,
  setFreeformShapes,
  shapeDetailCacheRef,
  shapeSyncQueueRef,
  storageMode,
  unloadedShapeIdsRef,
}: UseCanvasShapePersistenceOptions) {
  function buildPersistableLocalShapes(shapes: PiloCanvasFreeformShape[]) {
    const shapeMap = buildFreeformShapeMap(shapes);

    unloadedShapeIdsRef.current.forEach((shapeId) => {
      const unloadedShape = shapeDetailCacheRef.current.get(shapeId);

      if (unloadedShape) {
        shapeMap.set(shapeId, unloadedShape);
      }
    });

    return Array.from(shapeMap.values());
  }

  function markPendingLocalShapeChanges(
    currentShapes: PiloCanvasFreeformShape[],
    nextShapes: PiloCanvasFreeformShape[],
  ) {
    const currentSyncShapes = buildPersistableLocalShapes(currentShapes);
    const nextSyncShapes = buildPersistableLocalShapes(nextShapes);
    const changedShapeIds = getChangedFreeformShapeIds(
      currentSyncShapes,
      nextSyncShapes,
    );
    const nextShapeMap = buildFreeformShapeMap(nextSyncShapes);
    const pendingVersions = new Map<string, number>();

    changedShapeIds.forEach((shapeId) => {
      const nextShape = nextShapeMap.get(shapeId);
      const version = localShapeVersionRef.current + 1;

      localShapeVersionRef.current = version;
      pendingLocalShapeVersionsRef.current.set(shapeId, version);
      pendingVersions.set(shapeId, version);

      if (nextShape) {
        shapeDetailCacheRef.current.set(shapeId, nextShape);
      } else {
        shapeDetailCacheRef.current.delete(shapeId);
      }
    });

    return pendingVersions;
  }

  function clearPendingLocalShapeChanges(
    pendingVersions: Map<string, number>,
  ) {
    pendingVersions.forEach((version, shapeId) => {
      if (pendingLocalShapeVersionsRef.current.get(shapeId) === version) {
        pendingLocalShapeVersionsRef.current.delete(shapeId);
      }
    });

    onLocalShapeSyncIdle?.();
  }

  const captureDraftFreeformShapes = useCallback(
    (nextFreeformShapes: PiloCanvasFreeformShape[]) => {
      if (
        areCanvasFreeformShapesEqual(
          freeformShapesRef.current,
          nextFreeformShapes,
        )
      ) {
        return;
      }

      if (storageMode === "api" && canvasClient) {
        markPendingLocalShapeChanges(
          freeformShapesRef.current,
          nextFreeformShapes,
        );
      }

      freeformShapesRef.current = nextFreeformShapes;
    },
    [canvasClient, freeformShapesRef, storageMode],
  );

  const mergeLoadedFreeformShapes = useCallback(
    (loadedShapes: PiloCanvasFreeformShape[]) => {
      const nextLoadedShapes = loadedShapes.filter((shape) => {
        const shapeId = getFreeformShapeId(shape);

        return !shapeId || !pendingLocalShapeVersionsRef.current.has(shapeId);
      });

      if (!nextLoadedShapes.length) return;

      const mergedShapes = mergeFreeformShapesById(
        freeformShapesRef.current,
        nextLoadedShapes,
      );

      if (
        areCanvasFreeformShapesEqual(freeformShapesRef.current, mergedShapes)
      ) {
        return;
      }

      freeformShapesRef.current = mergedShapes;
      setFreeformShapes(mergedShapes);
      setCanvasHydrationVersion((version) => version + 1);
    },
    [
      freeformShapesRef,
      pendingLocalShapeVersionsRef,
      setCanvasHydrationVersion,
      setFreeformShapes,
    ],
  );

  const persistFreeformShapes = useCallback(
    (nextFreeformShapes: PiloCanvasFreeformShape[]) => {
      setFreeformShapes((currentFreeformShapes) => {
        if (
          areCanvasFreeformShapesEqual(currentFreeformShapes, nextFreeformShapes)
        ) {
          return currentFreeformShapes;
        }

        freeformShapesRef.current = nextFreeformShapes;

        if (storageMode === "api" && canvasClient) {
          const pendingLocalShapeVersions = markPendingLocalShapeChanges(
            currentFreeformShapes,
            nextFreeformShapes,
          );
          const shapeSyncQueue = shapeSyncQueueRef.current;
          const syncInput = {
            nextShapes: buildPersistableLocalShapes(nextFreeformShapes),
            previousShapes: buildPersistableLocalShapes(currentFreeformShapes),
          };

          if (shapeSyncQueue) {
            shapeSyncQueue.enqueue(syncInput);

            if (pendingLocalShapeVersions.size) {
              void shapeSyncQueue
                .whenIdle()
                .then(() =>
                  clearPendingLocalShapeChanges(pendingLocalShapeVersions),
                )
                .catch((error: unknown) => {
                  console.error("Canvas API shape sync failed", error);
                });
            }
          } else {
            void syncCanvasFreeformShapes({
              boardId: board.id,
              canvasClient,
              ...syncInput,
              workspaceId: board.workspaceId,
            })
              .then(() =>
                clearPendingLocalShapeChanges(pendingLocalShapeVersions),
              )
              .catch((error: unknown) => {
                console.error("Canvas API shape sync failed", error);
              });
          }
        } else {
          writeCanvasStorage(
            "freeform-shapes",
            board.id,
            buildPersistableLocalShapes(nextFreeformShapes),
          );
        }

        return nextFreeformShapes;
      });
    },
    [
      board.id,
      board.workspaceId,
      canvasClient,
      freeformShapesRef,
      onLocalShapeSyncIdle,
      setFreeformShapes,
      shapeSyncQueueRef,
      storageMode,
      unloadedShapeIdsRef,
    ],
  );

  return {
    captureDraftFreeformShapes,
    mergeLoadedFreeformShapes,
    persistFreeformShapes,
  };
}
