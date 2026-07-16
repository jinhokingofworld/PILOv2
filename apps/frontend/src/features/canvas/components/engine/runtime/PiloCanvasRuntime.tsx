"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasShapeOperationPayload } from "@/features/canvas/api/canvas-types";
import {
  isRecord,
  normalizeCanvasShape,
} from "@/features/canvas/api/canvas-normalizers";
import type { CanvasRealtimeConfig } from "@/shared/canvas-realtime/canvas-realtime-types";
import { useCanvasPresence } from "@/features/canvas/realtime/useCanvasPresence";
import { normalizeCanvasFreeformShapes } from "../../../utils/canvas-storage";
import type {
  CanvasShapeSyncConflict,
  CanvasShapeSyncQueue,
} from "../../../utils/canvas-shape-sync";
import {
  PiloTldrawCanvas,
  type PiloCanvasActions,
  type PiloCanvasHistoryState,
  type PiloCanvasSnapState,
} from "../surface/PiloTldrawCanvas";
import type {
  PiloCanvasFreeformShape,
  PiloCanvasLocalInteractionState,
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
import {
  getFreeformShapeId,
  mergeFreeformShapesById,
} from "./canvas-runtime-utils";

export type { CanvasBoardDetail, CanvasViewSetting } from "./canvas-runtime-types";

type PiloCanvasRuntimeProps = {
  board: CanvasBoardDetail;
  canvasClient?: CanvasViewSettingApiClient | null;
  onHistoryStateChange?: (state: PiloCanvasHistoryState) => void;
  onSnapStateChange?: (state: PiloCanvasSnapState) => void;
  onOneShotToolCreated?: () => void;
  onReady: (actions: PiloCanvasActions | null) => void;
  realtime?: CanvasRealtimeConfig | null;
  storageMode?: CanvasRuntimeStorageMode;
};

const noopCanvasHistoryStateChange = () => {};
const INITIAL_CANVAS_VIEW_SETTING: CanvasViewSetting = {
  zoom: 0.8,
  viewportX: 0,
  viewportY: 0,
};
const initialCanvasSnapState: PiloCanvasSnapState = {
  isSmartGuideEnabled: false,
};
type CanvasSyncNotice = {
  id: number;
  message: string;
  tone: "info" | "warning";
};

const initialLocalInteractionState: PiloCanvasLocalInteractionState = {
  currentToolId: "select.idle",
  editingShapeId: null,
  focusedGroupId: null,
  isFocused: false,
  protectedShapeIds: [],
  selectedShapeIds: [],
};
const MAX_DEFERRED_REMOTE_OPERATIONS = 80;

type DeferredRemoteOperationReason = "local-interaction" | "pending-local-sync";

type DeferredRemoteOperation = {
  deferredAt: number;
  operation: CanvasShapeOperationPayload;
  reason: DeferredRemoteOperationReason;
};

type CanvasShapeSerializableMetadata = {
  contentHash?: unknown;
  revision?: unknown;
};

type CanvasRoomShapeMetadataFallback = {
  contentHashes?: Map<string, string>;
  revisions?: Map<string, number>;
};

function readCanvasRoomStateRevision(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function readCanvasRoomStateContentHash(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function serializeCanvasRoomStateShape(
  shape: PiloCanvasFreeformShape,
  fallback: CanvasRoomShapeMetadataFallback = {},
) {
  const shapeRecord = shape as Record<string, unknown> &
    CanvasShapeSerializableMetadata;
  const serializedShape: Record<string, unknown> = { ...shapeRecord };
  const shapeId = typeof shapeRecord.id === "string" ? shapeRecord.id : null;
  const revision =
    readCanvasRoomStateRevision(shapeRecord.revision) ??
    (shapeId ? fallback.revisions?.get(shapeId) ?? null : null);
  const contentHash =
    readCanvasRoomStateContentHash(shapeRecord.contentHash) ??
    (shapeId ? fallback.contentHashes?.get(shapeId) ?? null : null);

  if (revision !== null) {
    serializedShape.revision = revision;
  }

  if (contentHash) {
    serializedShape.contentHash = contentHash;
  }

  return serializedShape;
}

function serializeCanvasRoomStateShapes(
  shapes: PiloCanvasFreeformShape[],
  fallback?: CanvasRoomShapeMetadataFallback,
) {
  return shapes.map((shape) => serializeCanvasRoomStateShape(shape, fallback));
}

function isRemoteOperationProtectedByLocalInteraction({
  localInteractionState,
  operation,
}: {
  localInteractionState: PiloCanvasLocalInteractionState;
  operation: CanvasShapeOperationPayload;
}) {
  return localInteractionState.protectedShapeIds.includes(operation.shapeId);
}

function queueDeferredRemoteOperation(
  queue: Map<number, DeferredRemoteOperation>,
  operation: CanvasShapeOperationPayload,
  reason: DeferredRemoteOperationReason,
) {
  queue.forEach((deferredOperation, opSeq) => {
    if (
      deferredOperation.operation.shapeId === operation.shapeId &&
      opSeq < operation.opSeq
    ) {
      queue.delete(opSeq);
    }
  });

  queue.set(operation.opSeq, {
    deferredAt: Date.now(),
    operation,
    reason,
  });

  if (queue.size <= MAX_DEFERRED_REMOTE_OPERATIONS) {
    return;
  }

  const orderedEntries = Array.from(queue.entries()).sort(
    ([, left], [, right]) => left.operation.opSeq - right.operation.opSeq,
  );
  const latestOpSeqByShapeId = new Map<string, number>();

  orderedEntries.forEach(([opSeq, deferredOperation]) => {
    latestOpSeqByShapeId.set(deferredOperation.operation.shapeId, opSeq);
  });

  for (const [opSeq, deferredOperation] of orderedEntries) {
    if (queue.size <= MAX_DEFERRED_REMOTE_OPERATIONS) break;
    if (deferredOperation.operation.operationType === "delete") continue;
    if (latestOpSeqByShapeId.get(deferredOperation.operation.shapeId) === opSeq) {
      continue;
    }

    queue.delete(opSeq);
  }

  for (const [opSeq] of orderedEntries) {
    if (queue.size <= MAX_DEFERRED_REMOTE_OPERATIONS) break;
    queue.delete(opSeq);
  }

  console.warn("Canvas deferred remote operation queue was compacted.", {
    limit: MAX_DEFERRED_REMOTE_OPERATIONS,
    reason,
    shapeId: operation.shapeId,
  });
}

function readDeferredRemoteOperations(
  queue: Map<number, DeferredRemoteOperation>,
) {
  return Array.from(queue.values())
    .sort((left, right) => left.operation.opSeq - right.operation.opSeq)
    .map(({ operation }) => operation);
}

function isCanvasShapeOperationPayload(
  value: unknown,
): value is CanvasShapeOperationPayload {
  if (!isRecord(value)) return false;

  return (
    typeof value.shapeId === "string" &&
    (value.operationType === "create" ||
      value.operationType === "update" ||
      value.operationType === "delete") &&
    typeof value.opSeq === "number" &&
    Number.isInteger(value.opSeq) &&
    typeof value.actorUserId === "string" &&
    typeof value.resultRevision === "number" &&
    Number.isInteger(value.resultRevision)
  );
}

function readConflictRevision(conflict: CanvasShapeSyncConflict) {
  if (typeof conflict.currentRevision === "number") {
    return conflict.currentRevision;
  }

  const latestOperation = conflict.latestOperation;

  if (
    isRecord(latestOperation) &&
    typeof latestOperation.resultRevision === "number" &&
    Number.isInteger(latestOperation.resultRevision)
  ) {
    return latestOperation.resultRevision;
  }

  const latestShape = conflict.latestShape;

  if (
    isRecord(latestShape) &&
    typeof latestShape.revision === "number" &&
    Number.isInteger(latestShape.revision)
  ) {
    return latestShape.revision;
  }

  return null;
}

function readConflictLatestFreeformShape(conflict: CanvasShapeSyncConflict) {
  const [shape] = normalizeCanvasFreeformShapes([
    normalizeCanvasShape(conflict.latestShape),
  ]) as PiloCanvasFreeformShape[];

  return shape && typeof shape.id === "string" ? shape : null;
}

function readRealtimeCommitErrorStatus(error: unknown) {
  return isRecord(error) && typeof error.status === "number"
    ? error.status
    : null;
}

function getShapeSyncErrorNoticeMessage(error: unknown) {
  if (readRealtimeCommitErrorStatus(error) === 409) {
    return "다른 사용자가 먼저 수정해서 최신 상태로 갱신했어요.";
  }

  return "Canvas 변경사항 저장 중 오류가 발생했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.";
}

function doesShapeIntersectViewport(
  shape: PiloCanvasFreeformShape,
  viewport: PiloCanvasViewportBounds | null,
) {
  if (!viewport) return false;

  const shapeRecord = shape as Record<string, unknown>;
  const shapeX = typeof shape.x === "number" ? shape.x : 0;
  const shapeY = typeof shape.y === "number" ? shape.y : 0;
  const shapeWidth =
    typeof shapeRecord.width === "number" ? shapeRecord.width : 0;
  const shapeHeight =
    typeof shapeRecord.height === "number" ? shapeRecord.height : 0;

  return (
    shapeX + shapeWidth >= viewport.x &&
    shapeX <= viewport.x + viewport.width &&
    shapeY + shapeHeight >= viewport.y &&
    shapeY <= viewport.y + viewport.height
  );
}

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
  onOneShotToolCreated,
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
  const [viewSetting, setViewSetting] = useState<CanvasViewSetting>(
    INITIAL_CANVAS_VIEW_SETTING,
  );
  const [canvasSnapState, setCanvasSnapState] =
    useState<PiloCanvasSnapState>(initialCanvasSnapState);
  const [canvasSyncNotice, setCanvasSyncNotice] =
    useState<CanvasSyncNotice | null>(null);
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
  const unloadedShapeIdsRef = useRef(new Set<string>());
  const deletedShapeIdsRef = useRef(new Set<string>());
  const pendingShapeDetailRef = useRef<string | null>(null);
  const shapeDetailRequestSeqRef = useRef(0);
  const pendingLocalShapeVersionsRef = useRef(new Map<string, number>());
  const pendingRemoteFrameChildrenRequestRef = useRef(new Set<string>());
  const deferredRemoteOperationsRef = useRef(
    new Map<number, DeferredRemoteOperation>(),
  );
  const localInteractionStateRef = useRef<PiloCanvasLocalInteractionState>(
    initialLocalInteractionState,
  );
  const remoteShapeRevisionRef = useRef(new Map<string, number>());
  const remoteShapeContentHashRef = useRef(new Map<string, string>());
  const localShapeVersionRef = useRef(0);
  const [canvasHydrationVersion, setCanvasHydrationVersion] = useState(0);
  const [cameraRestoreVersion, setCameraRestoreVersion] = useState(0);
  const currentRealtimeUserId = realtime?.currentUser?.userId ?? null;
  const showCanvasSyncNotice = useCallback(
    (message: string, tone: CanvasSyncNotice["tone"] = "info") => {
      setCanvasSyncNotice({
        id: Date.now(),
        message,
        tone,
      });
    },
    [],
  );
  const markShapeDeleted = useCallback((shapeId: string) => {
    deletedShapeIdsRef.current.add(shapeId);
    unloadedShapeIdsRef.current.delete(shapeId);
    shapeDetailCacheRef.current.delete(shapeId);
    pendingLocalShapeVersionsRef.current.delete(shapeId);
    remoteShapeContentHashRef.current.delete(shapeId);
  }, []);
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
      const expandedFrameIds = new Set<string>();

      sortedOperations.forEach((operation) => {
        deferredRemoteOperationsRef.current.delete(operation.opSeq);

        const isOwnOperation = operation.actorUserId === currentRealtimeUserId;
        const hasLocalShape = nextFreeformShapes.some(
          (shape) => getFreeformShapeId(shape) === operation.shapeId,
        );
        if (
          isOwnOperation &&
          (operation.operationType !== "create" || hasLocalShape)
        ) {
          remoteShapeRevisionRef.current.set(
            operation.shapeId,
            Math.max(
              remoteShapeRevisionRef.current.get(operation.shapeId) ?? 0,
              operation.resultRevision,
            ),
          );
          if (operation.operationType === "delete") {
            remoteShapeContentHashRef.current.delete(operation.shapeId);
          } else {
            remoteShapeContentHashRef.current.set(
              operation.shapeId,
              operation.contentHash,
            );
          }
          return;
        }

        if (
          isRemoteOperationProtectedByLocalInteraction({
            localInteractionState: localInteractionStateRef.current,
            operation,
          })
        ) {
          queueDeferredRemoteOperation(
            deferredRemoteOperationsRef.current,
            operation,
            "local-interaction",
          );
          return;
        }

        if (operation.operationType === "delete") {
          markShapeDeleted(operation.shapeId);
        } else if (deletedShapeIdsRef.current.has(operation.shapeId)) {
          remoteShapeRevisionRef.current.set(
            operation.shapeId,
            Math.max(
              remoteShapeRevisionRef.current.get(operation.shapeId) ?? 0,
              operation.resultRevision,
            ),
          );
          remoteShapeContentHashRef.current.set(
            operation.shapeId,
            operation.contentHash,
          );
          return;
        }

        if (pendingLocalShapeVersionsRef.current.has(operation.shapeId)) {
          queueDeferredRemoteOperation(
            deferredRemoteOperationsRef.current,
            operation,
            "pending-local-sync",
          );
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
        if (operation.operationType === "delete") {
          remoteShapeContentHashRef.current.delete(operation.shapeId);
        } else {
          remoteShapeContentHashRef.current.set(
            operation.shapeId,
            operation.contentHash,
          );
        }
        result.expandedFrameIds.forEach((frameId) => {
          expandedFrameIds.add(frameId);
        });
        result.unloadedShapeIds.forEach((shapeId) => {
          unloadedShapeIdsRef.current.add(shapeId);
        });

        if (!result.changed) {
          return;
        }

        nextFreeformShapes = result.nextShapes;
        hasVisibleShapeChange = true;
      });

      expandedFrameIds.forEach((frameId) => {
        pendingRemoteFrameChildrenRequestRef.current.add(frameId);
      });

      if (!hasVisibleShapeChange) {
        return;
      }

      freeformShapesRef.current = nextFreeformShapes;
      setFreeformShapes(nextFreeformShapes);
      setCanvasHydrationVersion((version) => version + 1);
    },
    [currentRealtimeUserId, markShapeDeleted, storageMode],
  );
  const flushDeferredRemoteOperations = useCallback(() => {
    if (!deferredRemoteOperationsRef.current.size) {
      return;
    }

    applyRemoteCanvasOperations(
      readDeferredRemoteOperations(deferredRemoteOperationsRef.current),
    );
  }, [applyRemoteCanvasOperations]);
  const handleLocalInteractionStateChange = useCallback(
    (state: PiloCanvasLocalInteractionState) => {
      localInteractionStateRef.current = state;

      if (!state.protectedShapeIds.length) {
        flushDeferredRemoteOperations();
      }
    },
    [flushDeferredRemoteOperations],
  );
  const handleShapeSyncConflict = useCallback(
    (conflict: CanvasShapeSyncConflict) => {
      const conflictRevision = readConflictRevision(conflict);
      const latestOperation = isCanvasShapeOperationPayload(
        conflict.latestOperation,
      )
        ? conflict.latestOperation
        : null;

      showCanvasSyncNotice(
        "다른 사용자가 먼저 수정해서 최신 상태로 갱신했어요.",
        "info",
      );
      pendingLocalShapeVersionsRef.current.delete(conflict.shapeId);

      if (
        latestOperation &&
        latestOperation.actorUserId !== currentRealtimeUserId
      ) {
        applyRemoteCanvasOperations([latestOperation]);
      } else {
        if (conflictRevision !== null) {
          remoteShapeRevisionRef.current.set(
            conflict.shapeId,
            Math.max(
              remoteShapeRevisionRef.current.get(conflict.shapeId) ?? 0,
              conflictRevision,
            ),
          );
        }

        const latestShape = readConflictLatestFreeformShape(conflict);

        if (latestShape) {
          deletedShapeIdsRef.current.delete(conflict.shapeId);
          unloadedShapeIdsRef.current.delete(conflict.shapeId);
          shapeDetailCacheRef.current.set(conflict.shapeId, latestShape);

          setFreeformShapes((currentShapes) => {
            const nextShapes = mergeFreeformShapesById(currentShapes, [
              latestShape,
            ]);

            freeformShapesRef.current = nextShapes;
            return nextShapes;
          });
          setCanvasHydrationVersion((version) => version + 1);
        }
      }

      flushDeferredRemoteOperations();
    },
    [
      applyRemoteCanvasOperations,
      currentRealtimeUserId,
      flushDeferredRemoteOperations,
      showCanvasSyncNotice,
    ],
  );
  const handleShapeSyncError = useCallback(
    (error: unknown) => {
      showCanvasSyncNotice(getShapeSyncErrorNoticeMessage(error), "warning");

      void queryClient.invalidateQueries({
        queryKey: ["canvas", board.workspaceId, board.id, "viewport-shapes"],
      });
    },
    [board.id, board.workspaceId, queryClient, showCanvasSyncNotice],
  );
  const hydrateRoomShapesRef = useRef<
    (shapes: Record<string, unknown>[]) => void
  >(() => {});
  const hydrateRoomShapes = useCallback((shapes: Record<string, unknown>[]) => {
    hydrateRoomShapesRef.current(shapes);
  }, []);
  const applyRoomShapePatch = useCallback(
    (patch: { deletedShapeIds: string[]; upsertShapes: Record<string, unknown>[] }) => {
      patch.deletedShapeIds.forEach((shapeId) => {
        markShapeDeleted(shapeId);
      });

      if (patch.deletedShapeIds.length) {
        setFreeformShapes((currentShapes) => {
          const deletedShapeIds = new Set(patch.deletedShapeIds);
          const nextShapes = currentShapes.filter((shape) => {
            const shapeId = getFreeformShapeId(shape);

            return !shapeId || !deletedShapeIds.has(shapeId);
          });

          freeformShapesRef.current = nextShapes;
          return nextShapes;
        });
        setCanvasHydrationVersion((version) => version + 1);
      }

      hydrateRoomShapes(patch.upsertShapes);
    },
    [hydrateRoomShapes, markShapeDeleted],
  );
  const canvasPresence = useCanvasPresence(realtime, {
    applyOperations: applyRemoteCanvasOperations,
    applyRoomShapePatch,
    catchUpOperations: catchUpCanvasOperations,
    hydrateShapes: hydrateRoomShapes,
  });
  const persistThroughRoomState = canvasPresence.roomStateActive;
  const sendRoomShapePatch = useCallback(
    (patch: {
      deletedShapeIds: string[];
      upsertShapes: PiloCanvasFreeformShape[];
    }) => {
      if (!persistThroughRoomState) {
        return false;
      }

      return canvasPresence.sendRoomShapePatch({
        deletedShapeIds: patch.deletedShapeIds,
        upsertShapes: serializeCanvasRoomStateShapes(patch.upsertShapes, {
          contentHashes: remoteShapeContentHashRef.current,
          revisions: remoteShapeRevisionRef.current,
        }),
      });
    },
    [canvasPresence.sendRoomShapePatch, persistThroughRoomState],
  );
  const reportLoadedViewport = useCallback(
    (
      bounds: {
        height: number;
        margin: number;
        width: number;
        x: number;
        y: number;
      },
      shapes: PiloCanvasFreeformShape[],
    ) => {
      canvasPresence.reportLoadedViewport(
        bounds,
        serializeCanvasRoomStateShapes(shapes, {
          contentHashes: remoteShapeContentHashRef.current,
          revisions: remoteShapeRevisionRef.current,
        }),
      );
    },
    [canvasPresence.reportLoadedViewport],
  );

  useEffect(() => {
    if (canvasPresence.checkpointStatus?.status !== "delayed") {
      return;
    }

    showCanvasSyncNotice(
      "Canvas 변경사항 저장이 지연되고 있어요. 연결이 회복되면 다시 저장을 시도합니다.",
      "warning",
    );
  }, [canvasPresence.checkpointStatus, showCanvasSyncNotice]);

  useEffect(() => {
    deferredRemoteOperationsRef.current.clear();
    remoteShapeRevisionRef.current.clear();
    remoteShapeContentHashRef.current.clear();
    deletedShapeIdsRef.current.clear();
    unloadedShapeIdsRef.current.clear();
  }, [board.id]);

  useEffect(() => {
    if (!canvasSyncNotice) return undefined;

    const noticeTimer = setTimeout(() => {
      setCanvasSyncNotice((currentNotice) =>
        currentNotice?.id === canvasSyncNotice.id ? null : currentNotice,
      );
    }, 5000);

    return () => {
      clearTimeout(noticeTimer);
    };
  }, [canvasSyncNotice]);

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
    remoteShapeRevisionRef,
    onShapeSyncError: handleShapeSyncError,
    onShapeSyncConflict: handleShapeSyncConflict,
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
    onRoomShapePatch: sendRoomShapePatch,
    onShapeSyncConflict: handleShapeSyncConflict,
    onShapeSyncError: handleShapeSyncError,
    pendingLocalShapeVersionsRef,
    persistThroughRoomState,
    remoteShapeRevisionRef,
    setCanvasHydrationVersion,
    setFreeformShapes,
    shapeDetailCacheRef,
    shapeSyncQueueRef,
    storageMode,
    deletedShapeIdsRef,
    unloadedShapeIdsRef,
  });

  useEffect(() => {
    hydrateRoomShapesRef.current = (rawShapes: Record<string, unknown>[]) => {
      rawShapes.forEach((shape) => {
        const shapeId = typeof shape.id === "string" ? shape.id : null;
        const revision = readCanvasRoomStateRevision(shape.revision);
        const contentHash = readCanvasRoomStateContentHash(shape.contentHash);

        if (!shapeId) return;
        if (revision !== null) {
          remoteShapeRevisionRef.current.set(
            shapeId,
            Math.max(remoteShapeRevisionRef.current.get(shapeId) ?? 0, revision),
          );
        }
        if (contentHash) {
          remoteShapeContentHashRef.current.set(shapeId, contentHash);
        }
      });

      const hydratedShapes = normalizeCanvasFreeformShapes(
        rawShapes,
      ) as PiloCanvasFreeformShape[];
      const nextShapes = hydratedShapes.filter((shape) => {
        if (typeof shape.id !== "string") return true;
        return !deletedShapeIdsRef.current.has(shape.id);
      });

      if (!nextShapes.length) return;

      nextShapes.forEach((shape) => {
        if (typeof shape.id !== "string") return;

        unloadedShapeIdsRef.current.delete(shape.id);
        shapeDetailCacheRef.current.set(shape.id, shape);
      });

      const visibleShapes = nextShapes.filter((shape) =>
        doesShapeIntersectViewport(shape, latestViewportBoundsRef.current),
      );

      if (visibleShapes.length) {
        mergeLoadedFreeformShapes(visibleShapes);
      }
    };
  }, [mergeLoadedFreeformShapes]);

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

  const { loadFrameChildren, loadShapeDetail, loadViewportShapes } =
    useCanvasViewportQueries({
    board,
    canvasClient,
    latestViewportBoundsRef,
    mergeLoadedFreeformShapes,
    pendingShapeDetailRef,
    queryClient,
    shapeDetailCacheRef,
    shapeDetailRequestSeqRef,
    storageMode,
    onViewportShapesLoaded: reportLoadedViewport,
    deletedShapeIdsRef,
    unloadedShapeIdsRef,
    viewportShapeLoadRequestSeqRef,
    viewportShapeLoadTimerRef,
  });

  useEffect(() => {
    if (
      storageMode !== "api" ||
      !pendingRemoteFrameChildrenRequestRef.current.size
    ) {
      return;
    }

    const frameIds = Array.from(pendingRemoteFrameChildrenRequestRef.current);
    pendingRemoteFrameChildrenRequestRef.current.clear();

    frameIds.forEach((frameId) => {
      loadFrameChildren(frameId);
    });
  }, [canvasHydrationVersion, loadFrameChildren, storageMode]);

  const handleFrameChildShapesUnload = useCallback(
    (shapes: PiloCanvasFreeformShape[]) => {
      shapes.forEach((shape) => {
        if (typeof shape.id !== "string") return;
        if (deletedShapeIdsRef.current.has(shape.id)) return;

        unloadedShapeIdsRef.current.add(shape.id);
        shapeDetailCacheRef.current.set(shape.id, shape);
        pendingLocalShapeVersionsRef.current.delete(shape.id);
      });
    },
    [],
  );
  const getPreservedFreeformShapeSnapshots = useCallback(() => {
    const snapshots: PiloCanvasFreeformShape[] = [];

    shapeDetailCacheRef.current.forEach((shape, shapeId) => {
      if (deletedShapeIdsRef.current.has(shapeId)) return;

      snapshots.push(shape);
    });

    return snapshots;
  }, []);

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
          onFrameChildShapesUnload={handleFrameChildShapesUnload}
          onViewportBoundsChange={loadViewportShapes}
          onFrameChildrenRequest={loadFrameChildren}
          getPreservedFreeformShapeSnapshots={
            getPreservedFreeformShapeSnapshots
          }
          onShapeDetailRequest={loadShapeDetail}
          onHistoryStateChange={
            onHistoryStateChange ?? noopCanvasHistoryStateChange
          }
          onLocalInteractionStateChange={handleLocalInteractionStateChange}
          presence={canvasPresence}
          onSnapStateChange={handleSnapStateChange}
          onOneShotToolCreated={onOneShotToolCreated}
          canvasAgentEnabled={storageMode === "api"}
        />
        {canvasSyncNotice ? (
          <div
            className={`canvas-sync-notice canvas-sync-notice--${canvasSyncNotice.tone}`}
            role="status"
          >
            {canvasSyncNotice.message}
          </div>
        ) : null}
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
