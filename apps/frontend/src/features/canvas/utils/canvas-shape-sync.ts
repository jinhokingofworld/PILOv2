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
  baseRevision?: number | null;
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
    body: { baseRevision: number | null; clientOperationId: string },
    options: { workspaceId: string },
  ) => Promise<unknown>;
};

export type CanvasShapeSyncOperation =
  | {
      baseRevision?: number | null;
      clientOperationId: string;
      type: "create";
      shapeId: string;
      payload: CanvasShapePayload;
    }
  | {
      baseRevision: number | null;
      clientOperationId: string;
      type: "update";
      shapeId: string;
      payload: CanvasShapePayload;
    }
  | {
      baseRevision: number | null;
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

export type CanvasShapeSyncConflict = {
  baseRevision: number | null;
  currentRevision: number | null;
  failedOperations: CanvasShapeSyncOperation[];
  latestOperation: unknown;
  latestShape: unknown;
  operation: CanvasShapeSyncOperation;
  shapeId: string;
};

export type CanvasShapeSyncResult = {
  shapeRevisions: Map<string, number>;
};

type CanvasShapeSyncQueueOptions = {
  boardId: string;
  canvasClient: CanvasShapeApiClient;
  debounceMs?: number;
  getBaseRevision?: (shapeId: string) => number | null;
  onConflict?: (conflict: CanvasShapeSyncConflict) => void;
  onError?: (error: unknown) => void;
  onSynced?: (
    operations: CanvasShapeSyncOperation[],
    result: CanvasShapeSyncResult,
  ) => void;
  workspaceId: string;
};

const DEFAULT_CANVAS_SHAPE_SYNC_QUEUE_DEBOUNCE_MS = 500;
const DEFAULT_CANVAS_SHAPE_SYNC_RETRY_ATTEMPTS = 3;
const DEFAULT_CANVAS_SHAPE_SYNC_RETRY_DELAY_MS = 320;
const DEFAULT_CANVAS_SHAPE_SYNC_BATCH_SIZE = 100;
const NON_RETRYABLE_CANVAS_API_STATUSES = new Set([400, 401, 403, 404, 409]);

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

function readCanvasApiErrorStatus(error: unknown) {
  return isRecord(error) && typeof error.status === "number"
    ? error.status
    : null;
}

function readCanvasApiErrorBody(error: unknown) {
  return isRecord(error) ? error.body : null;
}

function isNonRetryableCanvasApiError(error: unknown) {
  const status = readCanvasApiErrorStatus(error);

  return status !== null && NON_RETRYABLE_CANVAS_API_STATUSES.has(status);
}

function isMissingCanvasApiError(error: unknown) {
  return readCanvasApiErrorStatus(error) === 404;
}

function readCanvasShapeRevision(shape: CanvasFreeformShapeSnapshot | undefined) {
  const revision = shape?.revision;

  return typeof revision === "number" && Number.isInteger(revision) && revision > 0
    ? revision
    : null;
}

function resolveCanvasShapeBaseRevision({
  getBaseRevision,
  shape,
  shapeId,
}: {
  getBaseRevision?: (shapeId: string) => number | null;
  shape: CanvasFreeformShapeSnapshot | undefined;
  shapeId: string;
}) {
  if (!getBaseRevision) return null;

  const localRevision = readCanvasShapeRevision(shape);
  const remoteRevision = getBaseRevision(shapeId);

  if (localRevision === null) return remoteRevision;
  if (remoteRevision === null) return localRevision;

  return Math.max(localRevision, remoteRevision);
}

function isStaleMissingShapeOperation(
  error: unknown,
  operation: CanvasShapeSyncOperation,
) {
  return operation.type !== "create" && isMissingCanvasApiError(error);
}

function isNonRetryableCanvasShapeSyncError(error: unknown) {
  if (isNonRetryableCanvasApiError(error)) {
    return true;
  }

  return (
    error instanceof CanvasShapeSyncFailure &&
    isNonRetryableCanvasApiError(error.cause)
  );
}

function readCanvasConflictDetails(error: unknown) {
  if (readCanvasApiErrorStatus(error) !== 409) return null;

  const body = readCanvasApiErrorBody(error);
  const nestedError = isRecord(body) ? body.error : null;
  const details = isRecord(nestedError)
    ? nestedError.details
    : isRecord(body)
      ? body.details
      : null;

  return isRecord(details) ? details : null;
}

function readInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readShapeRevisionEntry(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  const revision = readInteger(value.revision);

  if (revision === null || revision <= 0) {
    return null;
  }

  return {
    revision,
    shapeId: value.id,
  };
}

function mergeCanvasShapeSyncResults(
  target: CanvasShapeSyncResult,
  source: CanvasShapeSyncResult,
) {
  source.shapeRevisions.forEach((revision, shapeId) => {
    target.shapeRevisions.set(
      shapeId,
      Math.max(target.shapeRevisions.get(shapeId) ?? 0, revision),
    );
  });

  return target;
}

function readCanvasShapeSyncResult(value: unknown): CanvasShapeSyncResult {
  const result: CanvasShapeSyncResult = {
    shapeRevisions: new Map<string, number>(),
  };

  if (!isRecord(value)) {
    return result;
  }

  const shapeEntries = [
    ...(Array.isArray(value.shapes) ? value.shapes : []),
    ...(Array.isArray(value.deletedShapes) ? value.deletedShapes : []),
    value,
  ];

  shapeEntries.forEach((entry) => {
    const revisionEntry = readShapeRevisionEntry(entry);

    if (!revisionEntry) return;

    result.shapeRevisions.set(
      revisionEntry.shapeId,
      Math.max(
        result.shapeRevisions.get(revisionEntry.shapeId) ?? 0,
        revisionEntry.revision,
      ),
    );
  });

  return result;
}

export function readCanvasShapeSyncConflict(
  error: unknown,
): CanvasShapeSyncConflict | null {
  const cause =
    error instanceof CanvasShapeSyncFailure ? error.cause : error;
  const failedOperations =
    error instanceof CanvasShapeSyncFailure ? error.failedOperations : [];
  const details = readCanvasConflictDetails(cause);
  const operation = failedOperations[0];

  if (!details || !operation) return null;

  return {
    baseRevision: readInteger(details.baseRevision),
    currentRevision: readInteger(details.currentRevision),
    failedOperations,
    latestOperation: details.latestOperation ?? null,
    latestShape: details.latestShape ?? null,
    operation,
    shapeId:
      typeof details.shapeId === "string" && details.shapeId
        ? details.shapeId
        : operation.shapeId,
  };
}

export function isCanvasShapeSyncConflictError(error: unknown) {
  return readCanvasShapeSyncConflict(error) !== null;
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

function readRichTextPlainText(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.content)) return null;

  const paragraphs = value.content.flatMap((block) => {
    if (!isRecord(block) || !Array.isArray(block.content)) return [];

    return block.content.flatMap((node) =>
      isRecord(node) && typeof node.text === "string" ? [node.text] : [],
    );
  });

  return paragraphs.length ? paragraphs.join("\n") : null;
}

function resolveParentShapeId(parentId: unknown) {
  return typeof parentId === "string" && parentId.startsWith("shape:")
    ? parentId
    : null;
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
        : readRichTextPlainText(props.richText);

  return {
    id: typeof shape.id === "string" ? shape.id : "",
    parentShapeId: resolveParentShapeId(shape.parentId),
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
  options: {
    getBaseRevision?: (shapeId: string) => number | null;
  } = {},
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
        baseRevision: null,
        clientOperationId: createCanvasClientOperationId(),
        type: "create",
        shapeId: shape.id,
        payload,
      });
      return;
    }

    if (hasCanvasFreeformShapeChanged(previousShape, shape)) {
      operations.push({
        baseRevision: resolveCanvasShapeBaseRevision({
          getBaseRevision: options.getBaseRevision,
          shape: previousShape,
          shapeId: shape.id,
        }),
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
      baseRevision: resolveCanvasShapeBaseRevision({
        getBaseRevision: options.getBaseRevision,
        shape,
        shapeId: shape.id,
      }),
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
            baseRevision:
              pendingOperation.baseRevision ?? operation.baseRevision ?? null,
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
            baseRevision: null,
            clientOperationId: pendingOperation.clientOperationId,
            type: "create",
            shapeId: operation.shapeId,
            payload: operation.payload,
          }
        : {
            ...operation,
            baseRevision:
              pendingOperation.baseRevision ?? operation.baseRevision,
          },
    );
    return;
  }

  if (pendingOperation.type === "create") {
    pendingOperations.delete(operation.shapeId);
    return;
  }

  pendingOperations.set(operation.shapeId, {
    ...operation,
    baseRevision: pendingOperation.baseRevision ?? operation.baseRevision,
  });
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
}): Promise<unknown> {
  if (operation.type === "create") {
    return canvasClient.createShape(
      boardId,
      {
        ...operation.payload,
        baseRevision: operation.baseRevision ?? null,
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
        baseRevision: operation.baseRevision,
        clientOperationId: operation.clientOperationId,
      },
      {
        workspaceId,
      },
    );
  }

  return canvasClient.deleteShape(
    operation.shapeId,
    {
      baseRevision: operation.baseRevision,
      clientOperationId: operation.clientOperationId,
    },
    {
      workspaceId,
    },
  );
}

function runWithRetry(task: () => Promise<unknown>) {
  return pRetry(task, {
    factor: 2,
    minTimeout: DEFAULT_CANVAS_SHAPE_SYNC_RETRY_DELAY_MS,
    retries: DEFAULT_CANVAS_SHAPE_SYNC_RETRY_ATTEMPTS,
    shouldRetry({ error }) {
      return !isNonRetryableCanvasApiError(error);
    },
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
}): Promise<CanvasShapeSyncResult> {
  const result: CanvasShapeSyncResult = {
    shapeRevisions: new Map<string, number>(),
  };

  if (!operations.length) {
    return result;
  }

  const syncShapesBatch = canvasClient.syncShapesBatch;

  if (syncShapesBatch) {
    const runSyncShapesBatch = syncShapesBatch;

    async function runBatchOperationsIndividually(
      batchOperations: CanvasShapeSyncOperation[],
    ) {
      for (let index = 0; index < batchOperations.length; index += 1) {
        const operation = batchOperations[index];

        try {
          await runWithRetry(async () => {
            const response = await runSyncShapesBatch(
              boardId,
              {
                operations: [operation],
              },
              {
                workspaceId,
              },
            );

            mergeCanvasShapeSyncResults(
              result,
              readCanvasShapeSyncResult(response),
            );
          });
        } catch (error) {
          if (isStaleMissingShapeOperation(error, operation)) {
            continue;
          }

          throw new CanvasShapeSyncFailure(
            error,
            batchOperations.slice(index),
          );
        }
      }
    }

    for (
      let index = 0;
      index < operations.length;
      index += DEFAULT_CANVAS_SHAPE_SYNC_BATCH_SIZE
    ) {
      const batchOperations = operations.slice(
        index,
        index + DEFAULT_CANVAS_SHAPE_SYNC_BATCH_SIZE,
      );

      try {
        await runWithRetry(async () => {
          const response = await runSyncShapesBatch(
            boardId,
            {
              operations: batchOperations,
            },
            {
              workspaceId,
            },
          );

          mergeCanvasShapeSyncResults(
            result,
            readCanvasShapeSyncResult(response),
          );
        });
      } catch (error) {
        if (
          batchOperations.length > 1 &&
          isNonRetryableCanvasApiError(error)
        ) {
          try {
            await runBatchOperationsIndividually(batchOperations);
            continue;
          } catch (fallbackError) {
            if (fallbackError instanceof CanvasShapeSyncFailure) {
              throw fallbackError;
            }
          }
        }

        throw new CanvasShapeSyncFailure(error, operations.slice(index));
      }
    }

    return result;
  }

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];

    try {
      await runWithRetry(async () => {
        const response = await runCanvasShapeSyncOperation({
          boardId,
          canvasClient,
          operation,
          workspaceId,
        });

        mergeCanvasShapeSyncResults(
          result,
          readCanvasShapeSyncResult(response),
        );
      });
    } catch (error) {
      throw new CanvasShapeSyncFailure(error, operations.slice(index));
    }
  }

  return result;
}

export function createCanvasShapeSyncQueue({
  boardId,
  canvasClient,
  debounceMs = DEFAULT_CANVAS_SHAPE_SYNC_QUEUE_DEBOUNCE_MS,
  getBaseRevision,
  onConflict,
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
      const result = await runCanvasShapeSyncOperations({
        boardId,
        canvasClient,
        operations,
        workspaceId,
      });
      onSynced?.(operations, result);
    } catch (error) {
      const conflict = readCanvasShapeSyncConflict(error);

      if (conflict) {
        onConflict?.(conflict);
      }

      if (isNonRetryableCanvasShapeSyncError(error)) {
        pendingOperations.clear();
        throw error;
      }

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
        { getBaseRevision },
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
  getBaseRevision,
  nextShapes,
  onConflict,
  previousShapes,
  workspaceId,
}: {
  boardId: string;
  canvasClient: CanvasShapeApiClient;
  getBaseRevision?: (shapeId: string) => number | null;
  nextShapes: CanvasFreeformShapeSnapshot[];
  onConflict?: (conflict: CanvasShapeSyncConflict) => void;
  previousShapes: CanvasFreeformShapeSnapshot[];
  workspaceId: string;
}) {
  const operations = buildCanvasShapeSyncOperations(previousShapes, nextShapes, {
    getBaseRevision,
  });

  try {
    return await runCanvasShapeSyncOperations({
      boardId,
      canvasClient,
      operations,
      workspaceId,
    });
  } catch (error) {
    const conflict = readCanvasShapeSyncConflict(error);

    if (conflict) {
      onConflict?.(conflict);
    }

    throw error;
  }
}
