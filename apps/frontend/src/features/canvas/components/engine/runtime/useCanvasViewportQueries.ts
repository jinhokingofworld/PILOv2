import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { normalizeCanvasFreeformShapes } from "../../../utils/canvas-storage";
import { isPiloFrameCollapsed } from "../../../utils/canvas-collapse";
import type {
  PiloCanvasFreeformShape,
  PiloCanvasShapeDetailRequest,
  PiloCanvasViewportBounds,
} from "../types";
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
  shapeDetailCacheRef: RuntimeRef<Map<string, PiloCanvasFreeformShape>>;
  shapeDetailRequestSeqRef: RuntimeRef<number>;
  storageMode: CanvasRuntimeStorageMode;
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
  shapeDetailCacheRef,
  shapeDetailRequestSeqRef,
  storageMode,
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
      queryClient,
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
      queryClient,
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
      shapeDetailCacheRef,
      shapeDetailRequestSeqRef,
      storageMode,
    ],
  );

  return {
    loadFrameChildren,
    loadShapeDetail,
    loadViewportShapes,
  };
}
