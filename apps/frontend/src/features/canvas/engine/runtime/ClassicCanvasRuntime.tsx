"use client";

import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasShapeOperationPayload } from "@/features/canvas/api/canvas-types";
import type { CanvasRealtimeConfig } from "@/shared/canvas-realtime/canvas-realtime-types";
import { useCanvasRoom } from "@/features/canvas/collaboration/useCanvasRoom";
import { normalizeCanvasFreeformShapes } from "@/features/canvas/persistence/canvas-storage";
import type { CanvasShapeSyncQueue } from "@/features/canvas/persistence/canvas-shape-sync";
import { CanvasEditor } from "../editor/CanvasEditor";
import { CLASSIC_CANVAS_INITIAL_ZOOM } from "../editor/canvas-initial-camera";
import type {
  PiloCanvasActions,
  PiloCanvasHistoryState,
  PiloCanvasShapePatch,
  PiloCanvasSnapState,
} from "../editor/canvas-editor-contracts";
import type {
  PiloCanvasFreeformShape,
  PiloCanvasLocalInteractionState,
  PiloCanvasViewportBounds,
} from "../canvas-engine-types";
import { CanvasZoomControls } from "./CanvasZoomControls";
import {
  applyCanvasRemoteOperation,
  applyCanvasRoomShapePatch,
  collectCanvasFrameDescendantShapeIds,
} from "./canvas-remote-operations";
import type {
  CanvasBoardDetail,
  CanvasRuntimeStorageMode,
  CanvasViewSetting,
  CanvasViewSettingApiClient,
} from "./canvas-runtime-types";
import { useCanvasApiLifecycle } from "./useCanvasApiLifecycle";
import { useCanvasRuntimeHydration } from "./useCanvasRuntimeHydration";
import { useCanvasShapePersistence } from "./useCanvasShapePersistence";
import { useCanvasViewportQueries } from "./useCanvasViewportQueries";
import {
  areViewSettingsEqual,
  clampZoom,
  DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN,
  getFreeformShapeId,
} from "./canvas-runtime-utils";

export type { CanvasBoardDetail, CanvasViewSetting } from "./canvas-runtime-types";

type ClassicCanvasRuntimeProps = {
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
  zoom: CLASSIC_CANVAS_INITIAL_ZOOM,
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
  activeMutationShapeIds: [],
  currentToolId: "select.idle",
  editingShapeId: null,
  focusedGroupId: null,
  isFreehandDrawing: false,
  isFocused: false,
  selectedShapeIds: [],
};
const MAX_DEFERRED_REMOTE_OPERATIONS = 80;

type DeferredRemoteOperationReason = "local-interaction" | "pending-local-sync";

type DeferredRemoteOperation = {
  deferredAt: number;
  operation: CanvasShapeOperationPayload;
  reason: DeferredRemoteOperationReason;
};

type DeferredRoomShapeChange = {
  respectViewport: boolean;
  shape: PiloCanvasFreeformShape | null;
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
  return localInteractionState.activeMutationShapeIds.includes(
    operation.shapeId,
  );
}

function isRemoteShapeDeletionProtected({
  currentShapes,
  protectedShapeIds,
  shapeDetailCache,
  shapeId,
}: {
  currentShapes: PiloCanvasFreeformShape[];
  protectedShapeIds: ReadonlySet<string>;
  shapeDetailCache: Map<string, PiloCanvasFreeformShape>;
  shapeId: string;
}) {
  if (protectedShapeIds.has(shapeId)) {
    return true;
  }

  const shape =
    currentShapes.find((candidate) => getFreeformShapeId(candidate) === shapeId) ??
    shapeDetailCache.get(shapeId);

  if (shape?.type !== "frame") {
    return false;
  }

  const descendantIds = collectCanvasFrameDescendantShapeIds(
    [...shapeDetailCache.values(), ...currentShapes],
    shapeId,
  );

  return [...descendantIds].some((descendantId) =>
    protectedShapeIds.has(descendantId),
  );
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

export function ClassicCanvasRuntime({
  ...props
}: ClassicCanvasRuntimeProps) {
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
      <ClassicCanvasRuntimeInner {...props} />
    </QueryClientProvider>
  );
}

function ClassicCanvasRuntimeInner({
  board,
  canvasClient = null,
  onHistoryStateChange,
  onSnapStateChange,
  onOneShotToolCreated,
  onReady,
  realtime = null,
  storageMode = "local",
}: ClassicCanvasRuntimeProps) {
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
  const viewportShapeLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const viewportShapeLoadRequestSeqRef = useRef(0);
  const latestViewportBoundsRef = useRef<PiloCanvasViewportBounds | null>(null);
  const shapeDetailCacheRef = useRef(new Map<string, PiloCanvasFreeformShape>());
  const unloadedShapeIdsRef = useRef(new Set<string>());
  const deletedShapeIdsRef = useRef(new Set<string>());
  const pendingLocalShapeVersionsRef = useRef(new Map<string, number>());
  const pendingRemoteFrameChildrenRequestRef = useRef(new Set<string>());
  const deferredRemoteOperationsRef = useRef(
    new Map<number, DeferredRemoteOperation>(),
  );
  const deferredRoomShapeChangesRef = useRef(
    new Map<string, DeferredRoomShapeChange>(),
  );
  const flushDeferredRoomShapeChangesRef = useRef<() => void>(() => {});
  const pendingSurfaceShapeChangesRef = useRef(
    new Map<string, PiloCanvasFreeformShape | null>(),
  );
  const pendingRoomShapeAckCountsRef = useRef(new Map<string, number>());
  const localInteractionStateRef = useRef<PiloCanvasLocalInteractionState>(
    initialLocalInteractionState,
  );
  const remoteShapeRevisionRef = useRef(new Map<string, number>());
  const remoteShapeContentHashRef = useRef(new Map<string, string>());
  const roomStateShapeIdsRef = useRef(new Set<string>());
  const localShapeVersionRef = useRef(0);
  const [canvasHydrationVersion, setCanvasHydrationVersion] = useState(0);
  const [canvasShapePatchVersion, setCanvasShapePatchVersion] = useState(0);
  const [
    pendingRemoteFrameChildrenRequestVersion,
    setPendingRemoteFrameChildrenRequestVersion,
  ] = useState(0);
  const [cameraResetVersion, setCameraResetVersion] = useState(0);
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
    roomStateShapeIdsRef.current.delete(shapeId);
    deletedShapeIdsRef.current.add(shapeId);
    unloadedShapeIdsRef.current.delete(shapeId);
    shapeDetailCacheRef.current.delete(shapeId);
    pendingLocalShapeVersionsRef.current.delete(shapeId);
    remoteShapeContentHashRef.current.delete(shapeId);
  }, []);
  const queueCanvasSurfaceShapePatch = useCallback(
    (patch: PiloCanvasShapePatch) => {
      patch.deletedShapeIds.forEach((shapeId) => {
        pendingSurfaceShapeChangesRef.current.set(shapeId, null);
      });
      patch.upsertShapes.forEach((shape) => {
        const shapeId = getFreeformShapeId(shape);

        if (shapeId) {
          pendingSurfaceShapeChangesRef.current.set(shapeId, shape);
        }
      });

      if (pendingSurfaceShapeChangesRef.current.size) {
        setCanvasShapePatchVersion((version) => version + 1);
      }
    },
    [],
  );
  const consumeCanvasSurfaceShapePatch = useCallback(() => {
    const deletedShapeIds: string[] = [];
    const upsertShapes: PiloCanvasFreeformShape[] = [];

    pendingSurfaceShapeChangesRef.current.forEach((shape, shapeId) => {
      if (shape) {
        upsertShapes.push(shape);
      } else {
        deletedShapeIds.push(shapeId);
      }
    });
    pendingSurfaceShapeChangesRef.current.clear();

    return {
      deletedShapeIds,
      upsertShapes,
    };
  }, []);
  const isCanvasShapePatchProtected = useCallback((shapeId: string) => {
    return (
      localInteractionStateRef.current.activeMutationShapeIds.includes(
        shapeId,
      ) ||
      pendingLocalShapeVersionsRef.current.has(shapeId) ||
      pendingRoomShapeAckCountsRef.current.has(shapeId)
    );
  }, []);
  const queueRemoteFrameChildrenRequests = useCallback(
    (frameIds: Iterable<string>) => {
      let addedRequest = false;

      for (const frameId of frameIds) {
        if (pendingRemoteFrameChildrenRequestRef.current.has(frameId)) {
          continue;
        }

        pendingRemoteFrameChildrenRequestRef.current.add(frameId);
        addedRequest = true;
      }

      if (addedRequest) {
        setPendingRemoteFrameChildrenRequestVersion((version) => version + 1);
      }
    },
    [],
  );
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
      const frameIdsToLoad = new Set<string>();
      const surfaceDeletedShapeIds = new Set<string>();
      const surfaceUpsertShapeIds = new Set<string>();

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
        result.frameIdsToLoad.forEach((frameId) => {
          frameIdsToLoad.add(frameId);
        });
        result.loadedShapeIds.forEach((shapeId) => {
          unloadedShapeIdsRef.current.delete(shapeId);
        });
        result.unloadedShapeIds.forEach((shapeId) => {
          unloadedShapeIdsRef.current.add(shapeId);
        });

        if (!result.changed) {
          return;
        }

        if (operation.operationType === "delete") {
          surfaceDeletedShapeIds.add(operation.shapeId);
          surfaceUpsertShapeIds.delete(operation.shapeId);
        } else {
          result.loadedShapeIds.forEach((shapeId) => {
            surfaceDeletedShapeIds.delete(shapeId);
            surfaceUpsertShapeIds.add(shapeId);
          });
          result.unloadedShapeIds.forEach((shapeId) => {
            surfaceUpsertShapeIds.delete(shapeId);
            surfaceDeletedShapeIds.add(shapeId);
          });
        }

        nextFreeformShapes = result.nextShapes;
        hasVisibleShapeChange = true;
      });

      queueRemoteFrameChildrenRequests(frameIdsToLoad);

      if (!hasVisibleShapeChange) {
        return;
      }

      freeformShapesRef.current = nextFreeformShapes;
      setFreeformShapes(nextFreeformShapes);
      queueCanvasSurfaceShapePatch({
        deletedShapeIds: [...surfaceDeletedShapeIds],
        upsertShapes: nextFreeformShapes.filter((shape) => {
          const shapeId = getFreeformShapeId(shape);

          return shapeId ? surfaceUpsertShapeIds.has(shapeId) : false;
        }),
      });
    },
    [
      currentRealtimeUserId,
      markShapeDeleted,
      queueCanvasSurfaceShapePatch,
      queueRemoteFrameChildrenRequests,
      storageMode,
    ],
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
      flushDeferredRemoteOperations();
      flushDeferredRoomShapeChangesRef.current();
    },
    [flushDeferredRemoteOperations],
  );
  const handleShapeSyncError = useCallback(
    () => {
      showCanvasSyncNotice(
        "Canvas 변경사항 저장 중 오류가 발생했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.",
        "warning",
      );

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
  const getInitialRealtimeViewportBounds = useCallback(() => {
    const bounds = latestViewportBoundsRef.current;

    if (!bounds) return null;

    return {
      height: bounds.height,
      margin: DEFAULT_VIEWPORT_SHAPE_LOAD_MARGIN,
      width: bounds.width,
      x: bounds.x,
      y: bounds.y,
    };
  }, []);
  const applyNormalizedRoomShapePatch = useCallback(
    (patch: {
      deletedShapeIds: string[];
      respectViewport?: boolean;
      upsertShapes: PiloCanvasFreeformShape[];
    }) => {
      const deletedShapeIdSet = new Set(patch.deletedShapeIds);

      patch.deletedShapeIds.forEach((shapeId) => {
        markShapeDeleted(shapeId);
      });
      patch.upsertShapes.forEach((shape) => {
        const shapeId = getFreeformShapeId(shape);

        if (!shapeId || deletedShapeIdSet.has(shapeId)) return;
        deletedShapeIdsRef.current.delete(shapeId);
      });
      const result = applyCanvasRoomShapePatch({
        currentShapes: freeformShapesRef.current,
        deletedShapeIds: patch.deletedShapeIds,
        respectViewport: patch.respectViewport,
        shapeDetailCache: shapeDetailCacheRef.current,
        upsertShapes: patch.upsertShapes,
        viewportBounds: latestViewportBoundsRef.current,
      });

      result.loadedShapeIds.forEach((shapeId) => {
        unloadedShapeIdsRef.current.delete(shapeId);
      });
      result.unloadedShapeIds.forEach((shapeId) => {
        unloadedShapeIdsRef.current.add(shapeId);
      });
      queueRemoteFrameChildrenRequests(result.frameIdsToLoad);

      const surfaceDeletedShapeIds = new Set([
        ...patch.deletedShapeIds,
        ...result.unloadedShapeIds,
      ]);
      const surfaceLoadedShapeIds = new Set(result.loadedShapeIds);
      const surfaceUpsertShapes = result.nextShapes.filter((shape) => {
        const shapeId = getFreeformShapeId(shape);

        return shapeId ? surfaceLoadedShapeIds.has(shapeId) : false;
      });
      queueCanvasSurfaceShapePatch({
        deletedShapeIds: [...surfaceDeletedShapeIds],
        upsertShapes: surfaceUpsertShapes,
      });

      if (!result.changed) {
        return;
      }

      freeformShapesRef.current = result.nextShapes;
      setFreeformShapes(result.nextShapes);
    },
    [
      markShapeDeleted,
      queueCanvasSurfaceShapePatch,
      queueRemoteFrameChildrenRequests,
    ],
  );
  const applyRoomShapePatch = useCallback(
    (
      patch: {
        actorUserId?: string;
        deletedShapeIds: string[];
        upsertShapes: Record<string, unknown>[];
      },
      options: { respectViewport?: boolean } = {},
    ) => {
      const deletedShapeIdSet = new Set(patch.deletedShapeIds);
      const respectViewport = options.respectViewport ?? false;
      const patchedShapeIds = new Set([
        ...patch.deletedShapeIds,
        ...patch.upsertShapes.flatMap((shape) =>
          typeof shape.id === "string" ? [shape.id] : [],
        ),
      ]);

      if (patch.actorUserId === currentRealtimeUserId) {
        patchedShapeIds.forEach((shapeId) => {
          const pendingAckCount =
            pendingRoomShapeAckCountsRef.current.get(shapeId) ?? 0;

          if (pendingAckCount <= 1) {
            pendingRoomShapeAckCountsRef.current.delete(shapeId);
          } else {
            pendingRoomShapeAckCountsRef.current.set(
              shapeId,
              pendingAckCount - 1,
            );
          }
        });
      }

      patch.upsertShapes.forEach((shape) => {
        const shapeId = typeof shape.id === "string" ? shape.id : null;
        const revision = readCanvasRoomStateRevision(shape.revision);
        const contentHash = readCanvasRoomStateContentHash(shape.contentHash);

        if (!shapeId || deletedShapeIdSet.has(shapeId)) return;
        roomStateShapeIdsRef.current.add(shapeId);
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

      const normalizedUpsertShapes = normalizeCanvasFreeformShapes(
        patch.upsertShapes,
      ) as PiloCanvasFreeformShape[];
      const protectedShapeIds = new Set([
        ...localInteractionStateRef.current.activeMutationShapeIds,
        ...pendingLocalShapeVersionsRef.current.keys(),
        ...pendingRoomShapeAckCountsRef.current.keys(),
      ]);
      const immediateDeletedShapeIds: string[] = [];
      const immediateUpsertShapes: PiloCanvasFreeformShape[] = [];

      patch.deletedShapeIds.forEach((shapeId) => {
        if (
          isRemoteShapeDeletionProtected({
            currentShapes: freeformShapesRef.current,
            protectedShapeIds,
            shapeDetailCache: shapeDetailCacheRef.current,
            shapeId,
          })
        ) {
          deferredRoomShapeChangesRef.current.set(shapeId, {
            respectViewport,
            shape: null,
          });
          return;
        }

        deferredRoomShapeChangesRef.current.delete(shapeId);
        immediateDeletedShapeIds.push(shapeId);
      });

      normalizedUpsertShapes.forEach((shape) => {
        const shapeId = getFreeformShapeId(shape);

        if (!shapeId) {
          return;
        }
        if (deletedShapeIdSet.has(shapeId)) {
          return;
        }

        if (protectedShapeIds.has(shapeId)) {
          deferredRoomShapeChangesRef.current.set(shapeId, {
            respectViewport,
            shape,
          });
          return;
        }

        deferredRoomShapeChangesRef.current.delete(shapeId);
        immediateUpsertShapes.push(shape);
      });

      if (!immediateDeletedShapeIds.length && !immediateUpsertShapes.length) {
        return;
      }

      applyNormalizedRoomShapePatch({
        deletedShapeIds: immediateDeletedShapeIds,
        respectViewport,
        upsertShapes: immediateUpsertShapes,
      });
    },
    [
      applyNormalizedRoomShapePatch,
      currentRealtimeUserId,
    ],
  );
  const flushDeferredRoomShapeChanges = useCallback(() => {
    if (!deferredRoomShapeChangesRef.current.size) {
      return;
    }

    const protectedShapeIds = new Set([
      ...localInteractionStateRef.current.activeMutationShapeIds,
      ...pendingLocalShapeVersionsRef.current.keys(),
      ...pendingRoomShapeAckCountsRef.current.keys(),
    ]);
    const readyDeletedShapeIds: string[] = [];
    const readyViewportUpsertShapes: PiloCanvasFreeformShape[] = [];
    const readyRoomUpsertShapes: PiloCanvasFreeformShape[] = [];

    deferredRoomShapeChangesRef.current.forEach((change, shapeId) => {
      if (!change.shape) {
        if (
          isRemoteShapeDeletionProtected({
            currentShapes: freeformShapesRef.current,
            protectedShapeIds,
            shapeDetailCache: shapeDetailCacheRef.current,
            shapeId,
          })
        ) {
          return;
        }

        deferredRoomShapeChangesRef.current.delete(shapeId);
        readyDeletedShapeIds.push(shapeId);
        return;
      }

      if (protectedShapeIds.has(shapeId)) {
        return;
      }

      deferredRoomShapeChangesRef.current.delete(shapeId);
      if (change.respectViewport) {
        readyViewportUpsertShapes.push(change.shape);
      } else {
        readyRoomUpsertShapes.push(change.shape);
      }
    });

    if (readyDeletedShapeIds.length || readyRoomUpsertShapes.length) {
      applyNormalizedRoomShapePatch({
        deletedShapeIds: readyDeletedShapeIds,
        respectViewport: false,
        upsertShapes: readyRoomUpsertShapes,
      });
    }

    if (readyViewportUpsertShapes.length) {
      applyNormalizedRoomShapePatch({
        deletedShapeIds: [],
        respectViewport: true,
        upsertShapes: readyViewportUpsertShapes,
      });
    }
  }, [applyNormalizedRoomShapePatch]);
  flushDeferredRoomShapeChangesRef.current = flushDeferredRoomShapeChanges;
  const canvasPresence = useCanvasRoom(realtime, {
    applyOperations: applyRemoteCanvasOperations,
    applyRoomShapePatch,
    catchUpOperations: catchUpCanvasOperations,
    getInitialViewportBounds: getInitialRealtimeViewportBounds,
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

      const didSendPatch = canvasPresence.sendRoomShapePatch({
        deletedShapeIds: patch.deletedShapeIds,
        upsertShapes: serializeCanvasRoomStateShapes(patch.upsertShapes, {
          contentHashes: remoteShapeContentHashRef.current,
          revisions: remoteShapeRevisionRef.current,
        }),
      });

      if (didSendPatch) {
        const patchedShapeIds = new Set([
          ...patch.deletedShapeIds,
          ...patch.upsertShapes.flatMap((shape) => {
            const shapeId = getFreeformShapeId(shape);

            return shapeId ? [shapeId] : [];
          }),
        ]);

        patchedShapeIds.forEach((shapeId) => {
          pendingRoomShapeAckCountsRef.current.set(
            shapeId,
            (pendingRoomShapeAckCountsRef.current.get(shapeId) ?? 0) + 1,
          );
        });
      }

      return didSendPatch;
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
    switch (canvasPresence.checkpointStatus?.status) {
      case "saving":
        showCanvasSyncNotice("Canvas 변경사항을 저장하는 중이에요.");
        break;
      case "saved":
        showCanvasSyncNotice("Canvas 변경사항을 모두 저장했어요.");
        break;
      case "delayed":
        showCanvasSyncNotice(
          "Canvas 변경사항 저장이 지연되고 있어요. 연결이 회복되면 다시 저장을 시도합니다.",
          "warning",
        );
        break;
      default:
        break;
    }
  }, [canvasPresence.checkpointStatus, showCanvasSyncNotice]);

  useEffect(() => {
    deferredRemoteOperationsRef.current.clear();
    deferredRoomShapeChangesRef.current.clear();
    pendingSurfaceShapeChangesRef.current.clear();
    pendingRemoteFrameChildrenRequestRef.current.clear();
    pendingRoomShapeAckCountsRef.current.clear();
    remoteShapeRevisionRef.current.clear();
    remoteShapeContentHashRef.current.clear();
    roomStateShapeIdsRef.current.clear();
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

  useCanvasRuntimeHydration({
    board,
    freeformShapesRef,
    pendingLocalShapeVersionsRef,
    setCameraResetVersion,
    setCanvasHydrationVersion,
    setFreeformShapes,
    shapeDetailCacheRef,
    storageMode,
    viewportShapeLoadRequestSeqRef,
  });

  useEffect(() => {
    setViewSetting(INITIAL_CANVAS_VIEW_SETTING);
  }, [board.id]);

  useCanvasApiLifecycle({
    board,
    canvasClient,
    latestViewportBoundsRef,
    queryClient,
    remoteShapeRevisionRef,
    onShapeSyncError: handleShapeSyncError,
    shapeSyncQueueRef,
    storageMode,
    viewportShapeLoadTimerRef,
  });

  const flushDeferredRemoteChanges = useCallback(() => {
    flushDeferredRemoteOperations();
    flushDeferredRoomShapeChanges();
  }, [flushDeferredRemoteOperations, flushDeferredRoomShapeChanges]);
  useEffect(() => {
    if (canvasPresence.roomStateActive) return;

    pendingRoomShapeAckCountsRef.current.clear();
    flushDeferredRemoteChanges();
  }, [canvasPresence.roomStateActive, flushDeferredRemoteChanges]);
  const handleLoadedShapesMerged = useCallback(
    (upsertShapes: PiloCanvasFreeformShape[]) => {
      queueCanvasSurfaceShapePatch({
        deletedShapeIds: [],
        upsertShapes,
      });
    },
    [queueCanvasSurfaceShapePatch],
  );
  const {
    captureDraftFreeformShapes,
    mergeLoadedFreeformShapes,
    persistFreeformShapes,
  } = useCanvasShapePersistence({
    board,
    canvasClient,
    freeformShapesRef,
    localShapeVersionRef,
    onLocalShapeSyncIdle: flushDeferredRemoteChanges,
    onLoadedShapesMerged: handleLoadedShapesMerged,
    onRoomShapePatch: sendRoomShapePatch,
    onShapeSyncError: handleShapeSyncError,
    pendingLocalShapeVersionsRef,
    persistThroughRoomState,
    remoteShapeRevisionRef,
    roomStateShapeIdsRef,
    setFreeformShapes,
    shapeDetailCacheRef,
    shapeSyncQueueRef,
    storageMode,
    deletedShapeIdsRef,
    unloadedShapeIdsRef,
  });

  useEffect(() => {
    onReady(canvasActions);
  }, [canvasActions, onReady]);

  useEffect(() => {
    hydrateRoomShapesRef.current = (rawShapes: Record<string, unknown>[]) => {
      const nextShapes = rawShapes.filter((shape) => {
        const shapeId = typeof shape.id === "string" ? shape.id : null;

        if (!shapeId) return true;
        return (
          !deletedShapeIdsRef.current.has(shapeId) &&
          !pendingLocalShapeVersionsRef.current.has(shapeId)
        );
      });

      if (!nextShapes.length) return;

      applyRoomShapePatch(
        {
          deletedShapeIds: [],
          upsertShapes: nextShapes,
        },
        {
          respectViewport: true,
        },
      );
    };
  }, [applyRoomShapePatch]);

  const handleViewChange = useCallback((nextViewSetting: CanvasViewSetting) => {
    const normalizedViewSetting = {
      zoom: clampZoom(nextViewSetting.zoom),
      viewportX: nextViewSetting.viewportX,
      viewportY: nextViewSetting.viewportY,
    };

    setViewSetting((currentViewSetting) =>
      areViewSettingsEqual(currentViewSetting, normalizedViewSetting)
        ? currentViewSetting
        : normalizedViewSetting,
    );
  }, []);

  const {
    additionalViewportLoadStatus,
    initialViewportLoadStatus,
    isLoadingFrameChildren,
    isLoadingFrameSubtree,
    loadFrameChildren,
    loadFrameSubtree,
    loadViewportShapes,
    loadingFrameIds,
  } =
    useCanvasViewportQueries({
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
      onViewportShapesLoaded: reportLoadedViewport,
      deletedShapeIdsRef,
      unloadedShapeIdsRef,
      viewportShapeLoadRequestSeqRef,
      viewportShapeLoadTimerRef,
    });

  const lazyLoadNoticeMessage = isLoadingFrameSubtree
    ? "중첩 프레임의 Shape를 불러오는 중이에요."
    : isLoadingFrameChildren
      ? "프레임 안의 Shape를 불러오는 중이에요."
      : additionalViewportLoadStatus === "retrying"
        ? "새 영역의 Canvas Shape를 다시 불러오는 중이에요."
        : additionalViewportLoadStatus === "loading"
          ? "새 영역의 Canvas Shape를 불러오는 중이에요."
          : initialViewportLoadStatus === "retrying"
            ? "Canvas Shape를 다시 불러오는 중이에요."
            : initialViewportLoadStatus === "loading"
              ? "Canvas Shape를 불러오는 중이에요."
              : null;

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
  }, [
    canvasHydrationVersion,
    loadFrameChildren,
    pendingRemoteFrameChildrenRequestVersion,
    storageMode,
  ]);

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
  }, [
    canvasActions,
    canvasSnapState.isSmartGuideEnabled,
    onSnapStateChange,
  ]);

  return (
    <>
      <section className="canvas-content" aria-label="캔버스 보드">
        <CanvasEditor
          board={board}
          cameraResetVersion={cameraResetVersion}
          consumeShapePatch={consumeCanvasSurfaceShapePatch}
          freeformShapes={freeformShapes}
          hydrationVersion={canvasHydrationVersion}
          loadingFrameIds={loadingFrameIds}
          onReady={setCanvasActions}
          onFreeformShapesDraftChange={captureDraftFreeformShapes}
          onFreeformShapesChange={persistFreeformShapes}
          onViewChange={handleViewChange}
          onViewportBoundsChange={loadViewportShapes}
          onFrameSubtreeRequest={loadFrameSubtree}
          getPreservedFreeformShapeSnapshots={
            getPreservedFreeformShapeSnapshots
          }
          isShapePatchProtected={isCanvasShapePatchProtected}
          onHistoryStateChange={
            onHistoryStateChange ?? noopCanvasHistoryStateChange
          }
          onLocalInteractionStateChange={handleLocalInteractionStateChange}
          presence={canvasPresence}
          onSnapStateChange={handleSnapStateChange}
          onOneShotToolCreated={onOneShotToolCreated}
          shapePatchVersion={canvasShapePatchVersion}
          canvasAgentEnabled={storageMode === "api"}
        />
        {canvasSyncNotice || lazyLoadNoticeMessage ? (
          <div
            className={`canvas-sync-notice canvas-sync-notice--${canvasSyncNotice?.tone ?? "info"}`}
            role="status"
          >
            {canvasSyncNotice?.message ?? lazyLoadNoticeMessage}
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
