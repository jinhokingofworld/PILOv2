export type WorkspacePresencePage =
  | "home"
  | "calendar"
  | "board"
  | "sql-erd"
  | "pr-review"
  | "meeting"
  | "canvas"
  | "drive";

export type WorkspacePresenceRoute = {
  pathname: string;
  search: string;
};

export type WorkspacePresenceDocumentViewport = {
  kind: "document";
  xRatio: number;
  yRatio: number;
};

export type WorkspacePresenceElementViewport = {
  kind: "element";
  key:
    | "board-kanban"
    | "calendar-grid"
    | "drive-list"
    | "meeting-content";
  xRatio: number;
  yRatio: number;
};

export type WorkspacePresenceCameraViewport = {
  kind: "camera";
  x: number;
  y: number;
  z: number;
};

export type WorkspacePresenceViewport =
  | WorkspacePresenceCameraViewport
  | WorkspacePresenceDocumentViewport
  | WorkspacePresenceElementViewport;

export type WorkspacePresenceLocation = {
  context: Record<string, string | null>;
  page: WorkspacePresencePage;
  route: WorkspacePresenceRoute;
  viewport: WorkspacePresenceViewport;
};

export type WorkspacePresenceRoomRef = {
  workspaceId: string;
};

export type WorkspacePresenceUpdatePayload = WorkspacePresenceRoomRef & {
  focused: boolean;
  location: WorkspacePresenceLocation | null;
  visible: boolean;
};

export type WorkspacePresenceIdentity = {
  displayName: string;
  userId: string;
};

export type WorkspacePresenceState = WorkspacePresenceIdentity &
  WorkspacePresenceUpdatePayload & {
    lastActiveAt: string;
  };

export type WorkspacePresenceLeavePayload = WorkspacePresenceRoomRef & {
  userId: string;
};

export type WorkspacePresenceJoinedPayload = WorkspacePresenceRoomRef & {
  presence: WorkspacePresenceState[];
};

export type WorkspacePresenceClearResult =
  | { kind: "leave"; payload: WorkspacePresenceLeavePayload }
  | { kind: "update"; presence: WorkspacePresenceState };
