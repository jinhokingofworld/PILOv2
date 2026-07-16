import type {
  CanvasRoomCheckpointStatusPayload,
  CanvasRoomRef,
} from "./canvas-types";
import type {
  CanvasRoomCheckpointSnapshot,
  CanvasRoomStateService,
} from "./canvas-room-state.service";

const CANVAS_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1_000;
const CANVAS_CHECKPOINT_MAX_OPERATIONS = 100;
const SPLITTABLE_CHECKPOINT_STATUSES = new Set([400, 409, 422]);

export type CanvasRoomCheckpointService = {
  close: () => Promise<void>;
  flushCheckpointNow: (room: CanvasRoomRef, token?: string) => Promise<void>;
  scheduleCheckpoint: (room: CanvasRoomRef, token: string) => void;
};

export type CanvasRoomCheckpointServiceOptions = {
  appServerUrl: string;
  onCheckpointStatus?: (payload: CanvasRoomCheckpointStatusPayload) => void;
  roomStateService: CanvasRoomStateService;
};

function createRoomKey(room: CanvasRoomRef) {
  return `${room.workspaceId}:${room.canvasId}`;
}

async function readResponseJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function shouldCheckpoint(snapshot: CanvasRoomCheckpointSnapshot) {
  return snapshot.operations.length > 0;
}

function summarizeOperations(
  operations: CanvasRoomCheckpointSnapshot["operations"],
) {
  return operations.slice(0, 5).map((operation) => ({
    shapeId: operation.shapeId,
    type: operation.type,
  }));
}

function shouldSplitCheckpointFailure(status: number, body: unknown) {
  if (SPLITTABLE_CHECKPOINT_STATUSES.has(status)) return true;
  return status === 404 && isCanvasShapeNotFoundResponse(body);
}

function isCanvasShapeNotFoundResponse(body: unknown) {
  if (typeof body !== "object" || body === null) return false;

  const error = "error" in body ? body.error : null;

  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    error.message === "Canvas shape not found"
  );
}

function isAlreadyDeletedCheckpointFailure(
  status: number,
  body: unknown,
  operations: CanvasRoomCheckpointSnapshot["operations"],
) {
  return (
    status === 404 &&
    operations.length === 1 &&
    operations[0]?.type === "delete" &&
    isCanvasShapeNotFoundResponse(body)
  );
}

export function createCanvasRoomCheckpointService({
  appServerUrl,
  onCheckpointStatus,
  roomStateService,
}: CanvasRoomCheckpointServiceOptions): CanvasRoomCheckpointService {
  const timersByRoom = new Map<string, ReturnType<typeof setTimeout>>();
  const tokensByRoom = new Map<string, string>();
  const roomsByKey = new Map<string, CanvasRoomRef>();
  const runningCheckpointsByRoom = new Map<string, Promise<void>>();
  let isClosing = false;

  async function persistOperations(
    room: CanvasRoomRef,
    token: string,
    operations: CanvasRoomCheckpointSnapshot["operations"],
  ): Promise<{
    failures: Array<{
      body: unknown;
      operations: CanvasRoomCheckpointSnapshot["operations"];
      status: number | null;
    }>;
    successes: Array<{
      operations: CanvasRoomCheckpointSnapshot["operations"];
      result: unknown;
    }>;
  }> {
    const path = `/workspaces/${encodeURIComponent(
      room.workspaceId,
    )}/canvases/${encodeURIComponent(room.canvasId)}/shapes/batch`;

    try {
      const response = await fetch(`${appServerUrl}${path}`, {
        body: JSON.stringify({ operations }),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const responseBody = await readResponseJson(response);

      if (response.ok) {
        return {
          failures: [],
          successes: [{ operations, result: responseBody }],
        };
      }

      if (
        isAlreadyDeletedCheckpointFailure(
          response.status,
          responseBody,
          operations,
        )
      ) {
        return {
          failures: [],
          successes: [{ operations, result: responseBody }],
        };
      }

      if (
        operations.length > 1 &&
        shouldSplitCheckpointFailure(response.status, responseBody)
      ) {
        const middle = Math.ceil(operations.length / 2);
        const left = await persistOperations(
          room,
          token,
          operations.slice(0, middle),
        );
        const right = await persistOperations(
          room,
          token,
          operations.slice(middle),
        );

        return {
          failures: [...left.failures, ...right.failures],
          successes: [...left.successes, ...right.successes],
        };
      }

      return {
        failures: [
          {
            body: responseBody,
            operations,
            status: response.status,
          },
        ],
        successes: [],
      };
    } catch (error) {
      return {
        failures: [
          {
            body: error,
            operations,
            status: null,
          },
        ],
        successes: [],
      };
    }
  }

  function emitCheckpointStatus(
    room: CanvasRoomRef,
    status: CanvasRoomCheckpointStatusPayload["status"],
    pendingOperations: number,
  ) {
    const checkpointState = roomStateService.getCheckpointState(room);

    onCheckpointStatus?.({
      ...room,
      checkpointHistorySeq: checkpointState.checkpointHistorySeq,
      checkpointVersion: checkpointState.checkpointVersion,
      historySeq: checkpointState.historySeq,
      pendingOperations,
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  async function runCheckpoint(roomKey: string) {
    const room = roomsByKey.get(roomKey);
    const token = tokensByRoom.get(roomKey);

    if (!room || !token) return;

    const snapshot = roomStateService.getCheckpointSnapshot(room);

    if (!shouldCheckpoint(snapshot)) return;

    const operations = snapshot.operations.slice(
      0,
      CANVAS_CHECKPOINT_MAX_OPERATIONS,
    );

    try {
      emitCheckpointStatus(room, "saving", operations.length);
      const result = await persistOperations(room, token, operations);
      const completedAllOperations = result.failures.length === 0;

      result.successes.forEach((success, index) => {
        roomStateService.markCheckpointSucceeded(
          room,
          success.operations,
          success.result,
          {
            advanceCheckpoint:
              completedAllOperations && index === result.successes.length - 1,
          },
        );
      });

      result.failures.forEach((failure) => {
        console.warn("Canvas room checkpoint failed.", {
          body: failure.body,
          canvasId: room.canvasId,
          operationCount: failure.operations.length,
          operations: summarizeOperations(failure.operations),
          status: failure.status,
          workspaceId: room.workspaceId,
        });
      });

      const pendingOperations =
        roomStateService.getCheckpointSnapshot(room).operations.length;

      emitCheckpointStatus(
        room,
        result.failures.length ? "delayed" : "saved",
        pendingOperations,
      );
    } finally {
      if (!isClosing && roomStateService.getCheckpointSnapshot(room).operations.length) {
        scheduleRoomCheckpoint(roomKey);
      }
    }
  }

  async function flushCheckpoint(roomKey: string) {
    const runningCheckpoint = runningCheckpointsByRoom.get(roomKey);

    if (runningCheckpoint) {
      await runningCheckpoint;
      return;
    }

    const checkpoint = runCheckpoint(roomKey);

    runningCheckpointsByRoom.set(roomKey, checkpoint);

    try {
      await checkpoint;
    } finally {
      runningCheckpointsByRoom.delete(roomKey);
    }
  }

  function scheduleRoomCheckpoint(roomKey: string) {
    if (timersByRoom.has(roomKey)) return;

    timersByRoom.set(
      roomKey,
      setTimeout(() => {
        timersByRoom.delete(roomKey);
        void flushCheckpoint(roomKey);
      }, CANVAS_CHECKPOINT_INTERVAL_MS),
    );
  }

  return {
    async close() {
      isClosing = true;
      timersByRoom.forEach((timer) => {
        clearTimeout(timer);
      });
      timersByRoom.clear();
      await Promise.all(Array.from(roomsByKey.keys(), flushCheckpoint));
      tokensByRoom.clear();
      roomsByKey.clear();
      runningCheckpointsByRoom.clear();
      isClosing = false;
    },

    async flushCheckpointNow(room, token) {
      const roomKey = createRoomKey(room);

      if (isClosing) return;

      const currentTimer = timersByRoom.get(roomKey);

      if (currentTimer) {
        clearTimeout(currentTimer);
        timersByRoom.delete(roomKey);
      }

      roomsByKey.set(roomKey, room);
      if (token) {
        tokensByRoom.set(roomKey, token);
      }

      await flushCheckpoint(roomKey);
    },

    scheduleCheckpoint(room, token) {
      const roomKey = createRoomKey(room);

      if (isClosing) return;

      roomsByKey.set(roomKey, room);
      tokensByRoom.set(roomKey, token);
      scheduleRoomCheckpoint(roomKey);
    },
  };
}
