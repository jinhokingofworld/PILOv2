import type { SqlErdSelection } from "./types";

type Camera = { x: number; y: number; z: number };

type InspectorScrollMetrics = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

type SqlErdLocationLike = {
  context: Record<string, string | null | undefined>;
  page: string;
  viewport: {
    kind: string;
    key?: string;
    x?: number;
    xRatio?: number;
    y?: number;
    yRatio?: number;
    z?: number;
  };
};

export const SQL_ERD_INSPECTOR_SURFACE_KEY = "sql-erd-inspector";

function normalizedId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function inspectorRatio(metrics: InspectorScrollMetrics) {
  const range = Math.max(metrics.scrollHeight - metrics.clientHeight, 0);
  return range
    ? Math.min(Math.max(metrics.scrollTop / range, 0), 1)
    : 0;
}

function selectionContext(selection: SqlErdSelection) {
  if (selection.type === "none") {
    return {
      sqlErdSelectionId: null,
      sqlErdSelectionTableId: null,
      sqlErdSelectionType: "none",
    };
  }

  if (selection.type === "column") {
    return {
      sqlErdSelectionId: selection.columnId,
      sqlErdSelectionTableId: selection.tableId,
      sqlErdSelectionType: selection.type,
    };
  }

  const id =
    selection.type === "table"
      ? selection.tableId
      : selection.type === "relation"
        ? selection.relationId
        : selection.type === "annotation"
          ? selection.annotationId
          : selection.type === "note"
            ? selection.noteId
            : selection.type === "frame"
              ? selection.frameId
              : selection.textId;
  return {
    sqlErdSelectionId: id,
    sqlErdSelectionTableId: null,
    sqlErdSelectionType: selection.type,
  };
}

function readSelection(
  context: Record<string, string | null | undefined>,
): SqlErdSelection | null {
  const type = context.sqlErdSelectionType ?? "none";
  const id = normalizedId(context.sqlErdSelectionId);
  if (type === "none") return { type: "none" };
  if (!id) return null;
  if (type === "table") return { type, tableId: id };
  if (type === "relation") return { type, relationId: id };
  if (type === "annotation") return { type, annotationId: id };
  if (type === "note") return { type, noteId: id };
  if (type === "frame") return { type, frameId: id };
  if (type === "text") return { type, textId: id };
  if (type === "column") {
    const tableId = normalizedId(context.sqlErdSelectionTableId);
    return tableId ? { type, tableId, columnId: id } : null;
  }
  return null;
}

export function createSqlErdWorkspaceLocation(
  sessionId: string,
  camera: Camera,
  selection: SqlErdSelection = { type: "none" },
) {
  return {
    context: {
      sessionId,
      sqlErdInspectorOpen: "false",
      ...selectionContext(selection),
    },
    page: "sql-erd" as const,
    route: {
      pathname: "/sql-erd/session",
      search: `?sessionId=${encodeURIComponent(sessionId)}`,
    },
    viewport: { kind: "camera" as const, ...camera },
  };
}

export function createSqlErdInspectorWorkspaceLocation({
  metrics,
  selection,
  sessionId,
}: {
  metrics: InspectorScrollMetrics;
  selection: SqlErdSelection;
  sessionId: string;
}) {
  return {
    context: {
      sessionId,
      sqlErdInspectorOpen: "true",
      ...selectionContext(selection),
    },
    page: "sql-erd" as const,
    route: {
      pathname: "/sql-erd/session",
      search: `?sessionId=${encodeURIComponent(sessionId)}`,
    },
    viewport: {
      kind: "element" as const,
      key: SQL_ERD_INSPECTOR_SURFACE_KEY,
      xRatio: 0,
      yRatio: inspectorRatio(metrics),
    },
  };
}

export function readSqlErdCamera(
  location: {
    context: Record<string, string | null | undefined>;
    viewport: { kind: string; x?: number; y?: number; z?: number };
  },
  sessionId: string,
): Camera | null {
  const { viewport } = location;
  if (
    location.context.sessionId !== sessionId ||
    viewport.kind !== "camera" ||
    !Number.isFinite(viewport.x) ||
    !Number.isFinite(viewport.y) ||
    !Number.isFinite(viewport.z)
  ) {
    return null;
  }
  return { x: viewport.x!, y: viewport.y!, z: viewport.z! };
}

export function readSqlErdWorkspaceTarget(
  location: SqlErdLocationLike,
  sessionId: string,
) {
  if (
    location.page !== "sql-erd" ||
    normalizedId(location.context.sessionId) !== normalizedId(sessionId)
  ) {
    return null;
  }
  const selection = readSelection(location.context);
  if (!selection) return null;

  const { viewport } = location;
  if (
    viewport.kind === "element" &&
    viewport.key === SQL_ERD_INSPECTOR_SURFACE_KEY &&
    location.context.sqlErdInspectorOpen === "true" &&
    Number.isFinite(viewport.xRatio) &&
    Number.isFinite(viewport.yRatio)
  ) {
    return {
      inspectorOpen: true as const,
      selection,
      surface: "inspector" as const,
      viewport: {
        kind: "element" as const,
        key: SQL_ERD_INSPECTOR_SURFACE_KEY,
        xRatio: viewport.xRatio!,
        yRatio: viewport.yRatio!,
      },
    };
  }

  const camera = readSqlErdCamera(location, sessionId);
  if (!camera) return null;
  return {
    camera,
    inspectorOpen: false as const,
    selection,
    surface: "canvas" as const,
  };
}

export function getSqlErdInspectorScrollOffset(
  viewport: { yRatio: number },
  metrics: Omit<InspectorScrollMetrics, "scrollTop">,
) {
  return {
    top:
      Math.min(Math.max(viewport.yRatio, 0), 1) *
      Math.max(metrics.scrollHeight - metrics.clientHeight, 0),
  };
}

function waitForNextPoll(signal: AbortSignal, intervalMs: number) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timerId);
      resolve(false);
    };
    const timerId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, intervalMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForSqlErdInspectorTarget<T>({
  findTarget,
  intervalMs = 16,
  signal,
  timeoutMs = 1_000,
}: {
  findTarget: () => T | null;
  intervalMs?: number;
  signal: AbortSignal;
  timeoutMs?: number;
}) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (signal.aborted) return null;
    const target = findTarget();
    if (target) return target;
    if (Date.now() >= deadline) return null;
  } while (await waitForNextPoll(signal, intervalMs));
  return null;
}
