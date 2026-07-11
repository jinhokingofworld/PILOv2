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
