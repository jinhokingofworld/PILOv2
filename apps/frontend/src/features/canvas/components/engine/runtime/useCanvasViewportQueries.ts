import type { QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { normalizeCanvasFreeformShapes } from "../../../utils/canvas-storage";
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
  viewportShapeLoadRequestSeqRef: RuntimeRef<number>;
  viewportShapeLoadTimerRef: RuntimeRef<ReturnType<typeof setTimeout> | null>;
};

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
  viewportShapeLoadRequestSeqRef,
  viewportShapeLoadTimerRef,
}: UseCanvasViewportQueriesOptions) {
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

            mergeLoadedFreeformShapes(
              normalizeCanvasFreeformShapes(shapes) as PiloCanvasFreeformShape[],
            );
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
    loadShapeDetail,
    loadViewportShapes,
  };
}
