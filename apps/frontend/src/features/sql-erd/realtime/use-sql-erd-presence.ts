"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createSqlErdRealtimeSocket,
  getSqlErdRealtimeServerUrl,
  type SqlErdRealtimeSocket,
} from "./sql-erd-realtime-client";
import type {
  SqlErdPresenceEditingMode,
  SqlErdPresencePoint,
  SqlErdPresenceSelectedObject,
  SqlErdPresenceTool,
  SqlErdRealtimeConfig,
  SqlErdRemotePresenceState,
} from "./sql-erd-realtime-types";

const STALE_PRESENCE_TIMEOUT_MS = 15_000;
const STALE_PRESENCE_SWEEP_MS = 2_000;
const PRESENCE_HEARTBEAT_MS = 5_000;
const PRESENCE_UPDATE_MIN_INTERVAL_MS = 80;

type LocalPresencePatch = Partial<
  Pick<
    SqlErdRemotePresenceState,
    "cursor" | "editingMode" | "selectedObjects" | "tool"
  >
>;

export type SqlErdPresenceController = {
  currentUserId: string | null;
  enabled: boolean;
  remotePresence: SqlErdRemotePresenceState[];
  updatePresence: (patch: LocalPresencePatch) => void;
};

function isUsableRealtimeConfig(
  config: SqlErdRealtimeConfig | null | undefined,
): config is SqlErdRealtimeConfig & {
  authToken: string;
  currentUser: NonNullable<SqlErdRealtimeConfig["currentUser"]>;
} {
  return Boolean(
    config?.enabled &&
      config.workspaceId.trim() &&
      config.sessionId.trim() &&
      config.authToken?.trim() &&
      config.currentUser?.userId.trim(),
  );
}

function isSameRoom(
  payload: { sessionId: string; workspaceId: string },
  room: { sessionId: string; workspaceId: string },
) {
  return (
    payload.workspaceId === room.workspaceId && payload.sessionId === room.sessionId
  );
}

function isFreshPresence(presence: SqlErdRemotePresenceState) {
  return Date.parse(presence.updatedAt) >= Date.now() - STALE_PRESENCE_TIMEOUT_MS;
}

function hasCursorMovedEnough(
  previousCursor: SqlErdPresencePoint | null,
  nextCursor: SqlErdPresencePoint | null,
) {
  if (!nextCursor) return previousCursor !== null;
  if (!previousCursor) return true;

  return (
    Math.hypot(
      nextCursor.x - previousCursor.x,
      nextCursor.y - previousCursor.y,
    ) >= 1.5
  );
}

function upsertPresence(
  currentPresence: SqlErdRemotePresenceState[],
  nextPresence: SqlErdRemotePresenceState,
) {
  return [
    ...currentPresence.filter((entry) => entry.userId !== nextPresence.userId),
    nextPresence,
  ].sort((left, right) =>
    (left.displayName ?? "PILO").localeCompare(right.displayName ?? "PILO"),
  );
}

export function useSqlErdPresence(
  config: SqlErdRealtimeConfig | null | undefined,
): SqlErdPresenceController {
  const [remotePresence, setRemotePresence] = useState<SqlErdRemotePresenceState[]>([]);
  const socketRef = useRef<SqlErdRealtimeSocket | null>(null);
  const joinedRef = useRef(false);
  const roomRef = useRef({ sessionId: "", workspaceId: "" });
  const lastPresenceSentAtRef = useRef(0);
  const pendingPresenceUpdateRef = useRef<number | null>(null);
  const localPresenceRef = useRef<LocalPresencePatch>({
    cursor: null,
    editingMode: null,
    selectedObjects: [],
    tool: "select",
  });
  const lastSentPresenceRef = useRef({
    cursor: null as SqlErdPresencePoint | null,
    editingMode: null as SqlErdPresenceEditingMode,
    selectedObjects: [] as SqlErdPresenceSelectedObject[],
    tool: "select" as SqlErdPresenceTool,
  });
  const usableConfig = useMemo(
    () => (isUsableRealtimeConfig(config) ? config : null),
    [
      config?.authToken,
      config?.currentUser?.displayName,
      config?.currentUser?.userId,
      config?.enabled,
      config?.sessionId,
      config?.workspaceId,
    ],
  );
  const currentUserId = usableConfig?.currentUser.userId ?? null;
  const enabled = Boolean(usableConfig && getSqlErdRealtimeServerUrl());

  const emitCurrentPresence = useCallback(() => {
    const socket = socketRef.current;
    const room = roomRef.current;
    const localPresence = localPresenceRef.current;

    if (!socket?.connected || !joinedRef.current) return false;

    socket.volatile.emit("sql-erd:presence:update", {
      ...room,
      cursor: localPresence.cursor ?? null,
      editingMode: localPresence.editingMode ?? null,
      selectedObjects: Array.from(
        new Map(
          (localPresence.selectedObjects ?? []).map((selectedObject) => [
            `${selectedObject.type}:${selectedObject.id}`,
            selectedObject,
          ]),
        ).values(),
      ).slice(0, 100),
      tool: localPresence.tool ?? "select",
      sentAt: new Date().toISOString(),
    });
    lastPresenceSentAtRef.current = Date.now();
    lastSentPresenceRef.current = {
      cursor: localPresence.cursor ?? null,
      editingMode: localPresence.editingMode ?? null,
      selectedObjects: localPresence.selectedObjects ?? [],
      tool: localPresence.tool ?? "select",
    };
    return true;
  }, []);

  useEffect(() => {
    if (!usableConfig) {
      joinedRef.current = false;
      if (pendingPresenceUpdateRef.current !== null) {
        window.clearTimeout(pendingPresenceUpdateRef.current);
        pendingPresenceUpdateRef.current = null;
      }
      socketRef.current = null;
      roomRef.current = { sessionId: "", workspaceId: "" };
      setRemotePresence([]);
      return;
    }

    const socket = createSqlErdRealtimeSocket({
      authToken: usableConfig.authToken,
      currentUser: usableConfig.currentUser,
    });

    if (!socket) {
      setRemotePresence([]);
      return;
    }

    const room = {
      sessionId: usableConfig.sessionId,
      workspaceId: usableConfig.workspaceId,
    };
    const userId = usableConfig.currentUser.userId;
    localPresenceRef.current = {
      cursor: null,
      editingMode: null,
      selectedObjects: [],
      tool: "select",
    };
    lastSentPresenceRef.current = {
      cursor: null,
      editingMode: null,
      selectedObjects: [],
      tool: "select",
    };
    lastPresenceSentAtRef.current = 0;
    socketRef.current = socket;
    roomRef.current = room;
    joinedRef.current = false;

    const joinRoom = () => {
      joinedRef.current = false;
      socket.emit("sql-erd:join", room);
    };

    socket.on("connect", joinRoom);
    socket.on("connect_error", (error) => {
      console.warn("SQLtoERD realtime socket connection failed.", error.message);
    });
    socket.on("disconnect", () => {
      joinedRef.current = false;
      setRemotePresence([]);
    });
    socket.on("sql-erd:joined", (payload) => {
      if (!isSameRoom(payload, room)) return;

      joinedRef.current = true;
      setRemotePresence(
        payload.presence.filter((entry) => entry.userId !== userId && isFreshPresence(entry)),
      );
      emitCurrentPresence();
    });
    socket.on("sql-erd:presence:update", (presence) => {
      if (!isSameRoom(presence, room) || presence.userId === userId) return;

      setRemotePresence((currentPresence) => upsertPresence(currentPresence, presence));
    });
    socket.on("sql-erd:presence:leave", (payload) => {
      if (!isSameRoom(payload, room)) return;

      setRemotePresence((currentPresence) =>
        currentPresence.filter((entry) => entry.userId !== payload.userId),
      );
    });
    socket.on("sql-erd:error", (error) => {
      console.warn("SQLtoERD realtime socket error.", error);
    });
    socket.connect();

    return () => {
      joinedRef.current = false;
      if (pendingPresenceUpdateRef.current !== null) {
        window.clearTimeout(pendingPresenceUpdateRef.current);
        pendingPresenceUpdateRef.current = null;
      }
      if (socket.connected) socket.emit("sql-erd:leave", room);
      socket.removeAllListeners();
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
      setRemotePresence([]);
    };
  }, [emitCurrentPresence, usableConfig]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemotePresence((currentPresence) => currentPresence.filter(isFreshPresence));
    }, STALE_PRESENCE_SWEEP_MS);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      emitCurrentPresence();
    }, PRESENCE_HEARTBEAT_MS);

    return () => window.clearInterval(timer);
  }, [emitCurrentPresence]);

  const updatePresence = useCallback((patch: LocalPresencePatch) => {
    const nextPresence = {
      ...localPresenceRef.current,
      ...patch,
    } as {
      cursor: SqlErdRemotePresenceState["cursor"];
      editingMode: SqlErdPresenceEditingMode;
      selectedObjects: SqlErdPresenceSelectedObject[];
      tool: SqlErdPresenceTool;
    };
    localPresenceRef.current = nextPresence;

    const isCursorOnlyUpdate =
      Object.keys(patch).length === 1 && Object.hasOwn(patch, "cursor");

    if (
      isCursorOnlyUpdate &&
      !hasCursorMovedEnough(lastSentPresenceRef.current.cursor, nextPresence.cursor)
    ) {
      return;
    }

    const elapsed = Date.now() - lastPresenceSentAtRef.current;

    if (elapsed >= PRESENCE_UPDATE_MIN_INTERVAL_MS) {
      if (pendingPresenceUpdateRef.current !== null) {
        window.clearTimeout(pendingPresenceUpdateRef.current);
        pendingPresenceUpdateRef.current = null;
      }
      emitCurrentPresence();
      return;
    }

    if (pendingPresenceUpdateRef.current !== null) return;

    pendingPresenceUpdateRef.current = window.setTimeout(() => {
      pendingPresenceUpdateRef.current = null;
      emitCurrentPresence();
    }, PRESENCE_UPDATE_MIN_INTERVAL_MS - elapsed);
  }, [emitCurrentPresence]);

  return useMemo(
    () => ({
      currentUserId,
      enabled,
      remotePresence:
        currentUserId === null
          ? remotePresence
          : remotePresence.filter((entry) => entry.userId !== currentUserId),
      updatePresence,
    }),
    [currentUserId, enabled, remotePresence, updatePresence],
  );
}
