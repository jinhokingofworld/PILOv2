"use client";

import type { CanvasShapeOperationPayload } from "../api/canvas-types";

export type CanvasRealtimeUser = {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
};

export type CanvasRealtimeConfig = {
  enabled: boolean;
  workspaceId: string;
  canvasId: string;
  authToken: string | null;
  currentUser: CanvasRealtimeUser | null;
};

export type CanvasPresencePoint = {
  x: number;
  y: number;
};

export type CanvasPresenceViewport = {
  height: number;
  width: number;
  x: number;
  y: number;
  zoom: number;
};

export type CanvasPresenceEditingMode =
  | "code"
  | "draw"
  | "hand"
  | "move"
  | "placement"
  | "resize"
  | "select"
  | "text";

export type CanvasRemotePresenceState = CanvasRealtimeUser & {
  workspaceId: string;
  canvasId: string;
  cursor: CanvasPresencePoint | null;
  editingMode: CanvasPresenceEditingMode | null;
  editingShapeId: string | null;
  selectedShapeIds: string[];
  sentAt?: string;
  updatedAt: string;
  viewport?: CanvasPresenceViewport;
};

export type CanvasJoinPayload = {
  workspaceId: string;
  canvasId: string;
  lastSeenOpSeq?: number;
};

export type CanvasJoinedPayload = {
  workspaceId: string;
  canvasId: string;
  latestOpSeq: number;
  syncRequired: boolean;
  presence: CanvasRemotePresenceState[];
};

export type CanvasPresenceUpdatePayload = {
  workspaceId: string;
  canvasId: string;
  cursor: CanvasPresencePoint | null;
  editingMode: CanvasPresenceEditingMode | null;
  editingShapeId: string | null;
  selectedShapeIds: string[];
  sentAt: string;
  viewport: CanvasPresenceViewport;
};

export type CanvasPresenceLeavePayload = {
  workspaceId: string;
  canvasId: string;
  userId: string;
};

export type CanvasShapeLockState = {
  workspaceId: string;
  canvasId: string;
  shapeId: string;
  ownerUserId: string;
  lockedAt: string;
  expiresAt: string;
};

export type CanvasShapeLockClaimPayload = {
  workspaceId: string;
  canvasId: string;
  shapeIds: string[];
};

export type CanvasShapeLockAcceptedPayload = {
  workspaceId: string;
  canvasId: string;
  locks: CanvasShapeLockState[];
};

export type CanvasShapeLockRejectedPayload = {
  workspaceId: string;
  canvasId: string;
  shapeIds: string[];
  locks: CanvasShapeLockState[];
};

export type CanvasShapeLockReleasePayload = {
  workspaceId: string;
  canvasId: string;
  shapeIds?: string[];
};

export type CanvasShapeLockReleaseEventPayload = {
  workspaceId: string;
  canvasId: string;
  ownerUserId: string;
  shapeIds: string[];
};

export type CanvasShapePreviewPhase =
  | "delete"
  | "move"
  | "resize"
  | "unknown";

export type CanvasShapePreviewPayload = {
  workspaceId: string;
  canvasId: string;
  phase: CanvasShapePreviewPhase;
  deletedShapeIds?: string[];
  shapes: Record<string, unknown>[];
};

export type CanvasShapePreviewEventPayload = CanvasShapePreviewPayload & {
  actorUserId: string;
  sentAt: string;
};

export type CanvasShapePreviewClearPayload = {
  workspaceId: string;
  canvasId: string;
  actorUserId: string;
  shapeIds: string[];
};

export type CanvasShapePreviewClearRequestPayload = {
  workspaceId: string;
  canvasId: string;
  shapeIds: string[];
};

export type CanvasRealtimeErrorPayload = {
  code: string;
  message: string;
  requestId?: string;
};

export type CanvasSyncRequiredPayload = {
  workspaceId: string;
  canvasId: string;
  latestOpSeq: number;
};

export type CanvasServerToClientEvents = {
  "canvas:joined": (payload: CanvasJoinedPayload) => void;
  "canvas:operation": (payload: CanvasShapeOperationPayload) => void;
  "canvas:sync:required": (payload: CanvasSyncRequiredPayload) => void;
  "canvas:presence:update": (payload: CanvasRemotePresenceState) => void;
  "canvas:presence:leave": (payload: CanvasPresenceLeavePayload) => void;
  "canvas:shape:lock:accepted": (
    payload: CanvasShapeLockAcceptedPayload,
  ) => void;
  "canvas:shape:lock:rejected": (
    payload: CanvasShapeLockRejectedPayload,
  ) => void;
  "canvas:shape:lock:release": (
    payload: CanvasShapeLockReleaseEventPayload,
  ) => void;
  "canvas:shape:lock:update": (
    payload: CanvasShapeLockAcceptedPayload,
  ) => void;
  "canvas:shape:preview": (payload: CanvasShapePreviewEventPayload) => void;
  "canvas:shape:preview:clear": (
    payload: CanvasShapePreviewClearPayload,
  ) => void;
  "canvas:error": (payload: CanvasRealtimeErrorPayload) => void;
};

export type CanvasClientToServerEvents = {
  "canvas:join": (payload: CanvasJoinPayload) => void;
  "canvas:leave": (payload: CanvasJoinPayload) => void;
  "canvas:presence:update": (payload: CanvasPresenceUpdatePayload) => void;
  "canvas:shape:lock:claim": (payload: CanvasShapeLockClaimPayload) => void;
  "canvas:shape:lock:release": (
    payload: CanvasShapeLockReleasePayload,
  ) => void;
  "canvas:shape:preview": (payload: CanvasShapePreviewPayload) => void;
  "canvas:shape:preview:clear": (
    payload: CanvasShapePreviewClearRequestPayload,
  ) => void;
};
