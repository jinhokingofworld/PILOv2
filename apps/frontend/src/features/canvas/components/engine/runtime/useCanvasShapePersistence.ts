import { useCallback } from "react";
import { writeCanvasStorage } from "../../../utils/canvas-storage";
import {
  areCanvasFreeformShapesEqual,
  isCanvasShapeSyncConflictError,
  syncCanvasFreeformShapes,
  type CanvasShapeSyncConflict,
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
  onRoomShapePatch?: (patch: {
    deletedShapeIds: string[];
    upsertShapes: PiloCanvasFreeformShape[];
  }) => boolean;
  onShapeSyncConflict?: (conflict: CanvasShapeSyncConflict) => void;
  onShapeSyncError?: (error: unknown) => void;
  pendingLocalShapeVersionsRef: RuntimeRef<Map<string, number>>;
  persistThroughRoomState?: boolean;
  remoteShapeRevisionRef: RuntimeRef<Map<string, number>>;
  setCanvasHydrationVersion: (updater: (version: number) => number) => void;
  setFreeformShapes: (
    updater:
      | PiloCanvasFreeformShape[]
      | ((currentFreeformShapes: PiloCanvasFreeformShape[]) => PiloCanvasFreeformShape[]),
  ) => void;
  shapeDetailCacheRef: RuntimeRef<Map<string, PiloCanvasFreeformShape>>;
  shapeSyncQueueRef: RuntimeRef<CanvasShapeSyncQueue | null>;
  storageMode: CanvasRuntimeStorageMode;
  deletedShapeIdsRef: RuntimeRef<Set<string>>;
  unloadedShapeIdsRef: RuntimeRef<Set<string>>;
};

export function useCanvasShapePersistence({
  board,
  canvasClient,
  freeformShapesRef,
  localShapeVersionRef,
  onLocalShapeSyncIdle,
  onRoomShapePatch,
  onShapeSyncConflict,
  onShapeSyncError,
  pendingLocalShapeVersionsRef,
  persistThroughRoomState = false,
  remoteShapeRevisionRef,
  setCanvasHydrationVersion,
  setFreeformShapes,
  shapeDetailCacheRef,
  shapeSyncQueueRef,
  storageMode,
  deletedShapeIdsRef,
  unloadedShapeIdsRef,
}: UseCanvasShapePersistenceOptions) {
  function buildPersistableLocalShapes(shapes: PiloCanvasFreeformShape[]) {
    const shapeMap = buildFreeformShapeMap(shapes);

    unloadedShapeIdsRef.current.forEach((shapeId) => {
      if (deletedShapeIdsRef.current.has(shapeId)) return;

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
        deletedShapeIdsRef.current.delete(shapeId);
        shapeDetailCacheRef.current.set(shapeId, nextShape);
      } else {
        deletedShapeIdsRef.current.add(shapeId);
        unloadedShapeIdsRef.current.delete(shapeId);
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
        const pendingVersions = markPendingLocalShapeChanges(
          freeformShapesRef.current,
          nextFreeformShapes,
        );
        if (persistThroughRoomState) {
          clearPendingLocalShapeChanges(pendingVersions);
        }
      }

      freeformShapesRef.current = nextFreeformShapes;
    },
    [canvasClient, freeformShapesRef, persistThroughRoomState, storageMode],
  );

  const mergeLoadedFreeformShapes = useCallback(
    (loadedShapes: PiloCanvasFreeformShape[]) => {
      const nextLoadedShapes = loadedShapes.filter((shape) => {
        const shapeId = getFreeformShapeId(shape);

        return (
          !shapeId ||
          (!deletedShapeIdsRef.current.has(shapeId) &&
            !pendingLocalShapeVersionsRef.current.has(shapeId))
        );
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
      deletedShapeIdsRef,
      pendingLocalShapeVersionsRef,
      setCanvasHydrationVersion,
      setFreeformShapes,
    ],
  );

  const persistFreeformShapes = useCallback(
    (
      nextFreeformShapes: PiloCanvasFreeformShape[],
      explicitDeletedShapeIds: string[] = [],
    ) => {
      const uniqueExplicitDeletedShapeIds = Array.from(
        new Set(explicitDeletedShapeIds.map((shapeId) => shapeId.trim())),
      ).filter(Boolean);

      setFreeformShapes((currentFreeformShapes) => {
        if (
          !uniqueExplicitDeletedShapeIds.length &&
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
          const nextShapeMap = buildFreeformShapeMap(
            buildPersistableLocalShapes(nextFreeformShapes),
          );
          uniqueExplicitDeletedShapeIds.forEach((shapeId) => {
            if (
              nextShapeMap.has(shapeId) ||
              unloadedShapeIdsRef.current.has(shapeId)
            ) {
              return;
            }

            if (!pendingLocalShapeVersions.has(shapeId)) {
              const version = localShapeVersionRef.current + 1;

              localShapeVersionRef.current = version;
              pendingLocalShapeVersionsRef.current.set(shapeId, version);
              pendingLocalShapeVersions.set(shapeId, version);
            }

            deletedShapeIdsRef.current.add(shapeId);
            shapeDetailCacheRef.current.delete(shapeId);
          });
          const upsertShapes: PiloCanvasFreeformShape[] = [];
          const deletedShapeIds: string[] = [];

          pendingLocalShapeVersions.forEach((_version, shapeId) => {
            const nextShape = nextShapeMap.get(shapeId);

            if (nextShape) {
              upsertShapes.push(nextShape);
            } else {
              deletedShapeIds.push(shapeId);
            }
          });

          if (persistThroughRoomState) {
            const didSendRoomPatch =
              onRoomShapePatch?.({ deletedShapeIds, upsertShapes }) ?? false;

            if (didSendRoomPatch) {
              clearPendingLocalShapeChanges(pendingLocalShapeVersions);
              return nextFreeformShapes;
            }
          }

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
                  clearPendingLocalShapeChanges(pendingLocalShapeVersions);
                  if (isCanvasShapeSyncConflictError(error)) return;

                  onShapeSyncError?.(error);
                  console.error("Canvas API shape sync failed", error);
                });
            }
          } else {
            void syncCanvasFreeformShapes({
              boardId: board.id,
              canvasClient,
              getBaseRevision(shapeId) {
                return remoteShapeRevisionRef.current.get(shapeId) ?? null;
              },
              ...syncInput,
              onConflict: onShapeSyncConflict,
              workspaceId: board.workspaceId,
            })
              .then((result) => {
                result.shapeRevisions.forEach((revision, shapeId) => {
                  remoteShapeRevisionRef.current.set(
                    shapeId,
                    Math.max(
                      remoteShapeRevisionRef.current.get(shapeId) ?? 0,
                      revision,
                    ),
                  );
                });

                clearPendingLocalShapeChanges(pendingLocalShapeVersions);
              })
              .catch((error: unknown) => {
                clearPendingLocalShapeChanges(pendingLocalShapeVersions);
                if (isCanvasShapeSyncConflictError(error)) return;

                onShapeSyncError?.(error);
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
      deletedShapeIdsRef,
      freeformShapesRef,
      onLocalShapeSyncIdle,
      onRoomShapePatch,
      onShapeSyncConflict,
      onShapeSyncError,
      persistThroughRoomState,
      remoteShapeRevisionRef,
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
