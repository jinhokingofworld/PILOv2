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
  CANVAS_VIEWPORT_SHAPE_STALE_TIME_MS,
  DEFAULT_VIEWPORT_SHAPE_LOAD_DEBOUNCE_MS,
  DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN,
} from "./canvas-runtime-utils";

type RuntimeRef<T> = {
  current: T;
};

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
  unloadedShapeIdsRef,
  viewportShapeLoadRequestSeqRef,
  viewportShapeLoadTimerRef,
}: UseCanvasViewportQueriesOptions) {
  const loadingFrameChildrenRef = useRef(new Set<string>());
  const loadFrameChildren = useCallback(
    (frameId: string, visitedFrameIds = new Set<string>()) => {
      if (
        visitedFrameIds.has(frameId) ||
        loadingFrameChildrenRef.current.has(frameId)
      ) {
        return;
      }

      const nextVisitedFrameIds = new Set(visitedFrameIds);
      nextVisitedFrameIds.add(frameId);
      loadingFrameChildrenRef.current.add(frameId);

      function mergeFrameChildren(loadedShapes: PiloCanvasFreeformShape[]) {
        if (!loadedShapes.length) return;

        loadedShapes.forEach((shape) => {
          if (typeof shape.id === "string") {
            unloadedShapeIdsRef.current.delete(shape.id);
            shapeDetailCacheRef.current.set(shape.id, shape);
          }
        });
        mergeLoadedFreeformShapes(loadedShapes);
        loadedShapes.forEach((shape) => {
          if (shouldLoadExpandedFrameChildren(shape)) {
            loadFrameChildren(shape.id, nextVisitedFrameIds);
          }
        });
      }

      const cachedShapes = Array.from(shapeDetailCacheRef.current.values()).filter(
        (shape) => shape.parentId === frameId,
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

      void queryClient
        .fetchQuery({
          queryKey,
          staleTime: CANVAS_VIEWPORT_SHAPE_STALE_TIME_MS,
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
        });
    },
    [
      board.id,
      board.workspaceId,
      canvasClient,
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

      if (viewportShapeLoadTimerRef.current) {
        clearTimeout(viewportShapeLoadTimerRef.current);
      }

      viewportShapeLoadTimerRef.current = setTimeout(() => {
        const latestBounds = latestViewportBoundsRef.current;

        viewportShapeLoadTimerRef.current = null;

        if (!latestBounds) return;

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
              staleTime: CANVAS_VIEWPORT_SHAPE_STALE_TIME_MS,
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

            mergeLoadedFreeformShapes(loadedShapes);
            loadedShapes.forEach((shape) => {
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
