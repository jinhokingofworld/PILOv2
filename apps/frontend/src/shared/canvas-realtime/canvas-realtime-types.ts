"use client";

export type CanvasShapeOperationPayload = {
  id: string;
  workspaceId: string;
  canvasId: string;
  shapeId: string;
  operationType: "create" | "update" | "delete";
  opSeq: number;
  actorUserId: string;
  clientOperationId: string;
  baseRevision: number | null;
  resultRevision: number;
  contentHash: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type CanvasOperationsCatchupPayload = {
  latestOpSeq: number;
  operations: CanvasShapeOperationPayload[];
};

export type CanvasRealtimeUser = {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
};

export type CanvasRealtimeIdentity = {
  authToken: string | null;
  currentUser: CanvasRealtimeUser | null;
};

export type CanvasRealtimeConfig = CanvasRealtimeIdentity & {
  enabled: boolean;
  workspaceId: string;
  canvasId: string;
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

export type CanvasLoadedViewportBounds = {
  height: number;
  margin: number;
  width: number;
  x: number;
  y: number;
};

export type CanvasRoomLoadedRegion = {
  bottom: number;
  id: string;
  left: number;
  loadedAt: string;
  right: number;
  top: number;
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
  loadedRegions: CanvasRoomLoadedRegion[];
  previews: CanvasShapePreviewEventPayload[];
  readOnly: boolean;
  roomShapes: Record<string, unknown>[];
  syncRequired: boolean;
  presence: CanvasRemotePresenceState[];
  shapeLocks: CanvasShapeLockState[];
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

export type CanvasViewportLoadedPayload = {
  workspaceId: string;
  canvasId: string;
  bounds: CanvasLoadedViewportBounds;
  shapes: Record<string, unknown>[];
};

export type CanvasRoomLoadedRegionsUpdatedPayload = {
  workspaceId: string;
  canvasId: string;
  loadedRegions: CanvasRoomLoadedRegion[];
};

export type CanvasRoomShapesHydratePayload = {
  workspaceId: string;
  canvasId: string;
  loadedRegions: CanvasRoomLoadedRegion[];
  shapes: Record<string, unknown>[];
};

export type CanvasRoomShapePatchPayload = {
  workspaceId: string;
  canvasId: string;
  deletedShapeIds: string[];
  upsertShapes: Record<string, unknown>[];
};

export type CanvasRoomShapePatchEventPayload = CanvasRoomShapePatchPayload & {
  actorUserId: string;
  sentAt: string;
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
  "canvas:room:loaded-regions:update": (
    payload: CanvasRoomLoadedRegionsUpdatedPayload,
  ) => void;
  "canvas:room:shapes:hydrate": (
    payload: CanvasRoomShapesHydratePayload,
  ) => void;
  "canvas:room:shape:patch": (
    payload: CanvasRoomShapePatchEventPayload,
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
  "canvas:viewport:loaded": (payload: CanvasViewportLoadedPayload) => void;
  "canvas:room:shape:patch": (payload: CanvasRoomShapePatchPayload) => void;
};
