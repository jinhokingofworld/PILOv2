export type CanvasFreeformShapeSnapshot = {
  id?: unknown;
  type?: unknown;
  x?: unknown;
  y?: unknown;
  rotation?: unknown;
  props?: unknown;
  [key: string]: unknown;
};

export type CanvasShapePayload = {
  id: string;
  shapeType: string;
  title: string | null;
  textContent: string | null;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  rotation: number;
  zIndex: number;
  rawShape: Record<string, unknown>;
};

export type CanvasShapeApiClient = {
  syncShapesBatch?: (
    boardId: string,
    body: { operations: CanvasShapeSyncOperation[] },
    options: { workspaceId: string },
  ) => Promise<unknown>;
  createShape: (
    boardId: string,
    body: CanvasShapePayload,
    options: { workspaceId: string },
  ) => Promise<unknown>;
  updateShape: (
    shapeId: string,
    body: CanvasShapePayload,
    options: { workspaceId: string },
  ) => Promise<unknown>;
  deleteShape: (
    shapeId: string,
    options: { workspaceId: string },
  ) => Promise<unknown>;
};

export type CanvasShapeSyncOperation =
  | {
      type: "create";
      shapeId: string;
      payload: CanvasShapePayload;
    }
  | {
      type: "update";
      shapeId: string;
      payload: CanvasShapePayload;
    }
  | {
      type: "delete";
      shapeId: string;
    };

export type CanvasShapeSyncQueue = {
  cancel: () => void;
  enqueue: (input: {
    previousShapes: CanvasFreeformShapeSnapshot[];
    nextShapes: CanvasFreeformShapeSnapshot[];
  }) => void;
  flush: () => Promise<void>;
  size: () => number;
};

type CanvasShapeSyncQueueOptions = {
  boardId: string;
  canvasClient: CanvasShapeApiClient;
  debounceMs?: number;
  onError?: (error: unknown) => void;
  workspaceId: string;
};

const DEFAULT_CANVAS_SHAPE_SYNC_QUEUE_DEBOUNCE_MS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNullableSize(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function cloneRawShape(shape: CanvasFreeformShapeSnapshot) {
  return JSON.parse(JSON.stringify(shape)) as Record<string, unknown>;
}

function shapeSnapshotKey(shape: CanvasFreeformShapeSnapshot) {
  return JSON.stringify(shape);
}

function toShapeMap(shapes: CanvasFreeformShapeSnapshot[]) {
  return new Map(
    shapes
      .filter((shape) => typeof shape.id === "string")
      .map((shape) => [shape.id as string, shape]),
  );
}

export function toCanvasShapePayload(
  shape: CanvasFreeformShapeSnapshot,
  zIndex: number,
): CanvasShapePayload {
  const props = isRecord(shape.props) ? shape.props : {};
  const title =
    typeof props.name === "string"
      ? props.name
      : typeof props.fileName === "string"
        ? props.fileName
        : null;
  const textContent =
    typeof props.text === "string"
      ? props.text
      : typeof props.code === "string"
        ? props.code
        : null;

  return {
    id: typeof shape.id === "string" ? shape.id : "",
    shapeType: typeof shape.type === "string" ? shape.type : "",
    title,
    textContent,
    x: readFiniteNumber(shape.x, 0),
    y: readFiniteNumber(shape.y, 0),
    width: readNullableSize(props.w),
    height: readNullableSize(props.h),
    rotation: readFiniteNumber(shape.rotation, 0),
    zIndex,
    rawShape: cloneRawShape(shape),
  };
}

export function buildCanvasShapeSyncOperations(
  previousShapes: CanvasFreeformShapeSnapshot[],
  nextShapes: CanvasFreeformShapeSnapshot[],
): CanvasShapeSyncOperation[] {
  const previousShapeMap = toShapeMap(previousShapes);
  const nextShapeMap = toShapeMap(nextShapes);
  const operations: CanvasShapeSyncOperation[] = [];

  nextShapes.forEach((shape, zIndex) => {
    if (typeof shape.id !== "string") return;

    const previousShape = previousShapeMap.get(shape.id);
    const payload = toCanvasShapePayload(shape, zIndex);

    if (!previousShape) {
      operations.push({
        type: "create",
        shapeId: shape.id,
        payload,
      });
      return;
    }

    if (shapeSnapshotKey(previousShape) !== shapeSnapshotKey(shape)) {
      operations.push({
        type: "update",
        shapeId: shape.id,
        payload,
      });
    }
  });

  previousShapes.forEach((shape) => {
    if (typeof shape.id !== "string") return;
    if (nextShapeMap.has(shape.id)) return;

    operations.push({
      type: "delete",
      shapeId: shape.id,
    });
  });

  return operations;
}

function mergeQueuedCanvasShapeSyncOperation(
  pendingOperations: Map<string, CanvasShapeSyncOperation>,
  operation: CanvasShapeSyncOperation,
) {
  const pendingOperation = pendingOperations.get(operation.shapeId);

  if (!pendingOperation) {
    pendingOperations.set(operation.shapeId, operation);
    return;
  }

  if (operation.type === "create") {
    pendingOperations.set(
      operation.shapeId,
      pendingOperation.type === "create"
        ? operation
        : {
            type: "update",
            shapeId: operation.shapeId,
            payload: operation.payload,
          },
    );
    return;
  }

  if (operation.type === "update") {
    pendingOperations.set(
      operation.shapeId,
      pendingOperation.type === "create"
        ? {
            type: "create",
            shapeId: operation.shapeId,
            payload: operation.payload,
          }
        : operation,
    );
    return;
  }

  if (pendingOperation.type === "create") {
    pendingOperations.delete(operation.shapeId);
    return;
  }

  pendingOperations.set(operation.shapeId, operation);
}

function runCanvasShapeSyncOperation({
  boardId,
  canvasClient,
  operation,
  workspaceId,
}: {
  boardId: string;
  canvasClient: CanvasShapeApiClient;
  operation: CanvasShapeSyncOperation;
  workspaceId: string;
}) {
  if (operation.type === "create") {
    return canvasClient.createShape(boardId, operation.payload, {
      workspaceId,
    });
  }

  if (operation.type === "update") {
    return canvasClient.updateShape(operation.shapeId, operation.payload, {
      workspaceId,
    });
  }

  return canvasClient.deleteShape(operation.shapeId, {
    workspaceId,
  });
}

async function runCanvasShapeSyncOperations({
  boardId,
  canvasClient,
  operations,
  workspaceId,
}: {
  boardId: string;
  canvasClient: CanvasShapeApiClient;
  operations: CanvasShapeSyncOperation[];
  workspaceId: string;
}) {
  if (canvasClient.syncShapesBatch) {
    await canvasClient.syncShapesBatch(
      boardId,
      {
        operations,
      },
      {
        workspaceId,
      },
    );
    return;
  }

  await Promise.all(
    operations.map((operation) =>
      runCanvasShapeSyncOperation({
        boardId,
        canvasClient,
        operation,
        workspaceId,
      }),
    ),
  );
}

export function createCanvasShapeSyncQueue({
  boardId,
  canvasClient,
  debounceMs = DEFAULT_CANVAS_SHAPE_SYNC_QUEUE_DEBOUNCE_MS,
  onError,
  workspaceId,
}: CanvasShapeSyncQueueOptions): CanvasShapeSyncQueue {
  const pendingOperations = new Map<string, CanvasShapeSyncOperation>();
  let flushPromise: Promise<void> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function clearFlushTimer() {
    if (!flushTimer) return;

    clearTimeout(flushTimer);
    flushTimer = null;
  }

  async function flushPendingOperations(): Promise<void> {
    const operations = Array.from(pendingOperations.values());

    pendingOperations.clear();

    if (!operations.length) return;

    await runCanvasShapeSyncOperations({
      boardId,
      canvasClient,
      operations,
      workspaceId,
    });

    if (pendingOperations.size) {
      await flushPendingOperations();
    }
  }

  function flush() {
    clearFlushTimer();

    if (!flushPromise) {
      flushPromise = flushPendingOperations()
        .catch((error: unknown) => {
          if (pendingOperations.size) {
            scheduleFlush();
          }

          throw error;
        })
        .finally(() => {
          flushPromise = null;
        });
    }

    return flushPromise;
  }

  function scheduleFlush() {
    clearFlushTimer();

    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush().catch(onError);
    }, debounceMs);
  }

  return {
    cancel() {
      clearFlushTimer();
      pendingOperations.clear();
    },
    enqueue({ previousShapes, nextShapes }) {
      const operations = buildCanvasShapeSyncOperations(
        previousShapes,
        nextShapes,
      );

      operations.forEach((operation) => {
        mergeQueuedCanvasShapeSyncOperation(pendingOperations, operation);
      });

      if (pendingOperations.size) {
        scheduleFlush();
      }
    },
    flush,
    size() {
      return pendingOperations.size;
    },
  };
}

export async function syncCanvasFreeformShapes({
  boardId,
  canvasClient,
  nextShapes,
  previousShapes,
  workspaceId,
}: {
  boardId: string;
  canvasClient: CanvasShapeApiClient;
  nextShapes: CanvasFreeformShapeSnapshot[];
  previousShapes: CanvasFreeformShapeSnapshot[];
  workspaceId: string;
}) {
  const operations = buildCanvasShapeSyncOperations(previousShapes, nextShapes);

  await runCanvasShapeSyncOperations({
    boardId,
    canvasClient,
    operations,
    workspaceId,
  });
}
