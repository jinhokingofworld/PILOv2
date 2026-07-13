export type CanvasRoomRef = {
  canvasId: string;
  workspaceId: string;
};

export type CanvasPresenceUser = {
  color?: string;
  displayName?: string;
  userId: string;
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

export type CanvasPresenceState = {
  canvasId: string;
  cursor: CanvasPresencePoint | null;
  displayName?: string;
  editingMode: CanvasPresenceEditingMode | null;
  editingShapeId: string | null;
  selectedShapeIds: string[];
  sentAt?: string;
  updatedAt: string;
  userId: string;
  viewport?: CanvasPresenceViewport;
  workspaceId: string;
};

export type CanvasJoinPayload = CanvasRoomRef & {
  lastSeenOpSeq?: number;
};

export type CanvasJoinedPayload = CanvasRoomRef & {
  latestOpSeq: number;
  presence: CanvasPresenceState[];
  readOnly: boolean;
  syncRequired: boolean;
};

export type CanvasPresenceUpdatePayload = CanvasRoomRef & {
  cursor: CanvasPresencePoint | null;
  editingMode?: CanvasPresenceEditingMode | null;
  editingShapeId?: string | null;
  selectedShapeIds: string[];
  sentAt?: string;
  viewport?: CanvasPresenceViewport;
};

export type CanvasPresenceLeavePayload = CanvasRoomRef & {
  userId: string;
};

export type CanvasShapeOperationPayload = CanvasRoomRef & {
  actorUserId: string;
  baseRevision: number | null;
  clientOperationId: string;
  contentHash: string;
  createdAt: string;
  id: string;
  operationType: "create" | "update" | "delete";
  opSeq: number;
  payload: Record<string, unknown>;
  resultRevision: number;
  shapeId: string;
};

export type CanvasShapeLockState = CanvasRoomRef & {
  expiresAt: string;
  lockedAt: string;
  ownerUserId: string;
  shapeId: string;
};

export type CanvasShapeLockClaimPayload = CanvasRoomRef & {
  shapeIds: string[];
};

export type CanvasShapeLockAcceptedPayload = CanvasRoomRef & {
  locks: CanvasShapeLockState[];
};

export type CanvasShapeLockRejectedPayload = CanvasRoomRef & {
  locks: CanvasShapeLockState[];
  shapeIds: string[];
};

export type CanvasShapeLockReleasePayload = CanvasRoomRef & {
  shapeIds?: string[];
};

export type CanvasShapeLockReleaseEventPayload = CanvasRoomRef & {
  ownerUserId: string;
  shapeIds: string[];
};

export type CanvasShapePreviewPayload = CanvasRoomRef & {
  phase: "move" | "resize" | "unknown";
  shapes: Record<string, unknown>[];
};

export type CanvasShapePreviewEventPayload = CanvasShapePreviewPayload & {
  actorUserId: string;
  sentAt: string;
};

export type CanvasShapePreviewClearPayload = CanvasRoomRef & {
  actorUserId: string;
  shapeIds: string[];
};

export type CanvasShapePreviewClearRequestPayload = CanvasRoomRef & {
  shapeIds: string[];
};
