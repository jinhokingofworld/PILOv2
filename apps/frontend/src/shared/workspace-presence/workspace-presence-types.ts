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

export type WorkspacePresenceViewport =
  | { kind: "document"; xRatio: number; yRatio: number }
  | {
      kind: "element";
      key:
        | "board-kanban"
        | "calendar-grid"
        | "drive-list"
        | "meeting-content";
      xRatio: number;
      yRatio: number;
    }
  | { kind: "camera"; x: number; y: number; z: number };

export type WorkspacePresenceLocation = {
  context: Record<string, string | null>;
  page: WorkspacePresencePage;
  route: WorkspacePresenceRoute;
  viewport: WorkspacePresenceViewport;
};

export type WorkspacePresenceState = {
  displayName: string;
  focused: boolean;
  lastActiveAt: string;
  location: WorkspacePresenceLocation | null;
  userId: string;
  visible: boolean;
  workspaceId: string;
};

export type WorkspacePresenceJoinedPayload = {
  presence: WorkspacePresenceState[];
  workspaceId: string;
};

export type WorkspacePresenceLeavePayload = {
  userId: string;
  workspaceId: string;
};

export type WorkspacePresenceUpdatePayload = {
  focused: boolean;
  location: WorkspacePresenceLocation | null;
  visible: boolean;
  workspaceId: string;
};

export type WorkspaceLocationAdapter = {
  capture: () => WorkspacePresenceLocation | null;
  page: WorkspacePresencePage;
  ready: boolean;
  restore: (location: WorkspacePresenceLocation) => boolean | Promise<boolean>;
};
