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

export type CanvasRemotePresenceState = CanvasRealtimeUser & {
  workspaceId: string;
  canvasId: string;
  cursor: CanvasPresencePoint;
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
  cursor: CanvasPresencePoint;
  selectedShapeIds: string[];
  sentAt: string;
  viewport: CanvasPresenceViewport;
};

export type CanvasPresenceLeavePayload = {
  workspaceId: string;
  canvasId: string;
  userId: string;
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
  "canvas:error": (payload: CanvasRealtimeErrorPayload) => void;
};

export type CanvasClientToServerEvents = {
  "canvas:join": (payload: CanvasJoinPayload) => void;
  "canvas:leave": (payload: CanvasJoinPayload) => void;
  "canvas:presence:update": (payload: CanvasPresenceUpdatePayload) => void;
};
