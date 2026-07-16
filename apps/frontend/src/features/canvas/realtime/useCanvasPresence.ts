"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createCanvasRealtimeSocket,
  getCanvasRealtimeServerUrl,
  type CanvasRealtimeSocket,
} from "@/shared/canvas-realtime/canvas-realtime-client";
import type {
  CanvasJoinedPayload,
  CanvasLoadedViewportBounds,
  CanvasOperationsCatchupPayload,
  CanvasPresenceEditingMode,
  CanvasPresencePoint,
  CanvasPresenceViewport,
  CanvasRealtimeConfig,
  CanvasRemotePresenceState,
  CanvasRoomCheckpointStatusPayload,
  CanvasRoomLoadedRegion,
  CanvasRoomShapePatchPayload,
  CanvasRoomShapePatchEventPayload,
  CanvasShapeLockState,
  CanvasShapeOperationPayload,
  CanvasShapePreviewEventPayload,
  CanvasShapePreviewPhase,
  CanvasSyncRequiredPayload,
} from "@/shared/canvas-realtime/canvas-realtime-types";

const STALE_PRESENCE_TIMEOUT_MS = 15_000;
const STALE_PRESENCE_SWEEP_MS = 2_000;
const STALE_SHAPE_PREVIEW_TIMEOUT_MS = 5_000;

export type CanvasOperationCatchupState = {
  lastSeenOpSeq: number;
  latestOpSeq: number;
  pendingAfterSeq: number | null;
  status: "idle" | "catching_up" | "caught_up" | "failed";
  lastError: string | null;
};

export type CanvasRoomHistoryState = {
  canRedo: boolean;
  canUndo: boolean;
  historySeq: number;
};

export type CanvasPresenceController = {
  enabled: boolean;
  roomStateActive: boolean;
  currentUserId: string | null;
  checkpointStatus: CanvasRoomCheckpointStatusPayload | null;
  lastRejectedShapeLock: { rejectedAt: number; shapeIds: string[] } | null;
  operationSync: CanvasOperationCatchupState;
  ownedShapeLocks: CanvasShapeLockState[];
  roomHistory: CanvasRoomHistoryState;
  roomLoadedRegions: CanvasRoomLoadedRegion[];
  remotePresence: CanvasRemotePresenceState[];
  remoteShapeLocks: CanvasShapeLockState[];
  remoteShapePreviews: CanvasShapePreviewEventPayload[];
  claimShapeLocks: (shapeIds: string[]) => void;
  releaseShapeLocks: (shapeIds?: string[]) => void;
  reportLoadedViewport: (
    bounds: CanvasLoadedViewportBounds,
    shapes?: Record<string, unknown>[],
  ) => void;
  sendRoomShapePatch: (patch: Omit<CanvasRoomShapePatchPayload, "workspaceId" | "canvasId">) => boolean;
  redoRoomHistory: () => boolean;
  undoRoomHistory: () => boolean;
  clearShapePreview: (shapeIds: string[]) => void;
  sendPresenceUpdate: (
    cursor: CanvasPresencePoint | null,
    selectedShapeIds: string[],
    viewport: CanvasPresenceViewport,
    editingShapeId?: string | null,
    editingMode?: CanvasPresenceEditingMode | null,
  ) => void;
  sendShapePreview: (
    shapes: Record<string, unknown>[],
    phase?: CanvasShapePreviewPhase,
    deletedShapeIds?: string[],
  ) => void;
};

export type CanvasPresenceOptions = {
  applyOperations?: (operations: CanvasShapeOperationPayload[]) => void;
  catchUpOperations?: (
    afterSeq: number,
    signal?: AbortSignal,
  ) => Promise<CanvasOperationsCatchupPayload>;
  hydrateShapes?: (shapes: Record<string, unknown>[]) => void;
  applyRoomShapePatch?: (patch: CanvasRoomShapePatchEventPayload) => void;
};

const initialOperationSyncState: CanvasOperationCatchupState = {
  lastSeenOpSeq: 0,
  latestOpSeq: 0,
  pendingAfterSeq: null,
  status: "idle",
  lastError: null,
};

const initialRoomHistoryState: CanvasRoomHistoryState = {
  canRedo: false,
  canUndo: false,
  historySeq: 0,
};

function isUsableRealtimeConfig(
  config: CanvasRealtimeConfig | null | undefined,
): config is CanvasRealtimeConfig & {
  authToken: string;
  currentUser: NonNullable<CanvasRealtimeConfig["currentUser"]>;
} {
  return Boolean(
    config?.enabled &&
      config.workspaceId.trim() &&
      config.canvasId.trim() &&
      config.authToken?.trim() &&
      config.currentUser?.userId.trim(),
  );
}

function parsePresenceTimestamp(updatedAt: string) {
  const time = new Date(updatedAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPresencePoint(value: unknown): value is CanvasPresencePoint {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y)
  );
}

function isPresenceViewport(value: unknown): value is CanvasPresenceViewport {
  return (
    isRecord(value) &&
    typeof value.height === "number" &&
    typeof value.width === "number" &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.zoom === "number" &&
    Number.isFinite(value.height) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.zoom)
  );
}

function isPresenceEditingMode(
  value: unknown,
): value is CanvasPresenceEditingMode {
  return (
    value === "code" ||
    value === "draw" ||
    value === "hand" ||
    value === "move" ||
    value === "placement" ||
    value === "resize" ||
    value === "select" ||
    value === "text"
  );
}

function normalizeRemotePresence(
  payload: unknown,
): CanvasRemotePresenceState | null {
  const source =
    isRecord(payload) && isRecord(payload.presence)
      ? payload.presence
      : payload;

  if (!isRecord(source)) {
    return null;
  }

  const nestedUser = isRecord(source.user) ? source.user : null;
  const userId =
    typeof source.userId === "string"
      ? source.userId
      : typeof nestedUser?.userId === "string"
        ? nestedUser.userId
        : "";
  const workspaceId =
    typeof source.workspaceId === "string"
      ? source.workspaceId
      : isRecord(payload) && typeof payload.workspaceId === "string"
        ? payload.workspaceId
        : "";
  const canvasId =
    typeof source.canvasId === "string"
      ? source.canvasId
      : isRecord(payload) && typeof payload.canvasId === "string"
        ? payload.canvasId
        : "";
  const selectedShapeIds = Array.isArray(source.selectedShapeIds)
    ? source.selectedShapeIds.filter((shapeId) => typeof shapeId === "string")
    : [];
  const editingShapeId =
    typeof source.editingShapeId === "string" && source.editingShapeId
      ? source.editingShapeId
      : null;
  const editingMode = isPresenceEditingMode(source.editingMode)
    ? source.editingMode
    : null;
  const cursor = source.cursor === null ? null : source.cursor;
  const updatedAt =
    typeof source.updatedAt === "string"
      ? source.updatedAt
      : new Date().toISOString();

  if (!userId || !workspaceId || !canvasId) {
    return null;
  }

  if (cursor !== null && !isPresencePoint(cursor)) {
    return null;
  }

  return {
    canvasId,
    cursor,
    displayName:
      typeof source.displayName === "string"
        ? source.displayName
        : typeof nestedUser?.displayName === "string"
          ? nestedUser.displayName
          : "PILO",
    editingMode,
    editingShapeId,
    selectedShapeIds,
    ...(typeof source.sentAt === "string" ? { sentAt: source.sentAt } : {}),
    updatedAt,
    userId,
    ...(isPresenceViewport(source.viewport) ? { viewport: source.viewport } : {}),
    workspaceId,
  };
}

function normalizeRemotePresenceList(
  payloads: unknown,
): CanvasRemotePresenceState[] {
  if (!Array.isArray(payloads)) {
    return [];
  }

  return payloads.flatMap((payload) => {
    const normalizedPresence = normalizeRemotePresence(payload);

    return normalizedPresence ? [normalizedPresence] : [];
  });
}

function filterOwnPresence(
  presence: CanvasRemotePresenceState[],
  currentUserId: string,
) {
  return presence.filter((entry) => entry.userId !== currentUserId);
}

function upsertPresence(
  presence: CanvasRemotePresenceState[],
  nextPresence: CanvasRemotePresenceState,
) {
  const remainingPresence = presence.filter(
    (entry) => entry.userId !== nextPresence.userId,
  );

  return [...remainingPresence, nextPresence].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

function isSameCanvasRoom(
  payload: { canvasId: string; workspaceId: string },
  room: { canvasId: string; workspaceId: string },
) {
  return (
    payload.workspaceId === room.workspaceId && payload.canvasId === room.canvasId
  );
}

function isShapeLockFresh(lock: CanvasShapeLockState) {
  return Date.parse(lock.expiresAt) > Date.now();
}

function upsertShapeLocks(
  locks: CanvasShapeLockState[],
  nextLocks: CanvasShapeLockState[],
) {
  const lockMap = new Map<string, CanvasShapeLockState>();

  locks.filter(isShapeLockFresh).forEach((lock) => {
    lockMap.set(lock.shapeId, lock);
  });
  nextLocks.filter(isShapeLockFresh).forEach((lock) => {
    lockMap.set(lock.shapeId, lock);
  });

  return Array.from(lockMap.values()).sort((a, b) =>
    a.shapeId.localeCompare(b.shapeId),
  );
}

function removeShapeLocks({
  locks,
  ownerUserId,
  shapeIds,
}: {
  locks: CanvasShapeLockState[];
  ownerUserId: string;
  shapeIds: string[];
}) {
  const releasedShapeIds = new Set(shapeIds);

  return locks.filter(
    (lock) =>
      lock.ownerUserId !== ownerUserId || !releasedShapeIds.has(lock.shapeId),
  );
}

function upsertShapePreview(
  previews: CanvasShapePreviewEventPayload[],
  nextPreview: CanvasShapePreviewEventPayload,
) {
  return [
    ...previews.filter(
      (preview) => preview.actorUserId !== nextPreview.actorUserId,
    ),
    nextPreview,
  ];
}

function hasShapePreviewPayload(preview: CanvasShapePreviewEventPayload) {
  return Boolean(preview.shapes.length || preview.deletedShapeIds?.length);
}

function removeShapePreviewIds({
  actorUserId,
  previews,
  shapeIds,
}: {
  actorUserId: string;
  previews: CanvasShapePreviewEventPayload[];
  shapeIds: string[];
}) {
  if (!shapeIds.length) return previews;

  const shapeIdSet = new Set(shapeIds);

  return previews.flatMap((preview) => {
    if (preview.actorUserId !== actorUserId) {
      return [preview];
    }

    const nextPreview = {
      ...preview,
      deletedShapeIds: preview.deletedShapeIds?.filter(
        (shapeId) => !shapeIdSet.has(shapeId),
      ),
      shapes: preview.shapes.filter((shape) => {
        const shapeId = isRecord(shape) ? shape.id : null;

        return typeof shapeId === "string" ? !shapeIdSet.has(shapeId) : true;
      }),
    };

    return hasShapePreviewPayload(nextPreview) ? [nextPreview] : [];
  });
}

export function useCanvasPresence(
  config: CanvasRealtimeConfig | null | undefined,
  options: CanvasPresenceOptions = {},
): CanvasPresenceController {
  const [remotePresence, setRemotePresence] = useState<
    CanvasRemotePresenceState[]
  >([]);
  const [remoteShapeLocks, setRemoteShapeLocks] = useState<
    CanvasShapeLockState[]
  >([]);
  const [ownedShapeLocks, setOwnedShapeLocks] = useState<
    CanvasShapeLockState[]
  >([]);
  const [remoteShapePreviews, setRemoteShapePreviews] = useState<
    CanvasShapePreviewEventPayload[]
  >([]);
  const [roomLoadedRegions, setRoomLoadedRegions] = useState<
    CanvasRoomLoadedRegion[]
  >([]);
  const [roomHistory, setRoomHistory] = useState<CanvasRoomHistoryState>(
    initialRoomHistoryState,
  );
  const [checkpointStatus, setCheckpointStatus] =
    useState<CanvasRoomCheckpointStatusPayload | null>(null);
  const [roomStateActive, setRoomStateActive] = useState(false);
  const [lastRejectedShapeLock, setLastRejectedShapeLock] = useState<{
    rejectedAt: number;
    shapeIds: string[];
  } | null>(null);
  const [operationSync, setOperationSync] = useState<CanvasOperationCatchupState>(
    initialOperationSyncState,
  );
  const socketRef = useRef<CanvasRealtimeSocket | null>(null);
  const joinedRef = useRef(false);
  const roomRef = useRef({ workspaceId: "", canvasId: "" });
  const lastSeenOpSeqRef = useRef(0);
  const applyOperationsRef = useRef(options.applyOperations);
  const catchUpOperationsRef = useRef(options.catchUpOperations);
  const hydrateShapesRef = useRef(options.hydrateShapes);
  const applyRoomShapePatchRef = useRef(options.applyRoomShapePatch);
  const activeCatchUpAbortRef = useRef<AbortController | null>(null);
  const liveOperationBufferRef = useRef<CanvasShapeOperationPayload[]>([]);
  const runCatchUpRef = useRef<(afterSeq: number) => void>(() => {});
  const currentUserId = config?.currentUser?.userId ?? null;
  const usableConfig = isUsableRealtimeConfig(config) ? config : null;
  const enabled = Boolean(usableConfig && getCanvasRealtimeServerUrl());

  useEffect(() => {
    applyOperationsRef.current = options.applyOperations;
    catchUpOperationsRef.current = options.catchUpOperations;
    hydrateShapesRef.current = options.hydrateShapes;
    applyRoomShapePatchRef.current = options.applyRoomShapePatch;
  }, [
    options.applyRoomShapePatch,
    options.applyOperations,
    options.catchUpOperations,
    options.hydrateShapes,
  ]);

  const applyContiguousOperations = useCallback(
    (operations: CanvasShapeOperationPayload[], afterSeq: number) => {
      const contiguousOperations: CanvasShapeOperationPayload[] = [];
      let nextLastSeenOpSeq = Math.max(0, Math.trunc(afterSeq));

      operations
        .slice()
        .sort((a, b) => a.opSeq - b.opSeq)
        .forEach((operation) => {
          if (operation.opSeq <= nextLastSeenOpSeq) {
            return;
          }

          if (operation.opSeq !== nextLastSeenOpSeq + 1) {
            return;
          }

          contiguousOperations.push(operation);
          nextLastSeenOpSeq = operation.opSeq;
        });

      if (contiguousOperations.length) {
        applyOperationsRef.current?.(contiguousOperations);
      }

      return nextLastSeenOpSeq;
    },
    [],
  );

  const setLastSeenOpSeq = useCallback((nextOpSeq: number) => {
    const normalizedOpSeq = Math.max(0, Math.trunc(nextOpSeq));

    lastSeenOpSeqRef.current = normalizedOpSeq;
    setOperationSync((currentState) => ({
      ...currentState,
      lastSeenOpSeq: normalizedOpSeq,
      latestOpSeq: Math.max(currentState.latestOpSeq, normalizedOpSeq),
      lastError: null,
    }));
  }, []);

  const flushBufferedOperations = useCallback(() => {
    const bufferedOperations = liveOperationBufferRef.current;

    if (!bufferedOperations.length) {
      return;
    }

    const nextLastSeenOpSeq = applyContiguousOperations(
      bufferedOperations,
      lastSeenOpSeqRef.current,
    );

    liveOperationBufferRef.current = bufferedOperations.filter(
      (operation) => operation.opSeq > nextLastSeenOpSeq,
    );

    if (nextLastSeenOpSeq > lastSeenOpSeqRef.current) {
      setLastSeenOpSeq(nextLastSeenOpSeq);
    }

    if (liveOperationBufferRef.current.length) {
      runCatchUpRef.current(lastSeenOpSeqRef.current);
    }
  }, [applyContiguousOperations, setLastSeenOpSeq]);

  const runCatchUp = useCallback(
    (afterSeq: number) => {
      const catchUpOperations = catchUpOperationsRef.current;
      const normalizedAfterSeq = Math.max(0, Math.trunc(afterSeq));

      if (!catchUpOperations) {
        return;
      }

      activeCatchUpAbortRef.current?.abort();

      const abortController = new AbortController();
      activeCatchUpAbortRef.current = abortController;
      setOperationSync((currentState) => ({
        ...currentState,
        pendingAfterSeq: normalizedAfterSeq,
        status: "catching_up",
        lastError: null,
      }));

      void catchUpOperations(normalizedAfterSeq, abortController.signal)
        .then((result) => {
          if (abortController.signal.aborted) {
            return;
          }

          const nextLastSeenOpSeq = applyContiguousOperations(
            result.operations,
            normalizedAfterSeq,
          );

          lastSeenOpSeqRef.current = nextLastSeenOpSeq;
          setOperationSync({
            lastSeenOpSeq: nextLastSeenOpSeq,
            latestOpSeq: Math.max(result.latestOpSeq, nextLastSeenOpSeq),
            pendingAfterSeq: null,
            status: "caught_up",
            lastError: null,
          });

          flushBufferedOperations();
        })
        .catch((error: unknown) => {
          if (abortController.signal.aborted) {
            return;
          }

          const message =
            error instanceof Error
              ? error.message
              : "Canvas operation catch-up failed.";

          console.warn("Canvas operation catch-up failed.", error);
          setOperationSync((currentState) => ({
            ...currentState,
            pendingAfterSeq: null,
            status: "failed",
            lastError: message,
          }));
        })
        .finally(() => {
          if (activeCatchUpAbortRef.current === abortController) {
            activeCatchUpAbortRef.current = null;
          }
        });
    },
    [applyContiguousOperations, flushBufferedOperations],
  );

  useEffect(() => {
    runCatchUpRef.current = runCatchUp;
  }, [runCatchUp]);

  const reconcileOperationSeq = useCallback(
    (operation: CanvasShapeOperationPayload) => {
      const lastSeenOpSeq = lastSeenOpSeqRef.current;

      if (operation.opSeq <= lastSeenOpSeq) {
        return;
      }

      setOperationSync((currentState) => ({
        ...currentState,
        latestOpSeq: Math.max(currentState.latestOpSeq, operation.opSeq),
      }));

      if (activeCatchUpAbortRef.current) {
        liveOperationBufferRef.current = [
          ...liveOperationBufferRef.current,
          operation,
        ];
        return;
      }

      if (operation.opSeq === lastSeenOpSeq + 1) {
        applyOperationsRef.current?.([operation]);
        setLastSeenOpSeq(operation.opSeq);
        flushBufferedOperations();
        return;
      }

      liveOperationBufferRef.current = [
        ...liveOperationBufferRef.current,
        operation,
      ];
      runCatchUp(lastSeenOpSeq);
    },
    [flushBufferedOperations, runCatchUp, setLastSeenOpSeq],
  );

  const reconcileJoinState = useCallback(
    (payload: CanvasJoinedPayload) => {
      setOperationSync((currentState) => ({
        ...currentState,
        latestOpSeq: Math.max(currentState.latestOpSeq, payload.latestOpSeq),
        lastError: null,
      }));

      if (
        payload.syncRequired ||
        payload.latestOpSeq > lastSeenOpSeqRef.current
      ) {
        runCatchUp(lastSeenOpSeqRef.current);
      }
    },
    [runCatchUp],
  );

  const reconcileSyncRequired = useCallback(
    (payload: CanvasSyncRequiredPayload) => {
      setOperationSync((currentState) => ({
        ...currentState,
        latestOpSeq: Math.max(currentState.latestOpSeq, payload.latestOpSeq),
        lastError: null,
      }));

      if (payload.latestOpSeq > lastSeenOpSeqRef.current) {
        runCatchUp(lastSeenOpSeqRef.current);
      }
    },
    [runCatchUp],
  );

  useEffect(() => {
    if (config?.enabled && !getCanvasRealtimeServerUrl()) {
      console.warn(
        "Canvas realtime presence is disabled because NEXT_PUBLIC_PILO_REALTIME_SERVER_URL is not configured.",
      );
    }
  }, [config?.enabled]);

  useEffect(() => {
    if (!usableConfig) {
      joinedRef.current = false;
      setRoomStateActive(false);
      socketRef.current = null;
      roomRef.current = { workspaceId: "", canvasId: "" };
      lastSeenOpSeqRef.current = 0;
      activeCatchUpAbortRef.current?.abort();
      activeCatchUpAbortRef.current = null;
      liveOperationBufferRef.current = [];
      setRemotePresence([]);
      setRemoteShapeLocks([]);
      setRemoteShapePreviews([]);
      setRoomLoadedRegions([]);
      setRoomHistory(initialRoomHistoryState);
      setCheckpointStatus(null);
      setLastRejectedShapeLock(null);
      setOperationSync(initialOperationSyncState);
      return;
    }

    const socket = createCanvasRealtimeSocket({
      authToken: usableConfig.authToken,
      currentUser: usableConfig.currentUser,
    });

    if (!socket) {
      joinedRef.current = false;
      setRoomStateActive(false);
      setRemotePresence([]);
      setRemoteShapeLocks([]);
      setRemoteShapePreviews([]);
      setRoomLoadedRegions([]);
      setRoomHistory(initialRoomHistoryState);
      setCheckpointStatus(null);
      setLastRejectedShapeLock(null);
      return;
    }

    const realtimeSocket = socket;
    const room = {
      workspaceId: usableConfig.workspaceId,
      canvasId: usableConfig.canvasId,
    };
    const currentUserId = usableConfig.currentUser.userId;
    const isNewRoom =
      roomRef.current.workspaceId !== room.workspaceId ||
      roomRef.current.canvasId !== room.canvasId;

    if (isNewRoom) {
      lastSeenOpSeqRef.current = 0;
      activeCatchUpAbortRef.current?.abort();
      activeCatchUpAbortRef.current = null;
      liveOperationBufferRef.current = [];
      setLastRejectedShapeLock(null);
      setOperationSync(initialOperationSyncState);
    }

    socketRef.current = realtimeSocket;
    roomRef.current = room;
    joinedRef.current = false;
    setRoomStateActive(false);

    function joinCanvasRoom() {
      joinedRef.current = false;
      setRoomStateActive(false);
      realtimeSocket.emit("canvas:join", {
        ...room,
        lastSeenOpSeq: lastSeenOpSeqRef.current,
      });
    }

    realtimeSocket.on("connect", joinCanvasRoom);
    realtimeSocket.on("connect_error", (error) => {
      console.warn("Canvas realtime socket connection failed.", error.message);
    });
    realtimeSocket.on("disconnect", () => {
      joinedRef.current = false;
      setRoomStateActive(false);
      setRemotePresence([]);
      setRemoteShapeLocks([]);
      setOwnedShapeLocks([]);
      setRemoteShapePreviews([]);
      setRoomLoadedRegions([]);
      setRoomHistory(initialRoomHistoryState);
      setCheckpointStatus(null);
      setLastRejectedShapeLock(null);
    });
    realtimeSocket.on("canvas:joined", (payload) => {
      if (
        payload.workspaceId !== room.workspaceId ||
        payload.canvasId !== room.canvasId
      ) {
        return;
      }

      joinedRef.current = true;
      setRoomStateActive(true);
      reconcileJoinState(payload);
      setRemotePresence(
        filterOwnPresence(
          normalizeRemotePresenceList(payload.presence),
          currentUserId,
        ),
      );
      const joinedShapeLocks = upsertShapeLocks([], payload.shapeLocks);

      setRemoteShapeLocks(joinedShapeLocks);
      setOwnedShapeLocks(
        currentUserId === null
          ? []
          : joinedShapeLocks.filter(
              (lock) => lock.ownerUserId === currentUserId,
            ),
      );
      setRemoteShapePreviews(
        payload.previews.filter(
          (preview) => preview.actorUserId !== currentUserId,
        ),
      );
      setRoomHistory({
        canRedo: payload.canRedo,
        canUndo: payload.canUndo,
        historySeq: payload.historySeq,
      });
      setRoomLoadedRegions(payload.loadedRegions);
      if (payload.roomShapes.length) {
        hydrateShapesRef.current?.(payload.roomShapes);
      }
    });
    realtimeSocket.on("canvas:operation", (payload) => {
      if (
        payload.workspaceId !== room.workspaceId ||
        payload.canvasId !== room.canvasId
      ) {
        return;
      }

      reconcileOperationSeq(payload);
      setRemoteShapePreviews((currentPreviews) =>
        removeShapePreviewIds({
          actorUserId: payload.actorUserId,
          previews: currentPreviews,
          shapeIds: [payload.shapeId],
        }),
      );
    });
    realtimeSocket.on("canvas:sync:required", (payload) => {
      if (
        payload.workspaceId !== room.workspaceId ||
        payload.canvasId !== room.canvasId
      ) {
        return;
      }

      reconcileSyncRequired(payload);
    });
    realtimeSocket.on("canvas:presence:update", (payload) => {
      const presence = normalizeRemotePresence(payload);

      if (!presence) {
        return;
      }

      if (
        presence.workspaceId !== room.workspaceId ||
        presence.canvasId !== room.canvasId ||
        presence.userId === currentUserId
      ) {
        return;
      }

      setRemotePresence((currentPresence) =>
        upsertPresence(currentPresence, presence),
      );
    });
    realtimeSocket.on("canvas:presence:leave", (payload) => {
      if (!isSameCanvasRoom(payload, room)) {
        return;
      }

      setRemotePresence((currentPresence) =>
        currentPresence.filter((entry) => entry.userId !== payload.userId),
      );
    });
    realtimeSocket.on("canvas:shape:lock:accepted", (payload) => {
      if (!isSameCanvasRoom(payload, room)) {
        return;
      }

      setRemoteShapeLocks((currentLocks) =>
        upsertShapeLocks(currentLocks, payload.locks),
      );
      setOwnedShapeLocks((currentLocks) =>
        upsertShapeLocks(currentLocks, payload.locks),
      );
    });
    realtimeSocket.on("canvas:shape:lock:rejected", (payload) => {
      if (!isSameCanvasRoom(payload, room)) {
        return;
      }

      setRemoteShapeLocks((currentLocks) =>
        upsertShapeLocks(currentLocks, payload.locks),
      );
      setLastRejectedShapeLock({
        rejectedAt: Date.now(),
        shapeIds: payload.shapeIds,
      });
      setOwnedShapeLocks((currentLocks) =>
        currentUserId === null
          ? []
          : removeShapeLocks({
              locks: currentLocks,
              ownerUserId: currentUserId,
              shapeIds: payload.shapeIds,
            }),
      );
    });
    realtimeSocket.on("canvas:shape:lock:update", (payload) => {
      if (!isSameCanvasRoom(payload, room)) {
        return;
      }

      setRemoteShapeLocks((currentLocks) =>
        upsertShapeLocks(currentLocks, payload.locks),
      );
    });
    realtimeSocket.on("canvas:shape:lock:release", (payload) => {
      if (!isSameCanvasRoom(payload, room)) {
        return;
      }

      setRemoteShapeLocks((currentLocks) =>
        removeShapeLocks({
          locks: currentLocks,
          ownerUserId: payload.ownerUserId,
          shapeIds: payload.shapeIds,
        }),
      );
      setOwnedShapeLocks((currentLocks) =>
        removeShapeLocks({
          locks: currentLocks,
          ownerUserId: payload.ownerUserId,
          shapeIds: payload.shapeIds,
        }),
      );
    });
    realtimeSocket.on("canvas:shape:preview", (payload) => {
      if (
        !isSameCanvasRoom(payload, room) ||
        payload.actorUserId === currentUserId
      ) {
        return;
      }

      setRemoteShapePreviews((currentPreviews) =>
        upsertShapePreview(currentPreviews, payload),
      );
    });
    realtimeSocket.on("canvas:shape:preview:clear", (payload) => {
      if (!isSameCanvasRoom(payload, room)) {
        return;
      }

      setRemoteShapePreviews((currentPreviews) =>
        currentPreviews.filter(
          (preview) => preview.actorUserId !== payload.actorUserId,
        ),
      );
    });
    realtimeSocket.on("canvas:room:loaded-regions:update", (payload) => {
      if (!isSameCanvasRoom(payload, room)) {
        return;
      }

      setRoomLoadedRegions(payload.loadedRegions);
    });
    realtimeSocket.on("canvas:room:shapes:hydrate", (payload) => {
      if (!isSameCanvasRoom(payload, room)) {
        return;
      }

      setRoomLoadedRegions(payload.loadedRegions);
      if (payload.shapes.length) {
        hydrateShapesRef.current?.(payload.shapes);
      }
    });
    realtimeSocket.on("canvas:room:shape:patch", (payload) => {
      if (!isSameCanvasRoom(payload, room)) {
        return;
      }

      if (typeof payload.historySeq === "number") {
        setRoomHistory((currentHistory) => ({
          canRedo: payload.canRedo ?? currentHistory.canRedo,
          canUndo: payload.canUndo ?? currentHistory.canUndo,
          historySeq: payload.historySeq ?? currentHistory.historySeq,
        }));
      } else if (payload.actorUserId === currentUserId) {
        return;
      }

      applyRoomShapePatchRef.current?.(payload);
    });
    realtimeSocket.on("canvas:room:checkpoint", (payload) => {
      if (!isSameCanvasRoom(payload, room)) {
        return;
      }

      setCheckpointStatus(payload);
    });
    realtimeSocket.on("canvas:error", (payload) => {
      console.warn("Canvas realtime socket error.", payload);
    });

    realtimeSocket.connect();

    return () => {
      joinedRef.current = false;
      setRoomStateActive(false);
      if (realtimeSocket.connected) {
        realtimeSocket.emit("canvas:leave", room);
      }
      realtimeSocket.removeAllListeners();
      realtimeSocket.disconnect();
      activeCatchUpAbortRef.current?.abort();
      activeCatchUpAbortRef.current = null;
      liveOperationBufferRef.current = [];
      if (socketRef.current === realtimeSocket) {
        socketRef.current = null;
      }
      setRemotePresence([]);
      setRemoteShapeLocks([]);
      setOwnedShapeLocks([]);
      setRemoteShapePreviews([]);
      setRoomLoadedRegions([]);
      setRoomHistory(initialRoomHistoryState);
      setCheckpointStatus(null);
      setLastRejectedShapeLock(null);
    };
  }, [
    reconcileJoinState,
    reconcileOperationSeq,
    reconcileSyncRequired,
    usableConfig,
  ]);

  useEffect(() => {
    const staleTimer = window.setInterval(() => {
      const staleBefore = Date.now() - STALE_PRESENCE_TIMEOUT_MS;

      setRemotePresence((currentPresence) =>
        currentPresence.filter(
          (entry) => parsePresenceTimestamp(entry.updatedAt) >= staleBefore,
        ),
      );
      setRemoteShapeLocks((currentLocks) =>
        currentLocks.filter(isShapeLockFresh),
      );
      setOwnedShapeLocks((currentLocks) =>
        currentLocks.filter(isShapeLockFresh),
      );
      setRemoteShapePreviews((currentPreviews) =>
        currentPreviews.filter(
          (preview) =>
            parsePresenceTimestamp(preview.sentAt) >=
            Date.now() - STALE_SHAPE_PREVIEW_TIMEOUT_MS,
        ),
      );
    }, STALE_PRESENCE_SWEEP_MS);

    return () => window.clearInterval(staleTimer);
  }, []);

  const sendPresenceUpdate = useCallback(
    (
      cursor: CanvasPresencePoint | null,
      selectedShapeIds: string[],
      viewport: CanvasPresenceViewport,
      editingShapeId: string | null = null,
      editingMode: CanvasPresenceEditingMode | null = null,
    ) => {
      const socket = socketRef.current;
      const room = roomRef.current;

      if (!socket?.connected || !joinedRef.current) {
        return;
      }

      socket.emit("canvas:presence:update", {
        ...room,
        cursor,
        editingMode,
        editingShapeId,
        selectedShapeIds,
        sentAt: new Date().toISOString(),
        viewport,
      });
    },
    [],
  );

  const claimShapeLocks = useCallback((shapeIds: string[]) => {
    const socket = socketRef.current;
    const room = roomRef.current;
    const uniqueShapeIds = Array.from(
      new Set(shapeIds.map((shapeId) => shapeId.trim()).filter(Boolean)),
    );

    if (!socket?.connected || !joinedRef.current || !uniqueShapeIds.length) {
      return;
    }

    socket.emit("canvas:shape:lock:claim", {
      ...room,
      shapeIds: uniqueShapeIds,
    });
  }, []);

  const releaseShapeLocks = useCallback((shapeIds?: string[]) => {
    const socket = socketRef.current;
    const room = roomRef.current;
    const uniqueShapeIds = shapeIds
      ? Array.from(
          new Set(shapeIds.map((shapeId) => shapeId.trim()).filter(Boolean)),
        )
      : undefined;

    if (!socket?.connected || !joinedRef.current) {
      return;
    }

    socket.emit("canvas:shape:lock:release", {
      ...room,
      ...(uniqueShapeIds?.length ? { shapeIds: uniqueShapeIds } : {}),
    });
  }, []);

  const reportLoadedViewport = useCallback(
    (bounds: CanvasLoadedViewportBounds, shapes: Record<string, unknown>[] = []) => {
      const socket = socketRef.current;
      const room = roomRef.current;

      if (!socket?.connected || !joinedRef.current) {
        return;
      }

      socket.emit("canvas:viewport:loaded", {
        ...room,
        bounds,
        shapes,
      });
    },
    [],
  );

  const clearShapePreview = useCallback((shapeIds: string[]) => {
    const socket = socketRef.current;
    const room = roomRef.current;
    const uniqueShapeIds = Array.from(
      new Set(shapeIds.map((shapeId) => shapeId.trim()).filter(Boolean)),
    );

    if (!socket?.connected || !joinedRef.current || !uniqueShapeIds.length) {
      return;
    }

    socket.emit("canvas:shape:preview:clear", {
      ...room,
      shapeIds: uniqueShapeIds,
    });
  }, []);

  const sendRoomShapePatch = useCallback(
    (patch: Omit<CanvasRoomShapePatchPayload, "workspaceId" | "canvasId">) => {
      const socket = socketRef.current;
      const room = roomRef.current;

      if (
        !socket?.connected ||
        !joinedRef.current ||
        (!patch.upsertShapes.length && !patch.deletedShapeIds.length)
      ) {
        return false;
      }

      socket.emit("canvas:room:shape:patch", {
        ...room,
        deletedShapeIds: patch.deletedShapeIds,
        upsertShapes: patch.upsertShapes,
      });

      return true;
    },
    [],
  );

  const undoRoomHistory = useCallback(() => {
    const socket = socketRef.current;
    const room = roomRef.current;

    if (!socket?.connected || !joinedRef.current) {
      return false;
    }

    socket.emit("canvas:room:history:undo", room);
    return true;
  }, []);

  const redoRoomHistory = useCallback(() => {
    const socket = socketRef.current;
    const room = roomRef.current;

    if (!socket?.connected || !joinedRef.current) {
      return false;
    }

    socket.emit("canvas:room:history:redo", room);
    return true;
  }, []);

  const sendShapePreview = useCallback(
    (
      shapes: Record<string, unknown>[],
      phase: CanvasShapePreviewPhase = "unknown",
      deletedShapeIds: string[] = [],
    ) => {
      const socket = socketRef.current;
      const room = roomRef.current;
      const uniqueDeletedShapeIds = Array.from(
        new Set(deletedShapeIds.map((shapeId) => shapeId.trim()).filter(Boolean)),
      );

      if (
        !socket?.connected ||
        !joinedRef.current ||
        (!shapes.length && !uniqueDeletedShapeIds.length)
      ) {
        return;
      }

      socket.emit("canvas:shape:preview", {
        ...room,
        ...(uniqueDeletedShapeIds.length
          ? { deletedShapeIds: uniqueDeletedShapeIds }
          : {}),
        phase,
        shapes,
      });
    },
    [],
  );

  return useMemo(
    () => ({
      claimShapeLocks,
      clearShapePreview,
      checkpointStatus,
      enabled,
      roomStateActive,
      currentUserId,
      lastRejectedShapeLock,
      operationSync,
      ownedShapeLocks:
        currentUserId === null
          ? []
          : ownedShapeLocks.filter(
              (lock) => lock.ownerUserId === currentUserId,
            ),
      releaseShapeLocks,
      redoRoomHistory,
      reportLoadedViewport,
      roomHistory,
      roomLoadedRegions,
      sendRoomShapePatch,
      remotePresence:
        currentUserId === null
          ? remotePresence
          : filterOwnPresence(remotePresence, currentUserId),
      remoteShapeLocks:
        currentUserId === null
          ? remoteShapeLocks
          : remoteShapeLocks.filter(
              (lock) => lock.ownerUserId !== currentUserId,
            ),
      remoteShapePreviews,
      sendPresenceUpdate,
      sendShapePreview,
      undoRoomHistory,
    }),
    [
      claimShapeLocks,
      clearShapePreview,
      checkpointStatus,
      currentUserId,
      enabled,
      roomStateActive,
      lastRejectedShapeLock,
      operationSync,
      ownedShapeLocks,
      releaseShapeLocks,
      redoRoomHistory,
      reportLoadedViewport,
      roomHistory,
      roomLoadedRegions,
      sendRoomShapePatch,
      remotePresence,
      remoteShapeLocks,
      remoteShapePreviews,
      sendPresenceUpdate,
      sendShapePreview,
      undoRoomHistory,
    ],
  );
}
