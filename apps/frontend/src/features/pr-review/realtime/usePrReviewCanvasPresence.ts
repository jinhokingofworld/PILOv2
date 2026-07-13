"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createCanvasRealtimeSocket,
  getCanvasRealtimeServerUrl,
  type CanvasRealtimeSocket,
} from "@/shared/canvas-realtime/canvas-realtime-client";
import type {
  CanvasPresenceEditingMode,
  CanvasPresencePoint,
  CanvasPresenceViewport,
  CanvasRealtimeConfig,
  CanvasRemotePresenceState,
} from "@/shared/canvas-realtime/canvas-realtime-types";

const STALE_PRESENCE_TIMEOUT_MS = 15_000;
const STALE_PRESENCE_SWEEP_MS = 2_000;

export type PrReviewCanvasPresenceController = {
  currentUserId: string | null;
  enabled: boolean;
  joined: boolean;
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
): PrReviewCanvasPresenceController {
  const [joined, setJoined] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [remotePresence, setRemotePresence] = useState<
    CanvasRemotePresenceState[]
  >([]);
  const socketRef = useRef<CanvasRealtimeSocket | null>(null);
  const joinedRef = useRef(false);
  const roomRef = useRef({ workspaceId: "", canvasId: "" });
  const currentUserId = config?.currentUser?.userId ?? null;
  const usableConfig = isUsableRealtimeConfig(config) ? config : null;
  const enabled = Boolean(usableConfig && getCanvasRealtimeServerUrl());

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
      setJoined(false);
      setReadOnly(false);
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
      setRemotePresence([]);
      return;
    }

    const realtimeSocket = socket;
    const room = {
      workspaceId: usableConfig.workspaceId,
      canvasId: usableConfig.canvasId,
    };
    const ownUserId = usableConfig.currentUser.userId;

    socketRef.current = realtimeSocket;
    roomRef.current = room;
    joinedRef.current = false;

    function joinCanvasRoom() {
      joinedRef.current = false;
      setJoined(false);
      realtimeSocket.emit("canvas:join", room);
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
      setRemotePresence(
        payload.presence.filter((entry) => entry.userId !== ownUserId),
      );
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
      if (realtimeSocket.connected) {
        realtimeSocket.emit("canvas:leave", room);
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
  }, [usableConfig]);

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
      readOnly,
      remotePresence,
      sendPresenceUpdate,
    }),
    [
      currentUserId,
      enabled,
      joined,
      readOnly,
      remotePresence,
      sendPresenceUpdate,
    ],
  );
}
