export const SQL_ERD_TABLE_MOVE_PREVIEW_INTERVAL_MS = 33;

type TimerHandle = ReturnType<typeof setTimeout>;

type SqlErdTableMovePreviewThrottleOptions<Payload> = {
  cancelSchedule?: (handle: TimerHandle) => void;
  emit: (payload: Payload) => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => TimerHandle;
};

export type SqlErdTableMovePreviewThrottle<Payload> = {
  cancel: () => void;
  push: (payload: Payload) => void;
};

type SqlErdTablePosition = { x: number; y: number };

type SqlErdRemoteTableMovePreview = SqlErdTablePosition & {
  actorUserId: string;
  dragId: string;
  sentAt: string;
  tableId: string;
};

export type SqlErdRemoteTableMovePreviewState = {
  actorUserId: string;
  basePosition: SqlErdTablePosition;
  dragId: string;
};

export type SqlErdTableMoveCommit = {
  actorUserId: string;
  dragId: string;
  tableIds: string[];
};

export function isSqlErdTableMovePreviewEnabled(
  writeProtocol: "operations_v1" | "snapshot"
) {
  return writeProtocol === "operations_v1";
}

export function shouldClearSqlErdTableMovePreviewAfterDrop(
  durablePatchScheduled: boolean | void
) {
  return durablePatchScheduled === false;
}

export function createSqlErdTableMoveCompletionKey(
  actorUserId: string,
  tableId: string,
  dragId: string
) {
  return `${actorUserId}\u0000${tableId}\u0000${dragId}`;
}

function readTableIdsFromLayoutPatch(patch: Record<string, unknown>) {
  const tableLayouts = patch.tableLayouts;
  if (
    typeof tableLayouts !== "object" ||
    tableLayouts === null ||
    Array.isArray(tableLayouts)
  ) {
    return [];
  }
  const upsert = (tableLayouts as Record<string, unknown>).upsert;
  if (!Array.isArray(upsert)) return [];

  return Array.from(
    new Set(
      upsert.flatMap((entry) => {
        if (
          typeof entry !== "object" ||
          entry === null ||
          Array.isArray(entry)
        ) {
          return [];
        }
        const tableId = (entry as Record<string, unknown>).tableId;
        return typeof tableId === "string" && tableId.trim()
          ? [tableId.trim()]
          : [];
      })
    )
  );
}

export function getSqlErdTableMoveCommit(operation: {
  actorUserId: string;
  clientOperationId: string;
  patch?: Record<string, unknown>;
  type: string;
}): SqlErdTableMoveCommit | null {
  if (operation.type !== "layout_patch" || !operation.patch) return null;
  const tableIds = readTableIdsFromLayoutPatch(operation.patch);
  if (!tableIds.length) return null;

  return {
    actorUserId: operation.actorUserId,
    dragId: operation.clientOperationId,
    tableIds
  };
}

export function resolveSqlErdRemoteTableMovePreview({
  canonicalPosition,
  completedDragKeys = new Set<string>(),
  currentPosition,
  preview,
  previousState
}: {
  canonicalPosition: SqlErdTablePosition | null;
  completedDragKeys?: ReadonlySet<string>;
  currentPosition: SqlErdTablePosition;
  preview: SqlErdRemoteTableMovePreview | null;
  previousState: SqlErdRemoteTableMovePreviewState | null;
}) {
  if (!preview) {
    return {
      dismissPreview: null,
      nextState: null,
      position: canonicalPosition ?? previousState?.basePosition ?? currentPosition
    };
  }

  if (
    completedDragKeys.has(
      createSqlErdTableMoveCompletionKey(
        preview.actorUserId,
        preview.tableId,
        preview.dragId
      )
    )
  ) {
    return {
      dismissPreview: {
        actorUserId: preview.actorUserId,
        dragId: preview.dragId,
        sentAt: preview.sentAt,
        tableId: preview.tableId
      },
      nextState: null,
      position: canonicalPosition ?? previousState?.basePosition ?? currentPosition
    };
  }

  const basePosition =
    previousState?.actorUserId === preview.actorUserId &&
    previousState.dragId === preview.dragId
      ? previousState.basePosition
      : canonicalPosition ?? currentPosition;

  return {
    dismissPreview: null,
    nextState: {
      actorUserId: preview.actorUserId,
      basePosition,
      dragId: preview.dragId
    },
    position: { x: preview.x, y: preview.y }
  };
}

export function createSqlErdTableMovePreviewThrottle<Payload>({
  cancelSchedule = clearTimeout,
  emit,
  now = Date.now,
  schedule = setTimeout
}: SqlErdTableMovePreviewThrottleOptions<Payload>): SqlErdTableMovePreviewThrottle<Payload> {
  let lastEmittedAt = Number.NEGATIVE_INFINITY;
  let pendingPayload: Payload | null = null;
  let timer: TimerHandle | null = null;

  const flush = () => {
    timer = null;
    if (pendingPayload === null) return;

    const payload = pendingPayload;
    pendingPayload = null;
    lastEmittedAt = now();
    emit(payload);
  };

  return {
    cancel() {
      pendingPayload = null;
      if (timer !== null) {
        cancelSchedule(timer);
        timer = null;
      }
    },
    push(payload) {
      const elapsed = now() - lastEmittedAt;
      if (elapsed >= SQL_ERD_TABLE_MOVE_PREVIEW_INTERVAL_MS) {
        if (timer !== null) {
          cancelSchedule(timer);
          timer = null;
        }
        pendingPayload = null;
        lastEmittedAt = now();
        emit(payload);
        return;
      }

      pendingPayload = payload;
      if (timer !== null) return;

      timer = schedule(
        flush,
        SQL_ERD_TABLE_MOVE_PREVIEW_INTERVAL_MS - elapsed
      );
    }
  };
}
