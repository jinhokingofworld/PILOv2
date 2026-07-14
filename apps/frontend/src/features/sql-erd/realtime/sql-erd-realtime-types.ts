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

export type SqlErdPresenceEditingMode =
  | "draw"
  | "move"
  | "relation"
  | "resize"
  | "sql"
  | null;

export type SqlErdPresenceSelectedObject = {
  id: string;
  type:
    | "annotation"
    | "frame"
    | "note"
    | "relation"
    | "stroke"
    | "table"
    | "text";
};

export type SqlErdRemotePresenceState = {
  cursor: SqlErdPresencePoint | null;
  displayName: string;
  editingMode: SqlErdPresenceEditingMode;
  selectedObjects: SqlErdPresenceSelectedObject[];
  sentAt: string;
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

export type SqlErdOperationPayload = {
  actorUserId: string;
  appliedOnRevision: number;
  baseRevision: number;
  clientOperationId: string;
  createdAt: string;
  id: string;
  opSeq: number;
  rebased: boolean;
  resultRevision: number;
  sessionId: string;
  type: "layout_patch" | "source_snapshot";
  workspaceId: string;
  patch?: Record<string, unknown>;
  sourceSnapshotId?: string;
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
  "sql-erd:operation": (payload: SqlErdOperationPayload) => void;
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
    editingMode: SqlErdPresenceEditingMode;
    selectedObjects: SqlErdPresenceSelectedObject[];
    sessionId: string;
    sentAt: string;
    tool: SqlErdPresenceTool;
    workspaceId: string;
  }) => void;
};
