import type {
  WorkspacePresenceLocation,
  WorkspacePresencePage,
  WorkspacePresenceRoomRef,
  WorkspacePresenceUpdatePayload,
  WorkspacePresenceViewport,
} from "./workspace-presence-types";

const MAX_IDENTIFIER_LENGTH = 256;
const MAX_SEARCH_LENGTH = 2_048;

const pathnamesByPage: Record<WorkspacePresencePage, readonly string[]> = {
  board: ["/board"],
  calendar: ["/calendar"],
  canvas: ["/canvas"],
  chat: ["/chat"],
  drive: ["/files"],
  home: ["/home"],
  meeting: ["/meeting", "/report"],
  "pr-review": ["/pr-review"],
  "sql-erd": ["/sql-erd"],
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

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: string[]) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function readOptionalIdentifierList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const identifiers = value.map(readIdentifier);
  return identifiers.every((identifier) => identifier !== null)
    ? (identifiers as string[])
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
    const selectedShapeIds = readOptionalIdentifierList(value.selectedShapeIds);
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof z !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      !selectedShapeIds
    ) {
      return null;
    }
    return {
      kind: "camera",
      ...(value.selectedShapeIds === undefined ? {} : { selectedShapeIds }),
      x,
      y,
      z,
    };
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
        value.key !== "board-issue-sheet" &&
        value.key !== "calendar-grid" &&
        value.key !== "calendar-event-detail" &&
        value.key !== "calendar-events-dialog" &&
        value.key !== "chat-messages" &&
        value.key !== "drive-list" &&
        value.key !== "drive-pdf" &&
        value.key !== "meeting-content" &&
        value.key !== "pr-review-diff" &&
        value.key !== "pr-review-inspector" &&
        value.key !== "sql-erd-inspector")
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
      return hasOnlyKeys(value, []) ? {} : null;
    case "calendar": {
      if (!hasOnlyKeys(value, ["eventId", "selectedDate"])) return null;
      const eventId = readNullableIdentifier("eventId");
      const selectedDate = readNullableIdentifier("selectedDate");
      const validEventId = value.eventId === undefined || value.eventId === null || eventId;
      const validSelectedDate =
        value.selectedDate === undefined || value.selectedDate === null || selectedDate;
      return (
        validEventId &&
        validSelectedDate &&
        (selectedDate === null || /^\d{4}-\d{2}-\d{2}$/.test(selectedDate))
      )
        ? { eventId, selectedDate }
        : null;
    }
    case "board": {
      if (!hasOnlyKeys(value, ["boardId", "issueId"])) return null;
      const boardId = readIdentifier(value.boardId);
      const issueId = readNullableIdentifier("issueId");
      const validIssueId = value.issueId === undefined || value.issueId === null || issueId;
      return boardId && validIssueId ? { boardId, issueId } : null;
    }
    case "sql-erd": {
      if (
        !hasOnlyKeys(value, [
          "sessionId",
          "sqlErdInspectorOpen",
          "sqlErdSelectionId",
          "sqlErdSelectionTableId",
          "sqlErdSelectionType",
        ])
      ) {
        return null;
      }
      const sessionId = readIdentifier(value.sessionId);
      const inspectorOpen = value.sqlErdInspectorOpen ?? "false";
      const selectionType = value.sqlErdSelectionType ?? "none";
      const selectionId = readNullableIdentifier("sqlErdSelectionId");
      const selectionTableId = readNullableIdentifier("sqlErdSelectionTableId");
      const validSelectionId =
        value.sqlErdSelectionId === undefined ||
        value.sqlErdSelectionId === null ||
        selectionId;
      const validSelectionTableId =
        value.sqlErdSelectionTableId === undefined ||
        value.sqlErdSelectionTableId === null ||
        selectionTableId;
      const validSelectionType =
        selectionType === "none" ||
        selectionType === "table" ||
        selectionType === "column" ||
        selectionType === "relation" ||
        selectionType === "annotation" ||
        selectionType === "note" ||
        selectionType === "frame" ||
        selectionType === "text";
      const validSelection =
        selectionType === "none"
          ? selectionId === null && selectionTableId === null
          : selectionType === "column"
            ? selectionId !== null && selectionTableId !== null
            : selectionId !== null && selectionTableId === null;
      if (
        !sessionId ||
        (inspectorOpen !== "true" && inspectorOpen !== "false") ||
        !validSelectionId ||
        !validSelectionTableId ||
        !validSelectionType ||
        !validSelection
      ) {
        return null;
      }
      return {
        sessionId,
        sqlErdInspectorOpen: inspectorOpen,
        sqlErdSelectionId: selectionId,
        sqlErdSelectionTableId: selectionTableId,
        sqlErdSelectionType: selectionType,
      };
    }
    case "pr-review": {
      if (!hasOnlyKeys(value, ["reviewFileId", "reviewSessionId"])) return null;
      const reviewFileId = readNullableIdentifier("reviewFileId");
      const reviewSessionId = readNullableIdentifier("reviewSessionId");
      const validReviewFileId =
        value.reviewFileId === undefined || value.reviewFileId === null || reviewFileId;
      const validReviewSessionId =
        value.reviewSessionId === undefined ||
        value.reviewSessionId === null ||
        reviewSessionId;
      if (!validReviewFileId || !validReviewSessionId) return null;
      if (reviewFileId && !reviewSessionId) return null;
      return { reviewFileId, reviewSessionId };
    }
    case "meeting": {
      if (!hasOnlyKeys(value, ["meetingRoomId", "reportId"])) return null;
      const meetingRoomId = readNullableIdentifier("meetingRoomId");
      const reportId = readNullableIdentifier("reportId");
      const validMeetingRoomId =
        value.meetingRoomId === undefined || value.meetingRoomId === null || meetingRoomId;
      const validReportId = value.reportId === undefined || value.reportId === null || reportId;
      return validMeetingRoomId && validReportId
        ? { meetingRoomId, reportId }
        : null;
    }
    case "chat": {
      if (!hasOnlyKeys(value, ["messageId", "threadId"])) return null;
      const messageId = readNullableIdentifier("messageId");
      const threadId = readNullableIdentifier("threadId");
      const validMessageId =
        value.messageId === undefined || value.messageId === null || messageId;
      const validThreadId =
        value.threadId === undefined || value.threadId === null || threadId;
      return validMessageId && validThreadId ? { messageId, threadId } : null;
    }
    case "canvas": {
      if (!hasOnlyKeys(value, ["canvasId"])) return null;
      const canvasId = readIdentifier(value.canvasId);
      return canvasId ? { canvasId } : null;
    }
    case "drive": {
      if (!hasOnlyKeys(value, ["documentId", "folderId", "pdfFileId", "pdfPage"])) {
        return null;
      }
      const documentId = readNullableIdentifier("documentId");
      const folderId = readNullableIdentifier("folderId");
      const pdfFileId = readNullableIdentifier("pdfFileId");
      const pdfPage = readNullableIdentifier("pdfPage");
      const validIds = [
        [value.documentId, documentId],
        [value.folderId, folderId],
        [value.pdfFileId, pdfFileId],
        [value.pdfPage, pdfPage],
      ].every(([raw, normalized]) => raw === undefined || raw === null || normalized);
      return validIds ? { documentId, folderId, pdfFileId, pdfPage } : null;
    }
  }
}

function isPage(value: unknown): value is WorkspacePresencePage {
  return typeof value === "string" && value in pathnamesByPage;
}

function isViewportAllowed(
  page: WorkspacePresencePage,
  viewport: WorkspacePresenceViewport,
  context: Record<string, string | null>,
  pathname: string,
) {
  switch (page) {
    case "home":
      return viewport.kind === "document";
    case "calendar":
      if (viewport.kind === "document") return context.eventId === null;
      if (viewport.kind !== "element") return false;
      if (viewport.key === "calendar-event-detail") {
        return context.selectedDate !== null && context.eventId !== null;
      }
      return (
        context.eventId === null &&
        (viewport.key === "calendar-grid" ||
          (context.selectedDate !== null && viewport.key === "calendar-events-dialog"))
      );
    case "board": {
      if (viewport.kind !== "element") return false;
      return viewport.key === "board-issue-sheet"
        ? context.issueId !== null
        : viewport.key === "board-kanban" && context.issueId === null;
    }
    case "sql-erd": {
      if (viewport.kind === "camera") {
        return (
          viewport.selectedShapeIds === undefined &&
          context.sqlErdInspectorOpen === "false"
        );
      }
      return (
        viewport.kind === "element" &&
        viewport.key === "sql-erd-inspector" &&
        context.sqlErdInspectorOpen === "true"
      );
    }
    case "canvas":
      return viewport.kind === "camera";
    case "pr-review": {
      const { reviewFileId, reviewSessionId } = context;
      if (viewport.kind === "document") {
        return reviewSessionId === null && reviewFileId === null;
      }
      if (viewport.kind === "camera") {
        return (
          viewport.selectedShapeIds === undefined &&
          reviewSessionId !== null &&
          reviewFileId === null
        );
      }
      return (
        reviewSessionId !== null &&
        reviewFileId !== null &&
        (viewport.key === "pr-review-diff" ||
          viewport.key === "pr-review-inspector")
      );
    }
    case "meeting":
      return (
        (pathname === "/meeting"
          ? context.reportId === null
          : pathname === "/report" && context.meetingRoomId === null) &&
        (viewport.kind === "document" ||
          (viewport.kind === "element" && viewport.key === "meeting-content"))
      );
    case "chat":
      return viewport.kind === "element" && viewport.key === "chat-messages";
    case "drive": {
      const { documentId, pdfFileId, pdfPage } = context;
      if (viewport.kind === "document") {
        return pdfFileId === null && pdfPage === null;
      }
      if (viewport.kind !== "element") return false;
      if (viewport.key === "drive-pdf") {
        return (
          documentId === null &&
          pdfFileId !== null &&
          pdfPage !== null &&
          /^[1-9]\d*$/.test(pdfPage)
        );
      }
      return (
        viewport.key === "drive-list" &&
        documentId === null &&
        pdfFileId === null &&
        pdfPage === null
      );
    }
  }
}

function readLocation(value: unknown): WorkspacePresenceLocation | null {
  if (!isRecord(value) || !isPage(value.page) || !isRecord(value.route)) {
    return null;
  }

  const pathname = readRequiredString(value.route.pathname);
  const search = value.route.search;
  const expectedPathnames = pathnamesByPage[value.page];
  if (
    !pathname ||
    !expectedPathnames.some(
      (expectedPathname) =>
        pathname === expectedPathname || pathname.startsWith(`${expectedPathname}/`),
    ) ||
    typeof search !== "string" ||
    search.length > MAX_SEARCH_LENGTH
  ) {
    return null;
  }

  const context = readContext(value.page, value.context);
  const viewport = readViewport(value.viewport);
  if (
    !context ||
    !viewport ||
    !isViewportAllowed(value.page, viewport, context, pathname)
  ) {
    return null;
  }

  return {
    context,
    page: value.page,
    route: { pathname, search },
    viewport:
      value.page === "canvas" && viewport.kind === "camera"
        ? { ...viewport, selectedShapeIds: viewport.selectedShapeIds ?? [] }
        : viewport,
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
