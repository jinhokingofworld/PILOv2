"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createCanvasRealtimeSocket } from "@/shared/canvas-realtime/canvas-realtime-client";
import type { CanvasRealtimeIdentity } from "@/shared/canvas-realtime/canvas-realtime-types";
import type { PrReviewConflictDraft } from "@/features/pr-review/types";
import type { createPrReviewApiClient } from "@/features/pr-review/api/client";

type LockState = {
  ownerUserId: string;
  lockedAt: string;
  expiresAt: string;
} | null;

type RealtimeSocket = {
  connect: () => void;
  disconnect: () => void;
  emit: (event: string, payload: unknown) => void;
  off: (event: string, listener?: (...args: never[]) => void) => void;
  on: (event: string, listener: (...args: never[]) => void) => void;
};

type DraftEvent = PrReviewConflictDraft & {
  event: "pr-review:conflict-draft:updated";
  workspaceId: string;
  canvasId: string;
  reviewSessionId: string;
};

type LockEvent = {
  workspaceId: string;
  canvasId: string;
  reviewSessionId: string;
  reviewFileId: string;
  ownerUserId: string | null;
  lockedAt: string | null;
  expiresAt: string | null;
};

export function usePrReviewConflictDraftLock({
  conflictFileId,
  apiClient,
  onDraftInvalidated,
  onDraftUpdated,
  realtimeIdentity,
  reviewRoomId,
  reviewSessionId,
  workspaceId
}: {
  apiClient: ReturnType<typeof createPrReviewApiClient>;
  conflictFileId: string | null;
  onDraftInvalidated: () => void;
  onDraftUpdated: (draft: PrReviewConflictDraft) => void;
  realtimeIdentity: CanvasRealtimeIdentity;
  reviewRoomId: string;
  reviewSessionId: string;
  workspaceId: string;
}) {
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [lock, setLock] = useState<LockState>(null);
  const socketRef = useRef<RealtimeSocket | null>(null);
  const heartbeatRef = useRef<number | null>(null);

  const currentUserId = realtimeIdentity.currentUser?.userId ?? null;
  const isEditing = Boolean(lock && lock.ownerUserId === currentUserId);

  const releaseEdit = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !canvasId || !conflictFileId || !isEditing) return;
    socket.emit("pr-review:conflict-draft:lock:release", {
      workspaceId,
      canvasId,
      reviewSessionId,
      reviewFileId: conflictFileId
    });
  }, [canvasId, conflictFileId, isEditing, reviewSessionId, workspaceId]);

  const startEdit = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !canvasId || !conflictFileId || !currentUserId) return;
    socket.emit("pr-review:conflict-draft:lock:claim", {
      workspaceId,
      canvasId,
      reviewSessionId,
      reviewFileId: conflictFileId
    });
  }, [canvasId, conflictFileId, currentUserId, reviewSessionId, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    void apiClient
      .getReviewRoom(workspaceId, reviewRoomId)
      .then(room => {
        if (!cancelled) {
          setCanvasId(room.canvasId);
        }
      })
      .catch(() => setCanvasId(null));
    return () => {
      cancelled = true;
    };
  }, [apiClient, reviewRoomId, workspaceId]);

  useEffect(() => {
    if (!canvasId || !realtimeIdentity.authToken || !realtimeIdentity.currentUser) {
      return;
    }

    const socket = createCanvasRealtimeSocket({
      authToken: realtimeIdentity.authToken,
      currentUser: realtimeIdentity.currentUser
    }) as unknown as RealtimeSocket | null;
    if (!socket) return;
    socketRef.current = socket;

    const room = { workspaceId, canvasId };
    const matches = (payload: { workspaceId: string; canvasId: string }) =>
      payload.workspaceId === workspaceId && payload.canvasId === canvasId;
    const handleConnect = () => socket.emit("canvas:join", room);
    const handleJoined = (payload: {
      workspaceId: string;
      canvasId: string;
      shapeLocks?: Array<{
        shapeId: string;
        ownerUserId: string;
        lockedAt: string;
        expiresAt: string;
      }>;
    }) => {
      if (!matches(payload) || !conflictFileId) return;
      const shapeId = `pr-review-conflict-draft:${reviewSessionId}:${conflictFileId}`;
      const existing = payload.shapeLocks?.find(lock => lock.shapeId === shapeId);
      if (existing) {
        setLock({
          ownerUserId: existing.ownerUserId,
          lockedAt: existing.lockedAt,
          expiresAt: existing.expiresAt
        });
      }
    };
    const handleLock = (payload: LockEvent) => {
      if (!matches(payload) || payload.reviewSessionId !== reviewSessionId || payload.reviewFileId !== conflictFileId) return;
      if (!payload.ownerUserId || !payload.lockedAt || !payload.expiresAt) {
        setLock(null);
        return;
      }
      setLock({
        ownerUserId: payload.ownerUserId,
        lockedAt: payload.lockedAt,
        expiresAt: payload.expiresAt
      });
    };
    const handleReleased = (payload: LockEvent) => {
      if (matches(payload) && payload.reviewSessionId === reviewSessionId && payload.reviewFileId === conflictFileId) {
        setLock(null);
      }
    };
    const handleDraftUpdated = (payload: DraftEvent) => {
      if (matches(payload) && payload.reviewSessionId === reviewSessionId && payload.reviewFileId === conflictFileId) {
        onDraftUpdated(payload);
      }
    };
    const handleDraftInvalidated = (payload: {
      workspaceId: string;
      canvasId: string;
      reviewSessionId: string;
      reviewFileIds: string[];
    }) => {
      if (
        matches(payload) &&
        payload.reviewSessionId === reviewSessionId &&
        conflictFileId &&
        payload.reviewFileIds.includes(conflictFileId)
      ) {
        onDraftInvalidated();
      }
    };

    socket.on("connect", handleConnect as never);
    socket.on("canvas:joined", handleJoined as never);
    socket.on("pr-review:conflict-draft:lock:accepted", handleLock as never);
    socket.on("pr-review:conflict-draft:lock:updated", handleLock as never);
    socket.on("pr-review:conflict-draft:lock:rejected", handleLock as never);
    socket.on("pr-review:conflict-draft:lock:released", handleReleased as never);
    socket.on("pr-review:conflict-draft:updated", handleDraftUpdated as never);
    socket.on("pr-review:conflict-draft:invalidated", handleDraftInvalidated as never);
    socket.connect();

    return () => {
      socket.emit("canvas:leave", room);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [
    canvasId,
    conflictFileId,
    onDraftInvalidated,
    onDraftUpdated,
    realtimeIdentity,
    reviewSessionId,
    workspaceId
  ]);

  useEffect(() => {
    if (!isEditing) {
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
      return;
    }
    heartbeatRef.current = window.setInterval(startEdit, 3_000);
    return () => {
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    };
  }, [isEditing, startEdit]);

  useEffect(() => () => releaseEdit(), [releaseEdit]);

  return {
    canEdit: !lock || isEditing,
    editingOwnerUserId: lock?.ownerUserId ?? null,
    isEditing,
    releaseEdit,
    startEdit
  };
}
