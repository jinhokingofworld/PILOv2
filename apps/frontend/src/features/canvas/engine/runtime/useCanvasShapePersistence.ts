import { useCallback } from "react";
import { writeCanvasStorage } from "@/features/canvas/persistence/canvas-storage";
import {
  areCanvasFreeformShapesEqual,
  syncCanvasFreeformShapes,
  type CanvasShapeSyncQueue,
} from "@/features/canvas/persistence/canvas-shape-sync";
import type {
  PiloCanvasFreeformShape,
  PiloCanvasLocalShapeChange,
} from "../canvas-engine-types";
import type {
  CanvasBoardDetail,
  CanvasRuntimeStorageMode,
  CanvasViewSettingApiClient,
} from "./canvas-runtime-types";
import { shouldAcceptPersistedCanvasShape } from "./canvas-roomstate-hydration";
import {
  buildFreeformShapeMap,
  getChangedFreeformShapeIds,
  getFreeformShapeId,
  mergeLocalFreeformShapeChanges,
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
  onLoadedShapesMerged?: (shapes: PiloCanvasFreeformShape[]) => void;
  onShapeSyncError?: (error: unknown) => void;
  pendingLocalShapeVersionsRef: RuntimeRef<Map<string, number>>;
  persistThroughRoomState?: boolean;
  remoteShapeRevisionRef: RuntimeRef<Map<string, number>>;
  roomStateShapeIdsRef: RuntimeRef<Set<string>>;
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
  onLoadedShapesMerged,
  onRoomShapePatch,
  onShapeSyncError,
  pendingLocalShapeVersionsRef,
  persistThroughRoomState = false,
  remoteShapeRevisionRef,
  roomStateShapeIdsRef,
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
    candidateShapeIds?: Iterable<string>,
  ) {
    const currentSyncShapes = buildPersistableLocalShapes(currentShapes);
    const nextSyncShapes = buildPersistableLocalShapes(nextShapes);
    const detectedChangedShapeIds = getChangedFreeformShapeIds(
      currentSyncShapes,
      nextSyncShapes,
    );
    const changedShapeIds = candidateShapeIds
      ? Array.from(new Set(candidateShapeIds)).filter((shapeId) =>
          detectedChangedShapeIds.has(shapeId),
        )
      : Array.from(detectedChangedShapeIds);
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

  function normalizeLocalShapeChange(
    currentShapes: PiloCanvasFreeformShape[],
    snapshotShapes: PiloCanvasFreeformShape[],
    change?: PiloCanvasLocalShapeChange,
  ): PiloCanvasLocalShapeChange {
    if (change) {
      const deletedShapeIds = Array.from(
        new Set(change.deletedShapeIds.map((shapeId) => shapeId.trim())),
      ).filter(Boolean);

      return {
        changedShapeIds: Array.from(
          new Set([
            ...change.changedShapeIds.map((shapeId) => shapeId.trim()),
            ...deletedShapeIds,
          ]),
        ).filter(Boolean),
        deletedShapeIds,
        isFreehandDrawing: change.isFreehandDrawing,
      };
    }

    return {
      changedShapeIds: Array.from(
        getChangedFreeformShapeIds(currentShapes, snapshotShapes),
      ),
      deletedShapeIds: [],
      isFreehandDrawing: false,
    };
  }

  function mergeLocalSnapshot(
    currentShapes: PiloCanvasFreeformShape[],
    snapshotShapes: PiloCanvasFreeformShape[],
    change: PiloCanvasLocalShapeChange,
  ) {
    const snapshotShapeMap = buildFreeformShapeMap(snapshotShapes);
    const mergedShapes = mergeLocalFreeformShapeChanges({
      changedShapeIds: change.changedShapeIds,
      currentShapes,
      deletedShapeIds: change.deletedShapeIds,
      snapshotShapes,
    });

    return mergedShapes.filter((shape) => {
      const shapeId = getFreeformShapeId(shape);

      return (
        !shapeId ||
        !unloadedShapeIdsRef.current.has(shapeId) ||
        snapshotShapeMap.has(shapeId)
      );
    });
  }

  function collectPendingLocalShapeVersions(shapeIds: Iterable<string>) {
    const pendingVersions = new Map<string, number>();

    Array.from(new Set(shapeIds)).forEach((shapeId) => {
      const version = pendingLocalShapeVersionsRef.current.get(shapeId);

      if (version !== undefined) {
        pendingVersions.set(shapeId, version);
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
    (
      snapshotShapes: PiloCanvasFreeformShape[],
      localChange?: PiloCanvasLocalShapeChange,
    ) => {
      const normalizedChange = normalizeLocalShapeChange(
        freeformShapesRef.current,
        snapshotShapes,
        localChange,
      );
      const nextFreeformShapes = mergeLocalSnapshot(
        freeformShapesRef.current,
        snapshotShapes,
        normalizedChange,
      );

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
          normalizedChange.changedShapeIds,
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

        return (
          (!shapeId ||
            !pendingLocalShapeVersionsRef.current.has(shapeId)) &&
          shouldAcceptPersistedCanvasShape({
            deletedShapeIds: deletedShapeIdsRef.current,
            roomStateShapeIds: roomStateShapeIdsRef.current,
            shapeId,
          })
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
      onLoadedShapesMerged?.(nextLoadedShapes);
    },
    [
      freeformShapesRef,
      deletedShapeIdsRef,
      pendingLocalShapeVersionsRef,
      roomStateShapeIdsRef,
      onLoadedShapesMerged,
      setFreeformShapes,
    ],
  );

  const persistFreeformShapes = useCallback(
    (
      snapshotShapes: PiloCanvasFreeformShape[],
      localChange?: PiloCanvasLocalShapeChange,
    ) => {
      const currentLocalShapes = freeformShapesRef.current;
      const normalizedChange = normalizeLocalShapeChange(
        currentLocalShapes,
        snapshotShapes,
        localChange,
      );
      const nextFreeformShapes = mergeLocalSnapshot(
        currentLocalShapes,
        snapshotShapes,
        normalizedChange,
      );

      setFreeformShapes((currentFreeformShapes) => {
        const hasPendingLocalChanges = normalizedChange.changedShapeIds.some(
          (shapeId) =>
            pendingLocalShapeVersionsRef.current.has(shapeId),
        );

        if (
          !normalizedChange.deletedShapeIds.length &&
          !hasPendingLocalChanges &&
          areCanvasFreeformShapesEqual(currentFreeformShapes, nextFreeformShapes)
        ) {
          return currentFreeformShapes;
        }

        freeformShapesRef.current = nextFreeformShapes;

        if (storageMode === "api" && canvasClient) {
          markPendingLocalShapeChanges(
            currentLocalShapes,
            nextFreeformShapes,
            normalizedChange.changedShapeIds,
          );
          const pendingLocalShapeVersions =
            collectPendingLocalShapeVersions(
              normalizedChange.changedShapeIds,
            );
          const nextShapeMap = buildFreeformShapeMap(
            buildPersistableLocalShapes(nextFreeformShapes),
          );
          normalizedChange.deletedShapeIds.forEach((shapeId) => {
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
                  onShapeSyncError?.(error);
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
