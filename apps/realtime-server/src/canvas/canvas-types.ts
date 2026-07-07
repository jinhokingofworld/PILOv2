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

export type CanvasPresenceState = {
  cursor: CanvasPresencePoint | null;
  selectedShapeIds: string[];
  updatedAt: string;
  user: CanvasPresenceUser;
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
  selectedShapeIds: string[];
};

export type CanvasPresenceLeavePayload = CanvasRoomRef & {
  userId: string;
};
