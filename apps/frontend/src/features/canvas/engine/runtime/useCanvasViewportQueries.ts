import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { normalizeCanvasFreeformShapes } from "@/features/canvas/persistence/canvas-storage";
import { isPiloFrameCollapsed } from "@/features/canvas/engine/shapes/frame/canvas-frame-collapse";
import type {
  PiloCanvasFreeformShape,
  PiloCanvasShapeDetailRequest,
  PiloCanvasViewportBounds,
} from "../canvas-engine-types";
import type {
  CanvasBoardDetail,
  CanvasRuntimeStorageMode,
  CanvasViewSettingApiClient,
} from "./canvas-runtime-types";
import {
  buildShapeDetailQueryKey,
  buildFrameChildrenQueryKey,
  buildViewportShapeQueryKey,
  CANVAS_SHAPE_DETAIL_MIN_ZOOM,
  CANVAS_SHAPE_DETAIL_STALE_TIME_MS,
  DEFAULT_VIEWPORT_SHAPE_LOAD_DEBOUNCE_MS,
  DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN,
} from "./canvas-runtime-utils";

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

type UseCanvasViewportQueriesOptions = {
  board: CanvasBoardDetail;
  canvasClient: CanvasViewSettingApiClient | null;
  latestViewportBoundsRef: RuntimeRef<PiloCanvasViewportBounds | null>;
  mergeLoadedFreeformShapes: (loadedShapes: PiloCanvasFreeformShape[]) => void;
  pendingShapeDetailRef: RuntimeRef<string | null>;
  queryClient: QueryClient;
  remoteShapeContentHashRef: RuntimeRef<Map<string, string>>;
  remoteShapeRevisionRef: RuntimeRef<Map<string, number>>;
  shapeDetailCacheRef: RuntimeRef<Map<string, PiloCanvasFreeformShape>>;
  shapeDetailRequestSeqRef: RuntimeRef<number>;
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

function shouldLoadExpandedFrameChildren(
  shape: PiloCanvasFreeformShape,
): shape is PiloCanvasFreeformShape & { id: string; type: "frame" } {
  return (
    shape.type === "frame" &&
    typeof shape.id === "string" &&
    !isPiloFrameCollapsed(shape)
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
  pendingShapeDetailRef,
  queryClient,
  remoteShapeContentHashRef,
  remoteShapeRevisionRef,
  shapeDetailCacheRef,
  shapeDetailRequestSeqRef,
  storageMode,
  onViewportShapesLoaded,
  deletedShapeIdsRef,
  unloadedShapeIdsRef,
  viewportShapeLoadRequestSeqRef,
  viewportShapeLoadTimerRef,
}: UseCanvasViewportQueriesOptions) {
  const loadingFrameChildrenRef = useRef(new Set<string>());
  const pendingFrameChildrenReloadRef = useRef(new Set<string>());
  const loadedViewportBoundsRef = useRef<{
    boardId: string;
    bounds: LoadedViewportShapeBounds[];
  } | null>(null);
  const rememberPersistedShapeMetadata = useCallback(
    (value: unknown) => {
      const shapes = Array.isArray(value) ? value : [value];

      shapes.forEach((shape) => {
        if (!isRecord(shape) || typeof shape.id !== "string") return;

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
    [remoteShapeContentHashRef, remoteShapeRevisionRef],
  );
  const loadFrameChildren = useCallback(
    (frameId: string, visitedFrameIds = new Set<string>()) => {
      if (visitedFrameIds.has(frameId)) {
        return;
      }

      if (loadingFrameChildrenRef.current.has(frameId)) {
        pendingFrameChildrenReloadRef.current.add(frameId);
        return;
      }

      const nextVisitedFrameIds = new Set(visitedFrameIds);
      nextVisitedFrameIds.add(frameId);
      loadingFrameChildrenRef.current.add(frameId);

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
        mergeLoadedFreeformShapes(nextLoadedShapes);
        nextLoadedShapes.forEach((shape) => {
          if (shouldLoadExpandedFrameChildren(shape)) {
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

      mergeFrameChildren(cachedShapes);

      if (
        storageMode !== "api" ||
        !canvasClient ||
        !canvasClient.listShapesInViewport
      ) {
        loadingFrameChildrenRef.current.delete(frameId);
        return;
      }

      const listShapesInViewport = canvasClient.listShapesInViewport;
      const queryKey = buildFrameChildrenQueryKey({
        boardId: board.id,
        frameId,
        workspaceId: board.workspaceId,
      });

      queryClient.removeQueries({ exact: true, queryKey });
      void queryClient
        .fetchQuery({
          queryKey,
          staleTime: 0,
          queryFn: ({ signal }) =>
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
        })
        .then((shapes) => {
          rememberPersistedShapeMetadata(shapes);

          const loadedShapes = normalizeCanvasFreeformShapes(
            shapes,
          ) as PiloCanvasFreeformShape[];

          mergeFrameChildren(loadedShapes);
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }

            console.error("Canvas API frame children load failed", error);
        })
        .finally(() => {
          loadingFrameChildrenRef.current.delete(frameId);
          if (pendingFrameChildrenReloadRef.current.delete(frameId)) {
            loadFrameChildren(frameId);
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
    ],
  );

  const loadFrameSubtree = useCallback(
    async (rootFrameId: string) => {
      const visitedFrameIds = new Set<string>();

      async function visit(frameId: string, depth: number): Promise<void> {
        if (visitedFrameIds.has(frameId) || visitedFrameIds.size >= 160 || depth > 12) return;
        visitedFrameIds.add(frameId);

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
            staleTime: 0,
            queryFn: ({ signal }) =>
              canvasClient.listShapesInViewport!(
                board.id,
                { parentShapeId: frameId },
                { signal, workspaceId: board.workspaceId },
              ),
          });
          rememberPersistedShapeMetadata(shapes);
          loadedShapes = normalizeCanvasFreeformShapes(shapes) as PiloCanvasFreeformShape[];
        }

        const nextShapes = loadedShapes.filter(
          (shape) => typeof shape.id !== "string" || !deletedShapeIdsRef.current.has(shape.id),
        );
        nextShapes.forEach((shape) => {
          if (typeof shape.id !== "string") return;
          unloadedShapeIdsRef.current.delete(shape.id);
          shapeDetailCacheRef.current.set(shape.id, shape);
        });
        if (nextShapes.length) mergeLoadedFreeformShapes(nextShapes);

        await Promise.all(
          nextShapes.flatMap((shape) =>
            shape.type === "frame" && typeof shape.id === "string"
              ? [visit(shape.id, depth + 1)]
              : []
          ),
        );
      }

      await visit(rootFrameId, 0);
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
    ],
  );

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
        viewportShapeLoadRequestSeqRef.current = requestSeq;
        const queryKey = buildViewportShapeQueryKey({
          boardId: board.id,
          bounds: latestBounds,
          workspaceId: board.workspaceId,
        });

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
              staleTime: 0,
              queryFn: ({ signal }) =>
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
            }),
          )
          .then((shapes) => {
            if (
              viewportShapeLoadRequestSeqRef.current !== requestSeq ||
              latestViewportBoundsRef.current !== latestBounds
            ) {
              return;
            }

            rememberPersistedShapeMetadata(shapes);

            const loadedShapes = normalizeCanvasFreeformShapes(
              shapes,
            ) as PiloCanvasFreeformShape[];
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
            onViewportShapesLoaded?.({
              ...latestBounds,
              margin: DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN,
            }, nextLoadedShapes);

            mergeLoadedFreeformShapes(nextLoadedShapes);
            nextLoadedShapes.forEach((shape) => {
              if (shouldLoadExpandedFrameChildren(shape)) {
                loadFrameChildren(shape.id);
              }
            });
          })
          .catch((error: unknown) => {
            if (error instanceof Error && error.name === "AbortError") {
              return;
            }

            console.error("Canvas API viewport shape load failed", error);
          });
      }, DEFAULT_VIEWPORT_SHAPE_LOAD_DEBOUNCE_MS);
    },
    [
      board.id,
      board.workspaceId,
      canvasClient,
      deletedShapeIdsRef,
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

  const loadShapeDetail = useCallback(
    ({ shapeId, zoom }: PiloCanvasShapeDetailRequest) => {
      if (zoom < CANVAS_SHAPE_DETAIL_MIN_ZOOM) {
        pendingShapeDetailRef.current = null;
        shapeDetailRequestSeqRef.current += 1;
        return;
      }

      if (deletedShapeIdsRef.current.has(shapeId)) {
        shapeDetailCacheRef.current.delete(shapeId);
        return;
      }

      const cachedDetail = shapeDetailCacheRef.current.get(shapeId);

      if (cachedDetail) {
        mergeLoadedFreeformShapes([cachedDetail]);
        return;
      }

      if (
        storageMode !== "api" ||
        !canvasClient ||
        !canvasClient.getShapeDetail
      ) {
        return;
      }

      const getShapeDetail = canvasClient.getShapeDetail;
      const requestSeq = shapeDetailRequestSeqRef.current + 1;
      const queryKey = buildShapeDetailQueryKey({
        shapeId,
        workspaceId: board.workspaceId,
      });

      shapeDetailRequestSeqRef.current = requestSeq;
      pendingShapeDetailRef.current = shapeId;

      void queryClient
        .cancelQueries({
          exact: false,
          queryKey: ["canvas", board.workspaceId, "shape-detail"],
        })
        .then(() =>
          queryClient.fetchQuery({
            queryKey,
            staleTime: CANVAS_SHAPE_DETAIL_STALE_TIME_MS,
            queryFn: ({ signal }) =>
              getShapeDetail(shapeId, {
                signal,
                workspaceId: board.workspaceId,
              }),
          }),
        )
        .then((shape) => {
          if (
            pendingShapeDetailRef.current !== shapeId ||
            shapeDetailRequestSeqRef.current !== requestSeq
          ) {
            return;
          }

          rememberPersistedShapeMetadata([shape]);

          const [detailShape] = normalizeCanvasFreeformShapes([
            shape,
          ]) as PiloCanvasFreeformShape[];

          if (!detailShape) return;
          if (deletedShapeIdsRef.current.has(shapeId)) return;

          shapeDetailCacheRef.current.set(shapeId, detailShape);
          mergeLoadedFreeformShapes([detailShape]);
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") {
            return;
          }

          console.error("Canvas API shape detail load failed", error);
        });
    },
    [
      board.workspaceId,
      canvasClient,
      deletedShapeIdsRef,
      mergeLoadedFreeformShapes,
      pendingShapeDetailRef,
      queryClient,
      rememberPersistedShapeMetadata,
      shapeDetailCacheRef,
      shapeDetailRequestSeqRef,
      storageMode,
    ],
  );

  return {
    loadFrameChildren,
    loadFrameSubtree,
    loadShapeDetail,
    loadViewportShapes,
  };
}
