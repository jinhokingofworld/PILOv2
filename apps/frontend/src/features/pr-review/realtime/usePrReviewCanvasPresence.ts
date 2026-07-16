"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createCanvasRealtimeSocket,
  getCanvasRealtimeServerUrl,
  type CanvasRealtimeSocket,
} from "@/shared/canvas-realtime/canvas-realtime-client";
import type {
  CanvasOperationsCatchupPayload,
  CanvasPresenceEditingMode,
  CanvasPresencePoint,
  CanvasPresenceViewport,
  CanvasRealtimeConfig,
  CanvasRemotePresenceState,
  CanvasShapeOperationPayload,
} from "@/shared/canvas-realtime/canvas-realtime-types";
import { reconcilePrReviewCanvasOperations } from "@/features/pr-review/realtime/pr-review-canvas-operation-sync";
import type { PrReviewDecisionUpdatedEvent } from "@/features/pr-review/types";

const STALE_PRESENCE_TIMEOUT_MS = 15_000;
const STALE_PRESENCE_SWEEP_MS = 2_000;

export type PrReviewCanvasPresenceController = {
  currentUserId: string | null;
  enabled: boolean;
  joined: boolean;
  operationSyncError: string | null;
  readOnly: boolean;
  remotePresence: CanvasRemotePresenceState[];
  sendPresenceUpdate: (
    cursor: CanvasPresencePoint | null,
    selectedShapeIds: string[],
    viewport: CanvasPresenceViewport,
    editingShapeId?: string | null,
    editingMode?: CanvasPresenceEditingMode | null,
  ) => void;
};

type PrReviewCanvasPresenceOptions = {
  applyOperations?: (operations: CanvasShapeOperationPayload[]) => void;
  catchUpOperations?: (
    afterSeq: number,
    signal: AbortSignal,
  ) => Promise<CanvasOperationsCatchupPayload>;
  onDecisionUpdated?: (event: PrReviewDecisionUpdatedEvent) => void;
  onRoomJoined?: () => void;
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

function upsertPresence(
  presence: CanvasRemotePresenceState[],
  nextPresence: CanvasRemotePresenceState,
) {
  return [
    ...presence.filter((entry) => entry.userId !== nextPresence.userId),
    nextPresence,
  ];
}

export function usePrReviewCanvasPresence(
  config: CanvasRealtimeConfig | null | undefined,
  options: PrReviewCanvasPresenceOptions = {},
): PrReviewCanvasPresenceController {
  const [joined, setJoined] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [operationSyncError, setOperationSyncError] = useState<string | null>(
    null,
  );
  const [remotePresence, setRemotePresence] = useState<
    CanvasRemotePresenceState[]
  >([]);
  const socketRef = useRef<CanvasRealtimeSocket | null>(null);
  const joinedRef = useRef(false);
  const roomRef = useRef({ workspaceId: "", canvasId: "" });
  const applyOperationsRef = useRef(options.applyOperations);
  const catchUpOperationsRef = useRef(options.catchUpOperations);
  const onDecisionUpdatedRef = useRef(options.onDecisionUpdated);
  const onRoomJoinedRef = useRef(options.onRoomJoined);
  const lastSeenOpSeqRef = useRef(0);
  const bufferedOperationsRef = useRef<CanvasShapeOperationPayload[]>([]);
  const activeCatchUpAbortRef = useRef<AbortController | null>(null);
  const runCatchUpRef = useRef<() => void>(() => {});
  const currentUserId = config?.currentUser?.userId ?? null;
  const usableConfig = isUsableRealtimeConfig(config) ? config : null;
  const enabled = Boolean(usableConfig && getCanvasRealtimeServerUrl());

  useEffect(() => {
    applyOperationsRef.current = options.applyOperations;
    catchUpOperationsRef.current = options.catchUpOperations;
    onDecisionUpdatedRef.current = options.onDecisionUpdated;
    onRoomJoinedRef.current = options.onRoomJoined;
  }, [
    options.applyOperations,
    options.catchUpOperations,
    options.onDecisionUpdated,
    options.onRoomJoined,
  ]);

  const applyBufferedOperations = useCallback(
    (operations: CanvasShapeOperationPayload[] = []) => {
      const reconciliation = reconcilePrReviewCanvasOperations(
        lastSeenOpSeqRef.current,
        [...bufferedOperationsRef.current, ...operations],
      );

      bufferedOperationsRef.current = reconciliation.pendingOperations;
      lastSeenOpSeqRef.current = reconciliation.lastSeenOpSeq;

      if (reconciliation.contiguousOperations.length) {
        applyOperationsRef.current?.(reconciliation.contiguousOperations);
      }

      return reconciliation;
    },
    [],
  );

  const runCatchUp = useCallback(() => {
    const catchUpOperations = catchUpOperationsRef.current;
    if (activeCatchUpAbortRef.current || !catchUpOperations) {
      return;
    }

    const abortController = new AbortController();
    activeCatchUpAbortRef.current = abortController;
    let catchUpSucceeded = false;

    void (async () => {
      let latestOpSeq = lastSeenOpSeqRef.current;

      do {
        const previousLastSeenOpSeq = lastSeenOpSeqRef.current;
        const result = await catchUpOperations(
          previousLastSeenOpSeq,
          abortController.signal,
        );
        if (abortController.signal.aborted) {
          return;
        }

        latestOpSeq = Math.max(latestOpSeq, result.latestOpSeq);
        const reconciliation = applyBufferedOperations(result.operations);
        if (
          reconciliation.lastSeenOpSeq === previousLastSeenOpSeq &&
          latestOpSeq > reconciliation.lastSeenOpSeq
        ) {
          throw new Error("Canvas operation sequence gap could not be recovered");
        }
      } while (lastSeenOpSeqRef.current < latestOpSeq);

      catchUpSucceeded = true;
      setOperationSyncError(null);
    })()
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        console.warn("PR Review Canvas operation catch-up failed.", error);
        setOperationSyncError(
          error instanceof Error
            ? error.message
            : "Canvas operation catch-up failed.",
        );
      })
      .finally(() => {
        if (activeCatchUpAbortRef.current === abortController) {
          activeCatchUpAbortRef.current = null;
        }

        const reconciliation = applyBufferedOperations();
        if (catchUpSucceeded && reconciliation.pendingOperations.length) {
          runCatchUpRef.current();
        }
      });
  }, [applyBufferedOperations]);

  useEffect(() => {
    runCatchUpRef.current = runCatchUp;
  }, [runCatchUp]);

  useEffect(() => {
    if (config?.enabled && !getCanvasRealtimeServerUrl()) {
      console.warn(
        "PR Review Canvas realtime presence is disabled because NEXT_PUBLIC_PILO_REALTIME_SERVER_URL is not configured.",
      );
    }
  }, [config?.enabled]);

  useEffect(() => {
    if (!usableConfig) {
      joinedRef.current = false;
      socketRef.current = null;
      roomRef.current = { workspaceId: "", canvasId: "" };
      lastSeenOpSeqRef.current = 0;
      bufferedOperationsRef.current = [];
      activeCatchUpAbortRef.current?.abort();
      activeCatchUpAbortRef.current = null;
      setJoined(false);
      setReadOnly(false);
      setOperationSyncError(null);
      setRemotePresence([]);
      return;
    }

    const socket = createCanvasRealtimeSocket({
      authToken: usableConfig.authToken,
      currentUser: usableConfig.currentUser,
    });

    if (!socket) {
      joinedRef.current = false;
      setJoined(false);
      setReadOnly(false);
      setOperationSyncError(null);
      setRemotePresence([]);
      return;
    }

    const realtimeSocket = socket;
    const room = {
      workspaceId: usableConfig.workspaceId,
      canvasId: usableConfig.canvasId,
    };
    const ownUserId = usableConfig.currentUser.userId;
    const isNewRoom =
      roomRef.current.workspaceId !== room.workspaceId ||
      roomRef.current.canvasId !== room.canvasId;

    if (isNewRoom) {
      lastSeenOpSeqRef.current = 0;
      bufferedOperationsRef.current = [];
      activeCatchUpAbortRef.current?.abort();
      activeCatchUpAbortRef.current = null;
      setOperationSyncError(null);
    }

    socketRef.current = realtimeSocket;
    roomRef.current = room;
    joinedRef.current = false;

    function joinCanvasRoom() {
      joinedRef.current = false;
      setJoined(false);
      realtimeSocket.emit("canvas:join", {
        ...room,
        lastSeenOpSeq: lastSeenOpSeqRef.current,
      });
    }

    realtimeSocket.on("connect", joinCanvasRoom);
    realtimeSocket.on("connect_error", (error) => {
      console.warn(
        "PR Review Canvas realtime socket connection failed.",
        error.message,
      );
    });
    realtimeSocket.on("disconnect", () => {
      joinedRef.current = false;
      setJoined(false);
      setRemotePresence([]);
    });
    realtimeSocket.on("canvas:joined", (payload) => {
      if (
        payload.workspaceId !== room.workspaceId ||
        payload.canvasId !== room.canvasId
      ) {
        return;
      }

      joinedRef.current = true;
      setJoined(true);
      setReadOnly(payload.readOnly);
      onRoomJoinedRef.current?.();
      setRemotePresence(
        payload.presence.filter((entry) => entry.userId !== ownUserId),
      );
      if (
        payload.syncRequired ||
        payload.latestOpSeq > lastSeenOpSeqRef.current
      ) {
        runCatchUpRef.current();
      }
    });
    realtimeSocket.on("canvas:operation", (operation) => {
      if (
        operation.workspaceId !== room.workspaceId ||
        operation.canvasId !== room.canvasId ||
        operation.opSeq <= lastSeenOpSeqRef.current
      ) {
        return;
      }

      const reconciliation = applyBufferedOperations([operation]);
      if (reconciliation.pendingOperations.length) {
        runCatchUpRef.current();
      }
    });
    realtimeSocket.on("canvas:sync:required", (payload) => {
      if (
        payload.workspaceId !== room.workspaceId ||
        payload.canvasId !== room.canvasId ||
        payload.latestOpSeq <= lastSeenOpSeqRef.current
      ) {
        return;
      }

      runCatchUpRef.current();
    });
    (
      realtimeSocket as unknown as {
        on: (
          event: "pr-review:decision:updated",
          listener: (payload: PrReviewDecisionUpdatedEvent) => void,
        ) => void;
      }
    ).on("pr-review:decision:updated", (payload) => {
      if (
        payload.workspaceId !== room.workspaceId ||
        payload.canvasId !== room.canvasId
      ) {
        return;
      }

      onDecisionUpdatedRef.current?.(payload);
    });
    realtimeSocket.on("canvas:presence:update", (presence) => {
      if (
        presence.workspaceId !== room.workspaceId ||
        presence.canvasId !== room.canvasId ||
        presence.userId === ownUserId
      ) {
        return;
      }

      setRemotePresence((currentPresence) =>
        upsertPresence(currentPresence, presence),
      );
    });
    realtimeSocket.on("canvas:presence:leave", (payload) => {
      if (
        payload.workspaceId !== room.workspaceId ||
        payload.canvasId !== room.canvasId
      ) {
        return;
      }

      setRemotePresence((currentPresence) =>
        currentPresence.filter((entry) => entry.userId !== payload.userId),
      );
    });
    realtimeSocket.on("canvas:error", (payload) => {
      console.warn("PR Review Canvas realtime socket error.", payload);
    });

    realtimeSocket.connect();

    return () => {
      joinedRef.current = false;
      activeCatchUpAbortRef.current?.abort();
      activeCatchUpAbortRef.current = null;
      if (realtimeSocket.connected) {
        realtimeSocket.emit("canvas:leave", {
          ...room,
          lastSeenOpSeq: lastSeenOpSeqRef.current,
        });
      }
      realtimeSocket.removeAllListeners();
      realtimeSocket.disconnect();
      if (socketRef.current === realtimeSocket) {
        socketRef.current = null;
      }
      setJoined(false);
      setReadOnly(false);
      setRemotePresence([]);
    };
  }, [applyBufferedOperations, usableConfig]);

  useEffect(() => {
    const staleTimer = window.setInterval(() => {
      const staleBefore = Date.now() - STALE_PRESENCE_TIMEOUT_MS;

      setRemotePresence((currentPresence) =>
        currentPresence.filter(
          (entry) => parsePresenceTimestamp(entry.updatedAt) >= staleBefore,
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

  return useMemo(
    () => ({
      currentUserId,
      enabled,
      joined,
      operationSyncError,
      readOnly,
      remotePresence,
      sendPresenceUpdate,
    }),
    [
      currentUserId,
      enabled,
      joined,
      operationSyncError,
      readOnly,
      remotePresence,
      sendPresenceUpdate,
    ],
  );
}
