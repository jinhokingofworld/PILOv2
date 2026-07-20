import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeCanvasFreeformShapes } from "@/features/canvas/persistence/canvas-storage";
import type {
  PiloCanvasFreeformShape,
  PiloCanvasViewportBounds,
} from "../canvas-engine-types";
import type {
  CanvasBoardDetail,
  CanvasRuntimeStorageMode,
  CanvasViewSettingApiClient,
} from "./canvas-runtime-types";
import {
  mergeCanvasRoomStateAndPersistedShapes,
  shouldAcceptPersistedCanvasShape,
} from "./canvas-roomstate-hydration";
import {
  buildFrameChildrenQueryKey,
  buildViewportShapeQueryKey,
  DEFAULT_VIEWPORT_SHAPE_LOAD_DEBOUNCE_MS,
  DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN,
} from "./canvas-runtime-utils";
import {
  isCanvasLazyLoadAbortError,
  runCanvasLazyLoadWithRetry,
  shouldRetryCanvasLazyLoad,
} from "./canvas-lazy-load-retry";

type RuntimeRef<T> = {
  current: T;
};

type LoadedViewportShapeBounds = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

const MAX_LOADED_VIEWPORT_BOUNDS = 24;
const CANVAS_LAZY_LOAD_RECOVERY_DELAY_MS = 30_000;

export type CanvasInitialViewportLoadStatus =
  | "idle"
  | "loading"
  | "retrying"
  | "loaded";

export type CanvasAdditionalViewportLoadStatus =
  | "idle"
  | "loading"
  | "retrying";

type UseCanvasViewportQueriesOptions = {
  board: CanvasBoardDetail;
  canvasClient: CanvasViewSettingApiClient | null;
  latestViewportBoundsRef: RuntimeRef<PiloCanvasViewportBounds | null>;
  mergeLoadedFreeformShapes: (
    loadedShapes: PiloCanvasFreeformShape[],
    options?: { cachedRoomStateShapeIds?: ReadonlySet<string> },
  ) => void;
  queryClient: QueryClient;
  remoteShapeContentHashRef: RuntimeRef<Map<string, string>>;
  remoteShapeRevisionRef: RuntimeRef<Map<string, number>>;
  roomStateShapeIdsRef: RuntimeRef<Set<string>>;
  shapeDetailCacheRef: RuntimeRef<Map<string, PiloCanvasFreeformShape>>;
  storageMode: CanvasRuntimeStorageMode;
  onViewportShapesLoaded?: (bounds: {
    height: number;
    margin: number;
    width: number;
    x: number;
    y: number;
  }, shapes: PiloCanvasFreeformShape[]) => void;
  deletedShapeIdsRef: RuntimeRef<Set<string>>;
  unloadedShapeIdsRef: RuntimeRef<Set<string>>;
  viewportShapeLoadRequestSeqRef: RuntimeRef<number>;
  viewportShapeLoadTimerRef: RuntimeRef<ReturnType<typeof setTimeout> | null>;
};

function shouldLoadFrameChildren(
  shape: PiloCanvasFreeformShape,
): shape is PiloCanvasFreeformShape & { id: string; type: "frame" } {
  return (
    shape.type === "frame" &&
    typeof shape.id === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPersistedRevision(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function readPersistedContentHash(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function createViewportShapeLoadBounds(
  bounds: PiloCanvasViewportBounds,
): LoadedViewportShapeBounds {
  return {
    bottom: bounds.y + bounds.height + DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN,
    left: bounds.x - DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN,
    right: bounds.x + bounds.width + DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN,
    top: bounds.y - DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN,
  };
}

function doesLoadedViewportCoverBounds(
  loadedBounds: LoadedViewportShapeBounds,
  viewportBounds: PiloCanvasViewportBounds,
) {
  return (
    loadedBounds.left <= viewportBounds.x &&
    loadedBounds.top <= viewportBounds.y &&
    loadedBounds.right >= viewportBounds.x + viewportBounds.width &&
    loadedBounds.bottom >= viewportBounds.y + viewportBounds.height
  );
}

export function useCanvasViewportQueries({
  board,
  canvasClient,
  latestViewportBoundsRef,
  mergeLoadedFreeformShapes,
  queryClient,
  remoteShapeContentHashRef,
  remoteShapeRevisionRef,
  roomStateShapeIdsRef,
  shapeDetailCacheRef,
  storageMode,
  onViewportShapesLoaded,
  deletedShapeIdsRef,
  unloadedShapeIdsRef,
  viewportShapeLoadRequestSeqRef,
  viewportShapeLoadTimerRef,
}: UseCanvasViewportQueriesOptions) {
  const loadingFrameChildrenRef = useRef(new Set<string>());
  const pendingFrameChildrenReloadRef = useRef(new Set<string>());
  const frameChildrenRecoveryTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const frameSubtreeRecoveryTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const loadFrameChildrenRef = useRef<
    (frameId: string, visitedFrameIds?: Set<string>) => void
  >(() => {});
  const loadFrameSubtreeRef = useRef<
    (frameId: string) => Promise<void>
  >(async () => {});
  const loadViewportShapesRef = useRef<
    (bounds: PiloCanvasViewportBounds) => void
  >(() => {});
  const isMountedRef = useRef(true);
  const activeBoardIdRef = useRef(board.id);
  const initialViewportLoadCompletedRef = useRef(false);
  const [initialViewportLoadStatus, setInitialViewportLoadStatus] =
    useState<CanvasInitialViewportLoadStatus>("idle");
  const [additionalViewportLoadStatus, setAdditionalViewportLoadStatus] =
    useState<CanvasAdditionalViewportLoadStatus>("idle");
  const [loadingFrameIds, setLoadingFrameIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [loadingFrameChildrenIds, setLoadingFrameChildrenIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [loadingFrameSubtreeIds, setLoadingFrameSubtreeIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const loadedViewportBoundsRef = useRef<{
    boardId: string;
    bounds: LoadedViewportShapeBounds[];
  } | null>(null);

  activeBoardIdRef.current = board.id;

  const setFrameLoading = useCallback((frameId: string, isLoading: boolean) => {
    setLoadingFrameIds((currentFrameIds) => {
      const hasFrame = currentFrameIds.has(frameId);

      if (hasFrame === isLoading) {
        return currentFrameIds;
      }

      const nextFrameIds = new Set(currentFrameIds);

      if (isLoading) {
        nextFrameIds.add(frameId);
      } else {
        nextFrameIds.delete(frameId);
      }

      return nextFrameIds;
    });
  }, []);

  const setFrameChildrenLoading = useCallback(
    (frameId: string, isLoading: boolean) => {
      setLoadingFrameChildrenIds((currentFrameIds) => {
        const hasFrame = currentFrameIds.has(frameId);

        if (hasFrame === isLoading) {
          return currentFrameIds;
        }

        const nextFrameIds = new Set(currentFrameIds);

        if (isLoading) {
          nextFrameIds.add(frameId);
        } else {
          nextFrameIds.delete(frameId);
        }

        return nextFrameIds;
      });
    },
    [],
  );

  const setFrameSubtreeLoading = useCallback(
    (frameId: string, isLoading: boolean) => {
      setLoadingFrameSubtreeIds((currentFrameIds) => {
        const hasFrame = currentFrameIds.has(frameId);

        if (hasFrame === isLoading) {
          return currentFrameIds;
        }

        const nextFrameIds = new Set(currentFrameIds);

        if (isLoading) {
          nextFrameIds.add(frameId);
        } else {
          nextFrameIds.delete(frameId);
        }

        return nextFrameIds;
      });
    },
    [],
  );

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    initialViewportLoadCompletedRef.current = false;
    setInitialViewportLoadStatus("idle");
    setAdditionalViewportLoadStatus("idle");
    setLoadingFrameIds(new Set());
    setLoadingFrameChildrenIds(new Set());
    setLoadingFrameSubtreeIds(new Set());
    frameChildrenRecoveryTimersRef.current.forEach((timer) => {
      clearTimeout(timer);
    });
    frameChildrenRecoveryTimersRef.current.clear();
    frameSubtreeRecoveryTimersRef.current.forEach((timer) => {
      clearTimeout(timer);
    });
    frameSubtreeRecoveryTimersRef.current.clear();
    loadingFrameChildrenRef.current.clear();
    pendingFrameChildrenReloadRef.current.clear();
  }, [board.id]);
  const filterPersistedShapes = useCallback(
    (shapes: PiloCanvasFreeformShape[]) =>
      shapes.filter(
        (shape) => shouldAcceptPersistedCanvasShape({
          deletedShapeIds: deletedShapeIdsRef.current,
          roomStateShapeIds: roomStateShapeIdsRef.current,
          shapeId: typeof shape.id === "string" ? shape.id : null,
        }),
      ),
    [deletedShapeIdsRef, roomStateShapeIdsRef],
  );
  const rememberPersistedShapeMetadata = useCallback(
    (value: unknown) => {
      const shapes = Array.isArray(value) ? value : [value];

      shapes.forEach((shape) => {
        if (!isRecord(shape) || typeof shape.id !== "string") {
          return;
        }
        if (!shouldAcceptPersistedCanvasShape({
          deletedShapeIds: deletedShapeIdsRef.current,
          roomStateShapeIds: roomStateShapeIdsRef.current,
          shapeId: shape.id,
        })) {
          return;
        }

        const revision = readPersistedRevision(shape.revision);
        const contentHash = readPersistedContentHash(shape.contentHash);

        if (revision !== null) {
          remoteShapeRevisionRef.current.set(
            shape.id,
            Math.max(remoteShapeRevisionRef.current.get(shape.id) ?? 0, revision),
          );
        }

        if (contentHash) {
          remoteShapeContentHashRef.current.set(shape.id, contentHash);
        }
      });
    },
    [
      deletedShapeIdsRef,
      remoteShapeContentHashRef,
      remoteShapeRevisionRef,
      roomStateShapeIdsRef,
    ],
  );
  const loadFrameChildren = useCallback(
    (frameId: string, visitedFrameIds = new Set<string>()) => {
      if (visitedFrameIds.has(frameId)) {
        return;
      }

      const recoveryTimer = frameChildrenRecoveryTimersRef.current.get(frameId);

      if (recoveryTimer) {
        clearTimeout(recoveryTimer);
        frameChildrenRecoveryTimersRef.current.delete(frameId);
      }

      if (loadingFrameChildrenRef.current.has(frameId)) {
        pendingFrameChildrenReloadRef.current.add(frameId);
        return;
      }

      const nextVisitedFrameIds = new Set(visitedFrameIds);
      nextVisitedFrameIds.add(frameId);
      const isNestedFrameLoad = visitedFrameIds.size > 0;
      loadingFrameChildrenRef.current.add(frameId);
      setFrameLoading(frameId, true);
      if (isNestedFrameLoad) {
        setFrameSubtreeLoading(frameId, true);
      } else {
        setFrameChildrenLoading(frameId, true);
      }

      function mergeFrameChildren(loadedShapes: PiloCanvasFreeformShape[]) {
        const nextLoadedShapes = loadedShapes.filter(
          (shape) =>
            typeof shape.id !== "string" ||
            !deletedShapeIdsRef.current.has(shape.id),
        );

        if (!nextLoadedShapes.length) return;

        nextLoadedShapes.forEach((shape) => {
          if (typeof shape.id === "string") {
            unloadedShapeIdsRef.current.delete(shape.id);
            shapeDetailCacheRef.current.set(shape.id, shape);
          }
        });
        const cachedRoomStateShapeIds = new Set(
          nextLoadedShapes.flatMap((shape) =>
            typeof shape.id === "string" &&
            roomStateShapeIdsRef.current.has(shape.id) &&
            shapeDetailCacheRef.current.get(shape.id) === shape
              ? [shape.id]
              : [],
          ),
        );
        mergeLoadedFreeformShapes(nextLoadedShapes, {
          cachedRoomStateShapeIds,
        });
        nextLoadedShapes.forEach((shape) => {
          if (shouldLoadFrameChildren(shape)) {
            loadFrameChildren(shape.id, nextVisitedFrameIds);
          }
        });
      }

      const cachedShapes = Array.from(shapeDetailCacheRef.current.values()).filter(
        (shape) =>
          shape.parentId === frameId &&
          (typeof shape.id !== "string" ||
            !deletedShapeIdsRef.current.has(shape.id)),
      );

      if (
        storageMode !== "api" ||
        !canvasClient ||
        !canvasClient.listShapesInViewport
      ) {
        mergeFrameChildren(cachedShapes);
        loadingFrameChildrenRef.current.delete(frameId);
        setFrameLoading(frameId, false);
        if (isNestedFrameLoad) {
          setFrameSubtreeLoading(frameId, false);
        } else {
          setFrameChildrenLoading(frameId, false);
        }
        return;
      }

      const listShapesInViewport = canvasClient.listShapesInViewport;
      const queryKey = buildFrameChildrenQueryKey({
        boardId: board.id,
        frameId,
        workspaceId: board.workspaceId,
      });

      queryClient.removeQueries({ exact: true, queryKey });
      let keepLoadingIndicator = false;
      void queryClient
        .fetchQuery({
          queryKey,
          retry: false,
          staleTime: 0,
          queryFn: ({ signal }) =>
            runCanvasLazyLoadWithRetry({
              load: () =>
                listShapesInViewport(
                  board.id,
                  {
                    parentShapeId: frameId,
                  },
                  {
                    signal,
                    workspaceId: board.workspaceId,
                  },
                ),
              shouldContinue: () =>
                isMountedRef.current &&
                activeBoardIdRef.current === board.id,
            }),
        })
        .then((shapes) => {
          if (
            !isMountedRef.current ||
            activeBoardIdRef.current !== board.id
          ) {
            return;
          }

          rememberPersistedShapeMetadata(shapes);

          const loadedShapes = mergeCanvasRoomStateAndPersistedShapes({
            cachedShapes,
            deletedShapeIds: deletedShapeIdsRef.current,
            persistedShapes: normalizeCanvasFreeformShapes(
              shapes,
            ) as PiloCanvasFreeformShape[],
            roomStateShapeIds: roomStateShapeIdsRef.current,
          });

          mergeFrameChildren(loadedShapes);
        })
        .catch((error: unknown) => {
          if (isCanvasLazyLoadAbortError(error)) {
            return;
          }

          console.error("Canvas API frame children load failed", error);

          if (
            shouldRetryCanvasLazyLoad(error) &&
            isMountedRef.current &&
            activeBoardIdRef.current === board.id &&
            !frameChildrenRecoveryTimersRef.current.has(frameId)
          ) {
            keepLoadingIndicator = true;
            const timer = setTimeout(() => {
              frameChildrenRecoveryTimersRef.current.delete(frameId);
              loadFrameChildrenRef.current(
                frameId,
                new Set(visitedFrameIds),
              );
            }, CANVAS_LAZY_LOAD_RECOVERY_DELAY_MS);

            frameChildrenRecoveryTimersRef.current.set(frameId, timer);
          }
        })
        .finally(() => {
          loadingFrameChildrenRef.current.delete(frameId);
          if (pendingFrameChildrenReloadRef.current.delete(frameId)) {
            keepLoadingIndicator = true;
            if (isNestedFrameLoad) {
              setFrameSubtreeLoading(frameId, false);
            } else {
              setFrameChildrenLoading(frameId, false);
            }
            loadFrameChildren(frameId);
          }
          if (!keepLoadingIndicator && isMountedRef.current) {
            setFrameLoading(frameId, false);
            if (isNestedFrameLoad) {
              setFrameSubtreeLoading(frameId, false);
            } else {
              setFrameChildrenLoading(frameId, false);
            }
          }
        });
    },
    [
      board.id,
      board.workspaceId,
      canvasClient,
      deletedShapeIdsRef,
      mergeLoadedFreeformShapes,
      rememberPersistedShapeMetadata,
      queryClient,
      shapeDetailCacheRef,
      storageMode,
      unloadedShapeIdsRef,
      setFrameLoading,
      setFrameChildrenLoading,
      setFrameSubtreeLoading,
    ],
  );
  loadFrameChildrenRef.current = loadFrameChildren;

  const loadFrameSubtree = useCallback(
    async (rootFrameId: string) => {
      const recoveryTimer = frameSubtreeRecoveryTimersRef.current.get(rootFrameId);

      if (recoveryTimer) {
        clearTimeout(recoveryTimer);
        frameSubtreeRecoveryTimersRef.current.delete(rootFrameId);
      }

      const visitedFrameIds = new Set<string>();
      setFrameSubtreeLoading(rootFrameId, true);

      async function loadRootFrame() {
        const cachedRoot = shapeDetailCacheRef.current.get(rootFrameId);

        if (
          cachedRoot?.type === "frame" &&
          !deletedShapeIdsRef.current.has(rootFrameId)
        ) {
          unloadedShapeIdsRef.current.delete(rootFrameId);
          mergeLoadedFreeformShapes([cachedRoot], {
            cachedRoomStateShapeIds: roomStateShapeIdsRef.current.has(rootFrameId)
              ? new Set([rootFrameId])
              : undefined,
          });
          return true;
        }

        if (
          storageMode !== "api" ||
          !canvasClient?.getShapeDetail
        ) {
          return false;
        }

        const persistedRootValue = await runCanvasLazyLoadWithRetry({
          load: () =>
            canvasClient.getShapeDetail!(rootFrameId, {
              workspaceId: board.workspaceId,
            }),
          shouldContinue: () =>
            isMountedRef.current &&
            activeBoardIdRef.current === board.id,
        });
        if (
          !isMountedRef.current ||
          activeBoardIdRef.current !== board.id
        ) {
          return false;
        }

        rememberPersistedShapeMetadata(persistedRootValue);
        const persistedRoots = normalizeCanvasFreeformShapes([
          persistedRootValue,
        ]) as PiloCanvasFreeformShape[];
        const latestCachedRoot = shapeDetailCacheRef.current.get(rootFrameId);
        const mergedRoots = mergeCanvasRoomStateAndPersistedShapes({
          cachedShapes: latestCachedRoot ? [latestCachedRoot] : [],
          deletedShapeIds: deletedShapeIdsRef.current,
          persistedShapes: persistedRoots,
          roomStateShapeIds: roomStateShapeIdsRef.current,
        });
        const rootFrame = mergedRoots.find(
          (shape) => shape.id === rootFrameId && shape.type === "frame",
        );

        if (!rootFrame) return false;

        unloadedShapeIdsRef.current.delete(rootFrameId);
        shapeDetailCacheRef.current.set(rootFrameId, rootFrame);
        mergeLoadedFreeformShapes([rootFrame], {
          cachedRoomStateShapeIds:
            latestCachedRoot === rootFrame &&
            roomStateShapeIdsRef.current.has(rootFrameId)
              ? new Set([rootFrameId])
              : undefined,
        });
        return true;
      }

      async function visit(frameId: string, depth: number): Promise<void> {
        if (visitedFrameIds.has(frameId) || visitedFrameIds.size >= 160 || depth > 12) return;
        visitedFrameIds.add(frameId);
        setFrameLoading(frameId, true);

        try {
          const cachedShapes = Array.from(shapeDetailCacheRef.current.values()).filter(
            (shape) =>
              shape.parentId === frameId &&
              (typeof shape.id !== "string" || !deletedShapeIdsRef.current.has(shape.id)),
          );
          let loadedShapes = cachedShapes;

          if (
            storageMode === "api" &&
            canvasClient?.listShapesInViewport
          ) {
            const queryKey = buildFrameChildrenQueryKey({
              boardId: board.id,
              frameId,
              workspaceId: board.workspaceId,
            });
            const shapes = await queryClient.fetchQuery({
              queryKey,
              retry: false,
              staleTime: 0,
              queryFn: ({ signal }) =>
                runCanvasLazyLoadWithRetry({
                  load: () =>
                    canvasClient.listShapesInViewport!(
                      board.id,
                      { parentShapeId: frameId },
                      { signal, workspaceId: board.workspaceId },
                    ),
                  shouldContinue: () =>
                    isMountedRef.current &&
                    activeBoardIdRef.current === board.id,
                }),
            });
            if (
              !isMountedRef.current ||
              activeBoardIdRef.current !== board.id
            ) {
              return;
            }
            rememberPersistedShapeMetadata(shapes);
            loadedShapes = mergeCanvasRoomStateAndPersistedShapes({
              cachedShapes,
              deletedShapeIds: deletedShapeIdsRef.current,
              persistedShapes: normalizeCanvasFreeformShapes(
                shapes,
              ) as PiloCanvasFreeformShape[],
              roomStateShapeIds: roomStateShapeIdsRef.current,
            });
          }

          const nextShapes = loadedShapes.filter(
            (shape) => typeof shape.id !== "string" || !deletedShapeIdsRef.current.has(shape.id),
          );
          nextShapes.forEach((shape) => {
            if (typeof shape.id !== "string") return;
            unloadedShapeIdsRef.current.delete(shape.id);
            shapeDetailCacheRef.current.set(shape.id, shape);
          });
          if (nextShapes.length) {
            const cachedRoomStateShapeIds = new Set(
              nextShapes.flatMap((shape) =>
                typeof shape.id === "string" &&
                roomStateShapeIdsRef.current.has(shape.id) &&
                shapeDetailCacheRef.current.get(shape.id) === shape
                  ? [shape.id]
                  : [],
              ),
            );
            mergeLoadedFreeformShapes(nextShapes, {
              cachedRoomStateShapeIds,
            });
          }

          await Promise.all(
            nextShapes.flatMap((shape) =>
              shape.type === "frame" && typeof shape.id === "string"
                ? [visit(shape.id, depth + 1)]
                : []
            ),
          );
        } finally {
          if (isMountedRef.current) {
            setFrameLoading(frameId, false);
          }
        }
      }

      let keepLoadingIndicator = false;

      try {
        const rootLoaded = await loadRootFrame();
        if (!rootLoaded) return;
        await visit(rootFrameId, 0);
      } catch (error) {
        if (
          shouldRetryCanvasLazyLoad(error) &&
          isMountedRef.current &&
          activeBoardIdRef.current === board.id &&
          !frameSubtreeRecoveryTimersRef.current.has(rootFrameId)
        ) {
          keepLoadingIndicator = true;
          setFrameLoading(rootFrameId, true);
          const timer = setTimeout(() => {
            frameSubtreeRecoveryTimersRef.current.delete(rootFrameId);
            void loadFrameSubtreeRef.current(rootFrameId).catch(
              (retryError: unknown) => {
                if (!isCanvasLazyLoadAbortError(retryError)) {
                  console.error(
                    "Canvas API frame subtree recovery failed",
                    retryError,
                  );
                }
              },
            );
          }, CANVAS_LAZY_LOAD_RECOVERY_DELAY_MS);

          frameSubtreeRecoveryTimersRef.current.set(rootFrameId, timer);
        }

        throw error;
      } finally {
        if (!keepLoadingIndicator && isMountedRef.current) {
          setFrameSubtreeLoading(rootFrameId, false);
        }
      }
    },
    [
      board.id,
      board.workspaceId,
      canvasClient,
      deletedShapeIdsRef,
      mergeLoadedFreeformShapes,
      queryClient,
      rememberPersistedShapeMetadata,
      shapeDetailCacheRef,
      storageMode,
      unloadedShapeIdsRef,
      setFrameLoading,
      setFrameSubtreeLoading,
    ],
  );
  loadFrameSubtreeRef.current = loadFrameSubtree;

  const loadViewportShapes = useCallback(
    (bounds: PiloCanvasViewportBounds) => {
      latestViewportBoundsRef.current = bounds;

      if (
        storageMode !== "api" ||
        !canvasClient ||
        !canvasClient.listShapesInViewport
      ) {
        return;
      }

      const listShapesInViewport = canvasClient.listShapesInViewport;
      const loadedViewport = loadedViewportBoundsRef.current;

      if (
        loadedViewport?.boardId === board.id &&
        loadedViewport.bounds.some((loadedBounds) =>
          doesLoadedViewportCoverBounds(loadedBounds, bounds),
        )
      ) {
        return;
      }

      if (!initialViewportLoadCompletedRef.current) {
        setInitialViewportLoadStatus((currentStatus) =>
          currentStatus === "idle" ? "loading" : currentStatus,
        );
      }

      if (viewportShapeLoadTimerRef.current) {
        clearTimeout(viewportShapeLoadTimerRef.current);
      }

      viewportShapeLoadTimerRef.current = setTimeout(() => {
        const latestBounds = latestViewportBoundsRef.current;

        viewportShapeLoadTimerRef.current = null;

        if (!latestBounds) return;

        const currentLoadedViewport = loadedViewportBoundsRef.current;

        if (
          currentLoadedViewport?.boardId === board.id &&
          currentLoadedViewport.bounds.some((loadedBounds) =>
            doesLoadedViewportCoverBounds(loadedBounds, latestBounds),
          )
        ) {
          return;
        }

        const requestBounds = createViewportShapeLoadBounds(latestBounds);
        const requestSeq = viewportShapeLoadRequestSeqRef.current + 1;
        const isInitialViewportRequest =
          !initialViewportLoadCompletedRef.current;
        viewportShapeLoadRequestSeqRef.current = requestSeq;
        if (!isInitialViewportRequest) {
          setAdditionalViewportLoadStatus("loading");
        }
        const queryKey = buildViewportShapeQueryKey({
          boardId: board.id,
          bounds: latestBounds,
          workspaceId: board.workspaceId,
        });
        let keepAdditionalViewportLoading = false;

        void queryClient
          .cancelQueries({
            exact: false,
            queryKey: [
              "canvas",
              board.workspaceId,
              board.id,
              "viewport-shapes",
            ],
          })
          .then(() =>
            queryClient.fetchQuery({
              queryKey,
              retry: false,
              staleTime: 0,
              queryFn: ({ signal }) =>
                runCanvasLazyLoadWithRetry({
                  load: () =>
                    listShapesInViewport(
                      board.id,
                      {
                        ...latestBounds,
                        margin: DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN,
                      },
                      {
                        signal,
                        workspaceId: board.workspaceId,
                      },
                    ),
                  onRetry: () => {
                    if (
                      isMountedRef.current &&
                      activeBoardIdRef.current === board.id &&
                      viewportShapeLoadRequestSeqRef.current === requestSeq
                    ) {
                      if (isInitialViewportRequest) {
                        setInitialViewportLoadStatus("retrying");
                      } else {
                        setAdditionalViewportLoadStatus("retrying");
                      }
                    }
                  },
                  shouldContinue: () =>
                    isMountedRef.current &&
                    activeBoardIdRef.current === board.id &&
                    viewportShapeLoadRequestSeqRef.current === requestSeq &&
                    latestViewportBoundsRef.current === latestBounds,
                }),
            }),
          )
          .then((shapes) => {
            if (
              !isMountedRef.current ||
              activeBoardIdRef.current !== board.id ||
              viewportShapeLoadRequestSeqRef.current !== requestSeq ||
              latestViewportBoundsRef.current !== latestBounds
            ) {
              return;
            }

            rememberPersistedShapeMetadata(shapes);

            const loadedShapes = filterPersistedShapes(
              normalizeCanvasFreeformShapes(
                shapes,
              ) as PiloCanvasFreeformShape[],
            );
            const nextLoadedShapes = loadedShapes.filter(
              (shape) =>
                typeof shape.id !== "string" ||
                !deletedShapeIdsRef.current.has(shape.id),
            );
            const currentLoadedBounds =
              loadedViewportBoundsRef.current?.boardId === board.id
                ? loadedViewportBoundsRef.current.bounds
                : [];

            loadedViewportBoundsRef.current = {
              boardId: board.id,
              bounds: [...currentLoadedBounds, requestBounds].slice(
                -MAX_LOADED_VIEWPORT_BOUNDS,
              ),
            };
            if (!initialViewportLoadCompletedRef.current) {
              initialViewportLoadCompletedRef.current = true;
              setInitialViewportLoadStatus("loaded");
            }
            onViewportShapesLoaded?.({
              ...latestBounds,
              margin: DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN,
            }, nextLoadedShapes);

            mergeLoadedFreeformShapes(nextLoadedShapes);
            nextLoadedShapes.forEach((shape) => {
              if (shouldLoadFrameChildren(shape)) {
                loadFrameChildren(shape.id);
              }
            });
          })
          .catch((error: unknown) => {
            if (isCanvasLazyLoadAbortError(error)) {
              return;
            }

            console.error("Canvas API viewport shape load failed", error);

            if (
              shouldRetryCanvasLazyLoad(error) &&
              isMountedRef.current &&
              activeBoardIdRef.current === board.id &&
              viewportShapeLoadRequestSeqRef.current === requestSeq &&
              latestViewportBoundsRef.current === latestBounds &&
              !viewportShapeLoadTimerRef.current
            ) {
              if (isInitialViewportRequest) {
                setInitialViewportLoadStatus("retrying");
              } else {
                keepAdditionalViewportLoading = true;
                setAdditionalViewportLoadStatus("retrying");
              }
              viewportShapeLoadTimerRef.current = setTimeout(() => {
                viewportShapeLoadTimerRef.current = null;
                loadViewportShapesRef.current(latestBounds);
              }, CANVAS_LAZY_LOAD_RECOVERY_DELAY_MS);
            } else if (isInitialViewportRequest) {
              setInitialViewportLoadStatus("idle");
            }
          })
          .finally(() => {
            if (
              !isInitialViewportRequest &&
              !keepAdditionalViewportLoading &&
              isMountedRef.current &&
              activeBoardIdRef.current === board.id &&
              viewportShapeLoadRequestSeqRef.current === requestSeq
            ) {
              setAdditionalViewportLoadStatus("idle");
            }
          });
      }, DEFAULT_VIEWPORT_SHAPE_LOAD_DEBOUNCE_MS);
    },
    [
      board.id,
      board.workspaceId,
      canvasClient,
      deletedShapeIdsRef,
      filterPersistedShapes,
      latestViewportBoundsRef,
      loadFrameChildren,
      mergeLoadedFreeformShapes,
      onViewportShapesLoaded,
      queryClient,
      rememberPersistedShapeMetadata,
      storageMode,
      viewportShapeLoadRequestSeqRef,
      viewportShapeLoadTimerRef,
    ],
  );
  loadViewportShapesRef.current = loadViewportShapes;

  return {
    additionalViewportLoadStatus,
    initialViewportLoadStatus,
    isLoadingFrameChildren: loadingFrameChildrenIds.size > 0,
    isLoadingFrameSubtree: loadingFrameSubtreeIds.size > 0,
    loadFrameChildren,
    loadFrameSubtree,
    loadViewportShapes,
    loadingFrameIds,
  };
}
