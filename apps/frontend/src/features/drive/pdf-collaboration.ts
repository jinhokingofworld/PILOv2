"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuthSession } from "@/features/auth";
import { useRealtimeSocket } from "@/shared/realtime/realtime-provider";

export type PdfCollaborationPoint = {
  xRatio: number;
  yRatio: number;
};

export type PdfCollaborationTool = "eraser" | "highlighter" | "pen";

export type PdfCollaborationStroke = {
  color: string;
  id: string;
  pageNumber: number;
  points: PdfCollaborationPoint[];
  tool: Exclude<PdfCollaborationTool, "eraser">;
};

export type PdfCollaborationPresence = {
  displayName: string;
  fileId: string;
  pageNumber: number;
  updatedAt: string;
  userId: string;
  workspaceId: string;
};

export type PdfCollaborationPointer = PdfCollaborationPresence & PdfCollaborationPoint;

type PdfCollaborationSnapshot = {
  fileId: string;
  presence: PdfCollaborationPresence[];
  pointers: PdfCollaborationPointer[];
  strokesByPage: Record<number, PdfCollaborationStroke[]>;
  workspaceId: string;
};

type PdfCollaborationRoom = {
  fileId: string;
  workspaceId: string;
};

const POINTER_SEND_THROTTLE_MS = 50;

function sameRoom(a: PdfCollaborationRoom, b: PdfCollaborationRoom) {
  return a.workspaceId === b.workspaceId && a.fileId === b.fileId;
}

function createEmptySnapshot(room: PdfCollaborationRoom): PdfCollaborationSnapshot {
  return { ...room, presence: [], pointers: [], strokesByPage: {} };
}

function upsertByUserId<T extends { userId: string }>(entries: T[], next: T) {
  return [next, ...entries.filter((entry) => entry.userId !== next.userId)];
}

function appendStroke(
  strokesByPage: Record<number, PdfCollaborationStroke[]>,
  stroke: PdfCollaborationStroke,
) {
  return {
    ...strokesByPage,
    [stroke.pageNumber]: [
      ...(strokesByPage[stroke.pageNumber] ?? []).filter((entry) => entry.id !== stroke.id),
      stroke,
    ],
  };
}

function removeStroke(
  strokesByPage: Record<number, PdfCollaborationStroke[]>,
  pageNumber: number,
  strokeId: string,
) {
  return {
    ...strokesByPage,
    [pageNumber]: (strokesByPage[pageNumber] ?? []).filter((stroke) => stroke.id !== strokeId),
  };
}

export function usePdfCollaborationRoom({
  enabled = true,
  fileId,
  workspaceId,
}: PdfCollaborationRoom & { enabled?: boolean }) {
  const socket = useRealtimeSocket();
  const authSession = useAuthSession();
  const currentUserId = authSession?.user.id ?? null;
  const room = useMemo<PdfCollaborationRoom>(
    () => ({ fileId: fileId.trim().toLowerCase(), workspaceId: workspaceId.trim().toLowerCase() }),
    [fileId, workspaceId],
  );
  const [snapshot, setSnapshot] = useState<PdfCollaborationSnapshot>(() => createEmptySnapshot(room));
  const lastPointerSentAtRef = useRef(0);
  const canJoin = Boolean(enabled && socket && room.fileId && room.workspaceId);

  useEffect(() => {
    setSnapshot(createEmptySnapshot(room));
  }, [room]);

  useEffect(() => {
    if (!socket || !canJoin) return;

    function handleJoined(payload: PdfCollaborationSnapshot) {
      if (sameRoom(payload, room)) setSnapshot(payload);
    }

    function handlePageUpdate(payload: PdfCollaborationPresence) {
      if (!sameRoom(payload, room) || payload.userId === currentUserId) return;
      setSnapshot((current) => ({
        ...current,
        presence: upsertByUserId(current.presence, payload),
      }));
    }

    function handlePointerUpdate(payload: PdfCollaborationPointer) {
      if (!sameRoom(payload, room) || payload.userId === currentUserId) return;
      setSnapshot((current) => ({
        ...current,
        pointers: upsertByUserId(current.pointers, payload),
      }));
    }

    function handleLeave(payload: PdfCollaborationPresence) {
      if (!sameRoom(payload, room)) return;
      setSnapshot((current) => ({
        ...current,
        pointers: current.pointers.filter((pointer) => pointer.userId !== payload.userId),
        presence: current.presence.filter((presence) => presence.userId !== payload.userId),
      }));
    }

    function handleStrokeCommit(payload: PdfCollaborationRoom & { stroke: PdfCollaborationStroke }) {
      if (!sameRoom(payload, room)) return;
      setSnapshot((current) => ({
        ...current,
        strokesByPage: appendStroke(current.strokesByPage, payload.stroke),
      }));
    }

    function handleStrokeRemove(payload: PdfCollaborationRoom & { pageNumber: number; strokeId: string }) {
      if (!sameRoom(payload, room)) return;
      setSnapshot((current) => ({
        ...current,
        strokesByPage: removeStroke(current.strokesByPage, payload.pageNumber, payload.strokeId),
      }));
    }

    function handleStrokesClear(payload: PdfCollaborationRoom & { pageNumber: number }) {
      if (!sameRoom(payload, room)) return;
      setSnapshot((current) => ({
        ...current,
        strokesByPage: { ...current.strokesByPage, [payload.pageNumber]: [] },
      }));
    }

    socket.on("pdf-collaboration:joined", handleJoined);
    socket.on("pdf-collaboration:page:update", handlePageUpdate);
    socket.on("pdf-collaboration:pointer:update", handlePointerUpdate);
    socket.on("pdf-collaboration:leave", handleLeave);
    socket.on("pdf-collaboration:stroke:commit", handleStrokeCommit);
    socket.on("pdf-collaboration:stroke:remove", handleStrokeRemove);
    socket.on("pdf-collaboration:strokes:clear", handleStrokesClear);
    socket.emit("pdf-collaboration:join", room);

    return () => {
      socket.emit("pdf-collaboration:leave", room);
      socket.off("pdf-collaboration:joined", handleJoined);
      socket.off("pdf-collaboration:page:update", handlePageUpdate);
      socket.off("pdf-collaboration:pointer:update", handlePointerUpdate);
      socket.off("pdf-collaboration:leave", handleLeave);
      socket.off("pdf-collaboration:stroke:commit", handleStrokeCommit);
      socket.off("pdf-collaboration:stroke:remove", handleStrokeRemove);
      socket.off("pdf-collaboration:strokes:clear", handleStrokesClear);
    };
  }, [canJoin, currentUserId, room, socket]);

  const updatePage = useCallback(
    (pageNumber: number) => {
      if (canJoin) socket?.emit("pdf-collaboration:page:update", { ...room, pageNumber });
    },
    [canJoin, room, socket],
  );

  const updatePointer = useCallback(
    (pageNumber: number, point: PdfCollaborationPoint) => {
      if (!canJoin || !socket) return;
      const now = Date.now();
      if (now - lastPointerSentAtRef.current < POINTER_SEND_THROTTLE_MS) return;
      lastPointerSentAtRef.current = now;
      socket.emit("pdf-collaboration:pointer:update", { ...room, ...point, pageNumber });
    },
    [canJoin, room, socket],
  );

  const commitStroke = useCallback(
    (stroke: Omit<PdfCollaborationStroke, "color">) => {
      const committed = {
        ...stroke,
        color: stroke.tool === "highlighter" ? "#facc15" : "#111827",
      } satisfies PdfCollaborationStroke;
      setSnapshot((current) => ({
        ...current,
        strokesByPage: appendStroke(current.strokesByPage, committed),
      }));
      if (canJoin) socket?.emit("pdf-collaboration:stroke:commit", { ...room, ...stroke });
    },
    [canJoin, room, socket],
  );

  const eraseStroke = useCallback(
    (pageNumber: number, strokeId: string) => {
      setSnapshot((current) => ({
        ...current,
        strokesByPage: removeStroke(current.strokesByPage, pageNumber, strokeId),
      }));
      if (canJoin) socket?.emit("pdf-collaboration:stroke:remove", { ...room, pageNumber, strokeId });
    },
    [canJoin, room, socket],
  );

  const clearPageStrokes = useCallback(
    (pageNumber: number) => {
      setSnapshot((current) => ({
        ...current,
        strokesByPage: { ...current.strokesByPage, [pageNumber]: [] },
      }));
      if (canJoin) socket?.emit("pdf-collaboration:strokes:clear", { ...room, pageNumber });
    },
    [canJoin, room, socket],
  );

  return {
    clearPageStrokes,
    commitStroke,
    currentUserId,
    eraseStroke,
    isConnected: canJoin,
    presence: snapshot.presence.filter((presence) => presence.userId !== currentUserId),
    pointers: snapshot.pointers.filter((pointer) => pointer.userId !== currentUserId),
    strokesByPage: snapshot.strokesByPage,
    updatePage,
    updatePointer,
  };
}
