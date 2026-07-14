export type SqlErdAccessContext = {
  token: string;
  userId: string;
};

export type SqlErdPresencePoint = {
  x: number;
  y: number;
};

export type SqlErdPresenceTool =
  | "draw"
  | "eraser"
  | "frame"
  | "note"
  | "select"
  | "text";

export type SqlErdRoomRef = {
  sessionId: string;
  workspaceId: string;
};

export type SqlErdJoinPayload = SqlErdRoomRef;

export type SqlErdPresenceUpdatePayload = SqlErdRoomRef & {
  cursor: SqlErdPresencePoint | null;
  selectedShapeIds: string[];
  tool: SqlErdPresenceTool;
};

export type SqlErdPresenceUser = {
  displayName?: string;
  userId: string;
};

export type SqlErdPresenceState = SqlErdPresenceUpdatePayload & {
  displayName?: string;
  updatedAt: string;
  userId: string;
};

export type SqlErdPresenceLeavePayload = SqlErdRoomRef & {
  userId: string;
};

export type SqlErdJoinedPayload = SqlErdRoomRef & {
  latestOpSeq: number;
  presence: SqlErdPresenceState[];
};
