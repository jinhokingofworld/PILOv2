"use client";

export type SqlErdRealtimeUser = {
  displayName: string;
  userId: string;
};

export type SqlErdRealtimeConfig = {
  authToken: string | null;
  currentUser: SqlErdRealtimeUser | null;
  enabled: boolean;
  sessionId: string;
  workspaceId: string;
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

export type SqlErdRemotePresenceState = {
  cursor: SqlErdPresencePoint | null;
  displayName?: string;
  selectedShapeIds: string[];
  sessionId: string;
  tool: SqlErdPresenceTool;
  updatedAt: string;
  userId: string;
  workspaceId: string;
};

export type SqlErdJoinedPayload = {
  latestOpSeq: number;
  presence: SqlErdRemotePresenceState[];
  sessionId: string;
  workspaceId: string;
};

export type SqlErdPresenceLeavePayload = {
  sessionId: string;
  userId: string;
  workspaceId: string;
};

export type SqlErdRealtimeErrorPayload = {
  code: string;
  message: string;
  requestId?: string;
};

export type SqlErdServerToClientEvents = {
  "sql-erd:error": (payload: SqlErdRealtimeErrorPayload) => void;
  "sql-erd:joined": (payload: SqlErdJoinedPayload) => void;
  "sql-erd:presence:leave": (payload: SqlErdPresenceLeavePayload) => void;
  "sql-erd:presence:update": (payload: SqlErdRemotePresenceState) => void;
};

export type SqlErdClientToServerEvents = {
  "sql-erd:join": (payload: {
    sessionId: string;
    workspaceId: string;
  }) => void;
  "sql-erd:leave": (payload: { sessionId: string; workspaceId: string }) => void;
  "sql-erd:presence:update": (payload: {
    cursor: SqlErdPresencePoint | null;
    selectedShapeIds: string[];
    sessionId: string;
    tool: SqlErdPresenceTool;
    workspaceId: string;
  }) => void;
};
