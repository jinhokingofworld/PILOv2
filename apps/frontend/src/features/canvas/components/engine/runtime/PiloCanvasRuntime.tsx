"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasShapeOperationPayload } from "@/features/canvas/api/canvas-types";
import type { CanvasRealtimeConfig } from "@/features/canvas/realtime/canvas-realtime-types";
import { useCanvasPresence } from "@/features/canvas/realtime/useCanvasPresence";
import type { CanvasShapeSyncQueue } from "../../../utils/canvas-shape-sync";
import {
  PiloTldrawCanvas,
  type PiloCanvasActions,
  type PiloCanvasHistoryState,
  type PiloCanvasSnapState,
} from "../surface/PiloTldrawCanvas";
import type {
  PiloCanvasFreeformShape,
  PiloCanvasViewportBounds,
} from "../types";
import { CanvasZoomControls } from "./CanvasZoomControls";
import { applyCanvasRemoteOperation } from "./canvas-remote-operations";
import type {
  CanvasBoardDetail,
  CanvasRuntimeStorageMode,
  CanvasViewSetting,
  CanvasViewSettingApiClient,
} from "./canvas-runtime-types";
import { useCanvasApiLifecycle } from "./useCanvasApiLifecycle";
import { useCanvasRuntimeHydration } from "./useCanvasRuntimeHydration";
import { useCanvasShapePersistence } from "./useCanvasShapePersistence";
import { useCanvasViewSettingPersistence } from "./useCanvasViewSettingPersistence";
import { useCanvasViewportQueries } from "./useCanvasViewportQueries";

export type { CanvasBoardDetail, CanvasViewSetting } from "./canvas-runtime-types";

type PiloCanvasRuntimeProps = {
  board: CanvasBoardDetail;
  canvasClient?: CanvasViewSettingApiClient | null;
  onHistoryStateChange?: (state: PiloCanvasHistoryState) => void;
  onSnapStateChange?: (state: PiloCanvasSnapState) => void;
  onReady: (actions: PiloCanvasActions | null) => void;
  realtime?: CanvasRealtimeConfig | null;
  storageMode?: CanvasRuntimeStorageMode;
};

const noopCanvasHistoryStateChange = () => {};
const initialCanvasSnapState: PiloCanvasSnapState = {
  isSmartGuideEnabled: false,
};

export function PiloCanvasRuntime({
  ...props
}: PiloCanvasRuntimeProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <PiloCanvasRuntimeInner {...props} />
    </QueryClientProvider>
  );
}

function PiloCanvasRuntimeInner({
  board,
  canvasClient = null,
  onHistoryStateChange,
  onSnapStateChange,
  onReady,
  realtime = null,
  storageMode = "local",
}: PiloCanvasRuntimeProps) {
  const queryClient = useQueryClient();
  const [canvasActions, setCanvasActions] = useState<PiloCanvasActions | null>(
    null,
  );
  const [freeformShapes, setFreeformShapes] = useState<
    PiloCanvasFreeformShape[]
  >([]);
  const freeformShapesRef = useRef<PiloCanvasFreeformShape[]>([]);
  const [viewSetting, setViewSetting] = useState<CanvasViewSetting>({
    zoom: 1,
    viewportX: 0,
    viewportY: 0,
  });
  const [canvasSnapState, setCanvasSnapState] =
    useState<PiloCanvasSnapState>(initialCanvasSnapState);
  const shapeSyncQueueRef = useRef<CanvasShapeSyncQueue | null>(null);
  const pendingViewSettingRef = useRef<CanvasViewSetting | null>(null);
  const viewSettingRef = useRef<CanvasViewSetting>(viewSetting);
  const viewSettingSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const viewportShapeLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const viewportShapeLoadRequestSeqRef = useRef(0);
  const latestViewportBoundsRef = useRef<PiloCanvasViewportBounds | null>(null);
  const shapeDetailCacheRef = useRef(new Map<string, PiloCanvasFreeformShape>());
  const pendingShapeDetailRef = useRef<string | null>(null);
  const shapeDetailRequestSeqRef = useRef(0);
  const pendingLocalShapeVersionsRef = useRef(new Map<string, number>());
  const deferredRemoteOperationsRef = useRef(
    new Map<number, CanvasShapeOperationPayload>(),
  );
  const remoteShapeRevisionRef = useRef(new Map<string, number>());
  const localShapeVersionRef = useRef(0);
  const [canvasHydrationVersion, setCanvasHydrationVersion] = useState(0);
  const [cameraRestoreVersion, setCameraRestoreVersion] = useState(0);
  const currentRealtimeUserId = realtime?.currentUser?.userId ?? null;
  const catchUpCanvasOperations = useCallback(
    async (afterSeq: number, signal?: AbortSignal) => {
      if (storageMode !== "api" || !canvasClient?.listOperationsAfterSeq) {
        return {
          latestOpSeq: afterSeq,
          operations: [],
        };
      }

      return canvasClient.listOperationsAfterSeq(board.id, afterSeq, {
        signal,
        workspaceId: board.workspaceId,
      });
    },
    [board.id, board.workspaceId, canvasClient, storageMode],
  );
  const applyRemoteCanvasOperations = useCallback(
    (operations: CanvasShapeOperationPayload[]) => {
      if (storageMode !== "api" || !operations.length) {
        return;
      }

      const sortedOperations = operations
        .slice()
        .sort((a, b) => a.opSeq - b.opSeq);
      let nextFreeformShapes = freeformShapesRef.current;
      let hasVisibleShapeChange = false;

      sortedOperations.forEach((operation) => {
        deferredRemoteOperationsRef.current.delete(operation.opSeq);

        if (operation.actorUserId === currentRealtimeUserId) {
          remoteShapeRevisionRef.current.set(
            operation.shapeId,
            Math.max(
              remoteShapeRevisionRef.current.get(operation.shapeId) ?? 0,
              operation.resultRevision,
            ),
          );
          return;
        }

        if (pendingLocalShapeVersionsRef.current.has(operation.shapeId)) {
          deferredRemoteOperationsRef.current.set(operation.opSeq, operation);
          return;
        }

        const appliedRevision =
          remoteShapeRevisionRef.current.get(operation.shapeId) ?? 0;

        if (operation.resultRevision <= appliedRevision) {
          return;
        }

        const result = applyCanvasRemoteOperation({
          currentShapes: nextFreeformShapes,
          operation,
          shapeDetailCache: shapeDetailCacheRef.current,
          viewportBounds: latestViewportBoundsRef.current,
        });

        remoteShapeRevisionRef.current.set(
          operation.shapeId,
          operation.resultRevision,
        );

        if (!result.changed) {
          return;
        }

        nextFreeformShapes = result.nextShapes;
        hasVisibleShapeChange = true;
      });

      if (!hasVisibleShapeChange) {
        return;
      }

      freeformShapesRef.current = nextFreeformShapes;
      setFreeformShapes(nextFreeformShapes);
      setCanvasHydrationVersion((version) => version + 1);
    },
    [currentRealtimeUserId, storageMode],
  );
  const flushDeferredRemoteOperations = useCallback(() => {
    if (!deferredRemoteOperationsRef.current.size) {
      return;
    }

    applyRemoteCanvasOperations(
      Array.from(deferredRemoteOperationsRef.current.values()),
    );
  }, [applyRemoteCanvasOperations]);
  const canvasPresence = useCanvasPresence(realtime, {
    applyOperations: applyRemoteCanvasOperations,
    catchUpOperations: catchUpCanvasOperations,
  });

  useEffect(() => {
    deferredRemoteOperationsRef.current.clear();
    remoteShapeRevisionRef.current.clear();
  }, [board.id]);

  useEffect(() => {
    onReady(canvasActions);
  }, [canvasActions, onReady]);

  useCanvasRuntimeHydration({
    board,
    freeformShapesRef,
    pendingLocalShapeVersionsRef,
    pendingShapeDetailRef,
    setCameraRestoreVersion,
    setCanvasHydrationVersion,
    setFreeformShapes,
    setViewSetting,
    shapeDetailCacheRef,
    shapeDetailRequestSeqRef,
    storageMode,
    viewSettingRef,
    viewportShapeLoadRequestSeqRef,
  });

  useEffect(() => {
    viewSettingRef.current = viewSetting;
  }, [viewSetting]);

  useCanvasApiLifecycle({
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
  });

  const {
    captureDraftFreeformShapes,
    mergeLoadedFreeformShapes,
    persistFreeformShapes,
  } = useCanvasShapePersistence({
    board,
    canvasClient,
    freeformShapesRef,
    localShapeVersionRef,
    onLocalShapeSyncIdle: flushDeferredRemoteOperations,
    pendingLocalShapeVersionsRef,
    setCanvasHydrationVersion,
    setFreeformShapes,
    shapeDetailCacheRef,
    shapeSyncQueueRef,
    storageMode,
  });

  const persistViewSetting = useCanvasViewSettingPersistence({
    board,
    canvasClient,
    pendingShapeDetailRef,
    pendingViewSettingRef,
    setViewSetting,
    storageMode,
    viewSettingRef,
    viewSettingSyncTimerRef,
  });

  const { loadShapeDetail, loadViewportShapes } = useCanvasViewportQueries({
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
  });

  const handleSnapStateChange = useCallback(
    (state: PiloCanvasSnapState) => {
      setCanvasSnapState(state);
      onSnapStateChange?.(state);
    },
    [onSnapStateChange],
  );

  const toggleSmartGuides = useCallback(() => {
    if (!canvasActions) return;

    const nextState = {
      isSmartGuideEnabled: !canvasSnapState.isSmartGuideEnabled,
    };

    setCanvasSnapState(nextState);
    onSnapStateChange?.(nextState);
    canvasActions.setSmartGuidesEnabled(nextState.isSmartGuideEnabled);
  }, [canvasActions, canvasSnapState.isSmartGuideEnabled, onSnapStateChange]);

  return (
    <>
      <section className="canvas-content" aria-label="캔버스 보드">
        <PiloTldrawCanvas
          board={board}
          cameraRestoreVersion={cameraRestoreVersion}
          freeformShapes={freeformShapes}
          hydrationVersion={canvasHydrationVersion}
          initialViewSetting={viewSetting}
          onReady={setCanvasActions}
          onFreeformShapesDraftChange={captureDraftFreeformShapes}
          onFreeformShapesChange={persistFreeformShapes}
          onViewChange={persistViewSetting}
          onViewportBoundsChange={loadViewportShapes}
          onShapeDetailRequest={loadShapeDetail}
          onHistoryStateChange={
            onHistoryStateChange ?? noopCanvasHistoryStateChange
          }
          presence={canvasPresence}
          onSnapStateChange={handleSnapStateChange}
        />
      </section>

      <CanvasZoomControls
        canvasActions={canvasActions}
        canvasSnapState={canvasSnapState}
        onToggleSmartGuides={toggleSmartGuides}
        viewSetting={viewSetting}
      />
    </>
  );
}
