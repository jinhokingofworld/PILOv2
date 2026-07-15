"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from "react";
import type { Socket } from "socket.io-client";

import { useAuthSession } from "@/features/auth";
import { useRealtimeSocket } from "@/shared/realtime/realtime-provider";
import {
  PAGE_CURSOR_TARGET_ID_ATTR,
  PAGE_CURSOR_TARGET_LABEL_ATTR,
  PAGE_CURSOR_TARGET_TYPE_ATTR
} from "./page-cursor-target";
import type {
  PageCursorJoinedPayload,
  PageCursorLeavePayload,
  PageCursorPayload,
  PageCursorPresence,
  PageCursorRoom,
  PageCursorTarget
} from "./page-cursor-types";

type UsePageCursorRoomOptions = PageCursorRoom & {
  enabled?: boolean;
};

type UsePageCursorRoomResult = {
  containerRef: RefObject<HTMLDivElement | null>;
  currentUserId: string | null;
  cursors: PageCursorPresence[];
  layoutVersion: number;
};

const CURSOR_SEND_THROTTLE_MS = 50;
const STALE_CURSOR_MS = 12_000;

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function readPointRatio(event: PointerEvent, rect: DOMRect) {
  return {
    xRatio: clampRatio((event.clientX - rect.left) / Math.max(1, rect.width)),
    yRatio: clampRatio((event.clientY - rect.top) / Math.max(1, rect.height))
  };
}

function readTargetFromPointerEvent(
  event: PointerEvent,
  container: HTMLElement
): {
  target: PageCursorTarget | null;
  targetPoint: PageCursorPayload["targetPoint"];
} {
  const eventTarget = event.target;

  if (!(eventTarget instanceof Element)) {
    return { target: null, targetPoint: null };
  }

  const targetElement = eventTarget.closest<HTMLElement>(
    `[${PAGE_CURSOR_TARGET_TYPE_ATTR}][${PAGE_CURSOR_TARGET_ID_ATTR}]`
  );

  if (!targetElement || !container.contains(targetElement)) {
    return { target: null, targetPoint: null };
  }

  const type = targetElement.getAttribute(PAGE_CURSOR_TARGET_TYPE_ATTR)?.trim();
  const id = targetElement.getAttribute(PAGE_CURSOR_TARGET_ID_ATTR)?.trim();

  if (!type || !id) {
    return { target: null, targetPoint: null };
  }

  const targetRect = targetElement.getBoundingClientRect();
  const label = targetElement.getAttribute(PAGE_CURSOR_TARGET_LABEL_ATTR);

  return {
    target: {
      id,
      ...(label ? { label } : {}),
      type
    },
    targetPoint: readPointRatio(event, targetRect)
  };
}

function sameRoom(a: PageCursorRoom, b: PageCursorRoom) {
  return (
    a.workspaceId === b.workspaceId &&
    a.page === b.page &&
    (a.boardId ?? null) === (b.boardId ?? null)
  );
}

function buildRoomPayload(room: PageCursorRoom) {
  return {
    ...(room.boardId ? { boardId: room.boardId } : {}),
    page: room.page,
    workspaceId: room.workspaceId
  };
}

function upsertCursor(
  cursors: PageCursorPresence[],
  cursor: PageCursorPresence,
) {
  return [
    cursor,
    ...cursors.filter((entry) => entry.userId !== cursor.userId),
  ];
}

function removeCursor(cursors: PageCursorPresence[], userId: string) {
  return cursors.filter((entry) => entry.userId !== userId);
}

function pruneStaleCursors(cursors: PageCursorPresence[]) {
  const now = Date.now();

  return cursors.filter((entry) => {
    const updatedAt = Date.parse(entry.updatedAt);

    return Number.isFinite(updatedAt) && now - updatedAt <= STALE_CURSOR_MS;
  });
}

export function usePageCursorRoom({
  boardId,
  enabled = true,
  page,
  workspaceId
}: UsePageCursorRoomOptions): UsePageCursorRoomResult {
  const socket = useRealtimeSocket();
  const authSession = useAuthSession();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastSentAtRef = useRef(0);
  const room = useMemo<PageCursorRoom>(
    () => ({
      ...(boardId ? { boardId } : {}),
      page,
      workspaceId: workspaceId.trim().toLowerCase()
    }),
    [boardId, page, workspaceId]
  );
  const [cursors, setCursors] = useState<PageCursorPresence[]>([]);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const currentUserId = authSession?.user.id ?? null;
  const canJoinRoom = Boolean(enabled && socket && room.workspaceId);

  const emitCursorUpdate = useCallback(
    (event: PointerEvent) => {
      if (!socket || !canJoinRoom) return;

      const container = containerRef.current;
      if (!container) return;

      const now = Date.now();
      if (now - lastSentAtRef.current < CURSOR_SEND_THROTTLE_MS) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      if (containerRect.width <= 0 || containerRect.height <= 0) {
        return;
      }

      lastSentAtRef.current = now;
      const target = readTargetFromPointerEvent(event, container);

      socket.emit("page-cursor:update", {
        ...buildRoomPayload(room),
        fallback: readPointRatio(event, containerRect),
        sentAt: new Date().toISOString(),
        target: target.target,
        targetPoint: target.targetPoint
      } satisfies PageCursorPayload);
    },
    [canJoinRoom, room, socket]
  );

  useEffect(() => {
    if (!socket || !canJoinRoom) {
      setCursors([]);
      return;
    }

    const roomPayload = buildRoomPayload(room);

    function handleJoined(payload: PageCursorJoinedPayload) {
      if (!sameRoom(payload, room)) return;

      setCursors(
        pruneStaleCursors(
          payload.presence.filter((entry) => entry.userId !== currentUserId)
        )
      );
    }

    function handleUpdate(payload: PageCursorPresence) {
      if (!sameRoom(payload, room) || payload.userId === currentUserId) return;

      setCursors((currentCursors) =>
        pruneStaleCursors(upsertCursor(currentCursors, payload))
      );
    }

    function handleLeave(payload: PageCursorLeavePayload) {
      if (!sameRoom(payload, room)) return;

      setCursors((currentCursors) =>
        removeCursor(currentCursors, payload.userId)
      );
    }

    socket.on("page-cursor:joined", handleJoined);
    socket.on("page-cursor:update", handleUpdate);
    socket.on("page-cursor:leave", handleLeave);
    socket.emit("page-cursor:join", roomPayload);

    return () => {
      socket.emit("page-cursor:leave", roomPayload);
      socket.off("page-cursor:joined", handleJoined);
      socket.off("page-cursor:update", handleUpdate);
      socket.off("page-cursor:leave", handleLeave);
      setCursors([]);
    };
  }, [canJoinRoom, currentUserId, room, socket]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !canJoinRoom) return;

    container.addEventListener("pointermove", emitCursorUpdate, {
      passive: true
    });

    return () => {
      container.removeEventListener("pointermove", emitCursorUpdate);
    };
  }, [canJoinRoom, emitCursorUpdate]);

  useEffect(() => {
    const pruneInterval = window.setInterval(() => {
      setCursors((currentCursors) => pruneStaleCursors(currentCursors));
    }, 2_000);

    return () => window.clearInterval(pruneInterval);
  }, []);

  useEffect(() => {
    const bumpLayoutVersion = () => setLayoutVersion((version) => version + 1);

    window.addEventListener("resize", bumpLayoutVersion);
    window.addEventListener("scroll", bumpLayoutVersion, true);

    return () => {
      window.removeEventListener("resize", bumpLayoutVersion);
      window.removeEventListener("scroll", bumpLayoutVersion, true);
    };
  }, []);

  return {
    containerRef,
    currentUserId,
    cursors,
    layoutVersion
  };
}
