import diff from "microdiff";
import PQueue from "p-queue";
import pRetry from "p-retry";

export type CanvasFreeformShapeSnapshot = {
  id?: unknown;
  parentId?: unknown;
  type?: unknown;
  x?: unknown;
  y?: unknown;
  rotation?: unknown;
  props?: unknown;
  [key: string]: unknown;
};

export type CanvasShapePayload = {
  id: string;
  parentShapeId: string | null;
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
  contentHash?: string;
  revision?: number;
};

type CanvasShapeMutationPayload = CanvasShapePayload & {
  clientOperationId?: string;
};

export type CanvasShapeApiClient = {
  syncShapesBatch?: (
    boardId: string,
    body: { operations: CanvasShapeSyncOperation[] },
    options: { workspaceId: string },
  ) => Promise<unknown>;
  createShape: (
    boardId: string,
    body: CanvasShapeMutationPayload,
    options: { workspaceId: string },
  ) => Promise<unknown>;
  updateShape: (
    shapeId: string,
    body: CanvasShapeMutationPayload,
    options: { workspaceId: string },
  ) => Promise<unknown>;
  deleteShape: (
    shapeId: string,
    options: { workspaceId: string },
  ) => Promise<unknown>;
};

export type CanvasShapeSyncOperation =
  | {
      clientOperationId: string;
      type: "create";
      shapeId: string;
      payload: CanvasShapePayload;
    }
  | {
      clientOperationId: string;
      type: "update";
      shapeId: string;
      payload: CanvasShapePayload;
    }
  | {
      clientOperationId: string;
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
  whenIdle: () => Promise<void>;
};

type CanvasShapeSyncQueueOptions = {
  boardId: string;
  canvasClient: CanvasShapeApiClient;
  debounceMs?: number;
  onError?: (error: unknown) => void;
  onSynced?: (operations: CanvasShapeSyncOperation[]) => void;
  workspaceId: string;
};

const DEFAULT_CANVAS_SHAPE_SYNC_QUEUE_DEBOUNCE_MS = 500;
const DEFAULT_CANVAS_SHAPE_SYNC_RETRY_ATTEMPTS = 3;
const DEFAULT_CANVAS_SHAPE_SYNC_RETRY_DELAY_MS = 320;

class CanvasShapeSyncFailure extends Error {
  readonly cause: unknown;
  readonly failedOperations: CanvasShapeSyncOperation[];

  constructor(error: unknown, failedOperations: CanvasShapeSyncOperation[]) {
    super("Canvas shape sync failed");
    this.name = "CanvasShapeSyncFailure";
    this.cause = error;
    this.failedOperations = failedOperations;
  }
}

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

function createCanvasClientOperationId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function hasCanvasFreeformShapeChanged(
  previousShape: CanvasFreeformShapeSnapshot,
  nextShape: CanvasFreeformShapeSnapshot,
) {
  return diff(previousShape, nextShape).length > 0;
}

export function areCanvasFreeformShapesEqual(
  previousShapes: CanvasFreeformShapeSnapshot[],
  nextShapes: CanvasFreeformShapeSnapshot[],
) {
  if (previousShapes.length !== nextShapes.length) {
    return false;
  }

  for (let index = 0; index < previousShapes.length; index += 1) {
    const previousShape = previousShapes[index];
    const nextShape = nextShapes[index];

    if (previousShape?.id !== nextShape?.id) {
      return false;
    }

    if (hasCanvasFreeformShapeChanged(previousShape, nextShape)) {
      return false;
    }
  }

  return true;
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
    parentShapeId: typeof shape.parentId === "string" ? shape.parentId : null,
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
        clientOperationId: createCanvasClientOperationId(),
        type: "create",
        shapeId: shape.id,
        payload,
      });
      return;
    }

    if (hasCanvasFreeformShapeChanged(previousShape, shape)) {
      operations.push({
        clientOperationId: createCanvasClientOperationId(),
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
      clientOperationId: createCanvasClientOperationId(),
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
            clientOperationId: operation.clientOperationId,
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
            clientOperationId: pendingOperation.clientOperationId,
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
    return canvasClient.createShape(
      boardId,
      {
        ...operation.payload,
        clientOperationId: operation.clientOperationId,
      },
      {
        workspaceId,
      },
    );
  }

  if (operation.type === "update") {
    return canvasClient.updateShape(
      operation.shapeId,
      {
        ...operation.payload,
        clientOperationId: operation.clientOperationId,
      },
      {
        workspaceId,
      },
    );
  }

  return canvasClient.deleteShape(operation.shapeId, {
    workspaceId,
  });
}

function runWithRetry(task: () => Promise<unknown>) {
  return pRetry(task, {
    factor: 2,
    minTimeout: DEFAULT_CANVAS_SHAPE_SYNC_RETRY_DELAY_MS,
    retries: DEFAULT_CANVAS_SHAPE_SYNC_RETRY_ATTEMPTS,
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
  if (!operations.length) {
    return;
  }

  const syncShapesBatch = canvasClient.syncShapesBatch;

  if (syncShapesBatch) {
    try {
      await runWithRetry(async () => {
        await syncShapesBatch(
          boardId,
          {
            operations,
          },
          {
            workspaceId,
          },
        );
      });
    } catch (error) {
      throw new CanvasShapeSyncFailure(error, operations);
    }
    return;
  }

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];

    try {
      await runWithRetry(async () => {
        await runCanvasShapeSyncOperation({
          boardId,
          canvasClient,
          operation,
          workspaceId,
        });
      });
    } catch (error) {
      throw new CanvasShapeSyncFailure(error, operations.slice(index));
    }
  }
}

export function createCanvasShapeSyncQueue({
  boardId,
  canvasClient,
  debounceMs = DEFAULT_CANVAS_SHAPE_SYNC_QUEUE_DEBOUNCE_MS,
  onError,
  onSynced,
  workspaceId,
}: CanvasShapeSyncQueueOptions): CanvasShapeSyncQueue {
  const pendingOperations = new Map<string, CanvasShapeSyncOperation>();
  const requestQueue = new PQueue({ concurrency: 1 });
  const idleWaiters: Array<{
    reject: (error: unknown) => void;
    resolve: () => void;
  }> = [];
  let flushPromise: Promise<void> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function clearFlushTimer() {
    if (!flushTimer) return;

    clearTimeout(flushTimer);
    flushTimer = null;
  }

  function isIdle() {
    return (
      pendingOperations.size === 0 &&
      !flushTimer &&
      !flushPromise &&
      requestQueue.size === 0 &&
      requestQueue.pending === 0
    );
  }

  function resolveIdleWaiters() {
    if (!isIdle()) return;

    const waiters = idleWaiters.splice(0);

    waiters.forEach((waiter) => waiter.resolve());
  }

  function rejectIdleWaiters(error: unknown) {
    const waiters = idleWaiters.splice(0);

    waiters.forEach((waiter) => waiter.reject(error));
  }

  async function flushPendingOperations(): Promise<void> {
    const operations = Array.from(pendingOperations.values());

    pendingOperations.clear();

    if (!operations.length) return;

    try {
      await runCanvasShapeSyncOperations({
        boardId,
        canvasClient,
        operations,
        workspaceId,
      });
      onSynced?.(operations);
    } catch (error) {
      const queuedDuringFlush = Array.from(pendingOperations.values());
      const failedOperations =
        error instanceof CanvasShapeSyncFailure
          ? error.failedOperations
          : operations;

      pendingOperations.clear();
      failedOperations.forEach((operation) => {
        mergeQueuedCanvasShapeSyncOperation(pendingOperations, operation);
      });
      queuedDuringFlush.forEach((operation) => {
        mergeQueuedCanvasShapeSyncOperation(pendingOperations, operation);
      });

      throw error;
    }

    if (pendingOperations.size) {
      await flushPendingOperations();
    }
  }

  function flush() {
    clearFlushTimer();

    if (!flushPromise) {
      flushPromise = requestQueue
        .add(() => flushPendingOperations())
        .catch((error: unknown) => {
          if (pendingOperations.size) {
            scheduleFlush();
          } else {
            rejectIdleWaiters(error);
          }

          throw error;
        })
        .finally(() => {
          flushPromise = null;
          resolveIdleWaiters();
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
      requestQueue.clear();
      pendingOperations.clear();
      resolveIdleWaiters();
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
      return pendingOperations.size + requestQueue.size + requestQueue.pending;
    },
    whenIdle() {
      if (isIdle()) return Promise.resolve();

      return new Promise<void>((resolve, reject) => {
        idleWaiters.push({ reject, resolve });
      });
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
