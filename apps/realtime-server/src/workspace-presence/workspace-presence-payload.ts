import type {
  WorkspacePresenceLocation,
  WorkspacePresencePage,
  WorkspacePresenceRoomRef,
  WorkspacePresenceUpdatePayload,
  WorkspacePresenceViewport,
} from "./workspace-presence-types";

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_SEARCH_LENGTH = 2_048;

const pathnameByPage: Record<WorkspacePresencePage, string> = {
  board: "/board",
  calendar: "/calendar",
  canvas: "/canvas",
  drive: "/files",
  home: "/home",
  meeting: "/meeting",
  "pr-review": "/pr-review",
  "sql-erd": "/sql-erd",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readIdentifier(value: unknown): string | null {
  const identifier = readRequiredString(value);
  return identifier && identifier.length <= MAX_IDENTIFIER_LENGTH
    ? identifier
    : null;
}

function clampRatio(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), 1);
}

function readRatioViewport(
  value: Record<string, unknown>,
): {
  xRatio: number;
  yRatio: number;
} | null {
  const xRatio = clampRatio(value.xRatio);
  const yRatio = clampRatio(value.yRatio);
  if (xRatio === null || yRatio === null) return null;

  return {
    xRatio,
    yRatio,
  };
}

function readViewport(value: unknown): WorkspacePresenceViewport | null {
  if (!isRecord(value)) return null;

  if (value.kind === "camera") {
    const { x, y, z } = value;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    ) {
      return null;
    }
    return { kind: "camera", x, y, z };
  }

  if (value.kind === "document") {
    const ratio = readRatioViewport(value);
    return ratio ? { ...ratio, kind: "document" } : null;
  }

  if (value.kind === "element") {
    const ratio = readRatioViewport(value);
    if (
      !ratio ||
      (value.key !== "board-kanban" &&
        value.key !== "calendar-grid" &&
        value.key !== "drive-list" &&
        value.key !== "meeting-content")
    ) {
      return null;
    }
    return { ...ratio, key: value.key, kind: "element" };
  }

  return null;
}

function readContext(
  page: WorkspacePresencePage,
  value: unknown,
): Record<string, string | null> | null {
  if (!isRecord(value)) return null;

  const readNullableIdentifier = (key: string) => {
    if (value[key] === null) return null;
    return readIdentifier(value[key]);
  };

  switch (page) {
    case "home":
      return {};
    case "calendar": {
      const selectedDate = readNullableIdentifier("selectedDate");
      return value.selectedDate === null || selectedDate
        ? { selectedDate }
        : null;
    }
    case "board": {
      const boardId = readIdentifier(value.boardId);
      return boardId ? { boardId } : null;
    }
    case "sql-erd": {
      const sessionId = readIdentifier(value.sessionId);
      return sessionId ? { sessionId } : null;
    }
    case "pr-review": {
      const reviewSessionId = readNullableIdentifier("reviewSessionId");
      return value.reviewSessionId === null || reviewSessionId
        ? { reviewSessionId }
        : null;
    }
    case "meeting": {
      const meetingRoomId = readNullableIdentifier("meetingRoomId");
      return value.meetingRoomId === null || meetingRoomId
        ? { meetingRoomId }
        : null;
    }
    case "canvas": {
      const canvasId = readIdentifier(value.canvasId);
      return canvasId ? { canvasId } : null;
    }
    case "drive": {
      const folderId = readNullableIdentifier("folderId");
      return value.folderId === null || folderId ? { folderId } : null;
    }
  }
}

function isPage(value: unknown): value is WorkspacePresencePage {
  return typeof value === "string" && value in pathnameByPage;
}

function isViewportAllowed(
  page: WorkspacePresencePage,
  viewport: WorkspacePresenceViewport,
) {
  switch (page) {
    case "home":
      return viewport.kind === "document";
    case "calendar":
      return (
        viewport.kind === "document" ||
        (viewport.kind === "element" && viewport.key === "calendar-grid")
      );
    case "board":
      return viewport.kind === "element" && viewport.key === "board-kanban";
    case "sql-erd":
    case "canvas":
      return viewport.kind === "camera";
    case "pr-review":
      return viewport.kind === "camera" || viewport.kind === "document";
    case "meeting":
      return (
        viewport.kind === "document" ||
        (viewport.kind === "element" && viewport.key === "meeting-content")
      );
    case "drive":
      return (
        viewport.kind === "document" ||
        (viewport.kind === "element" && viewport.key === "drive-list")
      );
  }
}

function readLocation(value: unknown): WorkspacePresenceLocation | null {
  if (!isRecord(value) || !isPage(value.page) || !isRecord(value.route)) {
    return null;
  }

  const pathname = readRequiredString(value.route.pathname);
  const search = value.route.search;
  const expectedPathname = pathnameByPage[value.page];
  if (
    !pathname ||
    (pathname !== expectedPathname && !pathname.startsWith(`${expectedPathname}/`)) ||
    typeof search !== "string" ||
    search.length > MAX_SEARCH_LENGTH
  ) {
    return null;
  }

  const context = readContext(value.page, value.context);
  const viewport = readViewport(value.viewport);
  if (!context || !viewport || !isViewportAllowed(value.page, viewport)) {
    return null;
  }

  return {
    context,
    page: value.page,
    route: { pathname, search },
    viewport,
  };
}

export function readWorkspacePresenceRoomRef(
  payload: unknown,
): WorkspacePresenceRoomRef | null {
  if (!isRecord(payload)) return null;
  const workspaceId = readIdentifier(payload.workspaceId);
  return workspaceId ? { workspaceId } : null;
}

export function readWorkspacePresenceUpdatePayload(
  payload: unknown,
): WorkspacePresenceUpdatePayload | null {
  const room = readWorkspacePresenceRoomRef(payload);
  if (!room || !isRecord(payload)) return null;
  if (typeof payload.focused !== "boolean" || typeof payload.visible !== "boolean") {
    return null;
  }

  const location = payload.location === null ? null : readLocation(payload.location);
  if (payload.location !== null && !location) return null;

  return {
    ...room,
    focused: payload.focused,
    location,
    visible: payload.visible,
  };
}
