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

type SqlErdOperationBasePayload = {
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
  workspaceId: string;
};

export type SqlErdOperationPayload =
  | (SqlErdOperationBasePayload & {
      patch: Record<string, unknown>;
      type: "layout_patch";
    })
  | (SqlErdOperationBasePayload & {
      sourceSnapshotId: string;
      type: "source_snapshot";
    });

export type SqlErdPresenceLeavePayload = {
  sessionId: string;
  userId: string;
  workspaceId: string;
};

export type SqlErdTableMovePreview = {
  actorUserId: string;
  dragId: string;
  sentAt: string;
  sessionId: string;
  tableId: string;
  workspaceId: string;
  x: number;
  y: number;
};

export type SqlErdTableMoveClear = {
  actorUserId: string;
  sessionId: string;
  tableIds: string[];
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
  "sql-erd:table-move:clear": (payload: SqlErdTableMoveClear) => void;
  "sql-erd:table-move:preview": (payload: SqlErdTableMovePreview) => void;
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
  "sql-erd:table-move:clear": (payload: {
    sessionId: string;
    tableIds: string[];
    workspaceId: string;
  }) => void;
  "sql-erd:table-move:preview": (payload: {
    dragId: string;
    sessionId: string;
    tableId: string;
    workspaceId: string;
    x: number;
    y: number;
  }) => void;
};
