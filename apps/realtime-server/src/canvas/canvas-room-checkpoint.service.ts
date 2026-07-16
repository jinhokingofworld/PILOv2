import type { CanvasRoomRef } from "./canvas-types";
import type {
  CanvasRoomCheckpointSnapshot,
  CanvasRoomStateService,
} from "./canvas-room-state.service";

const CANVAS_CHECKPOINT_DELAY_MS = 3_000;
const CANVAS_CHECKPOINT_MAX_OPERATIONS = 100;

export type CanvasRoomCheckpointService = {
  close: () => Promise<void>;
  flushCheckpointNow: (room: CanvasRoomRef, token?: string) => Promise<void>;
  scheduleCheckpoint: (room: CanvasRoomRef, token: string) => void;
};

export type CanvasRoomCheckpointServiceOptions = {
  appServerUrl: string;
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

export function createCanvasRoomCheckpointService({
  appServerUrl,
  roomStateService,
}: CanvasRoomCheckpointServiceOptions): CanvasRoomCheckpointService {
  const timersByRoom = new Map<string, ReturnType<typeof setTimeout>>();
  const tokensByRoom = new Map<string, string>();
  const roomsByKey = new Map<string, CanvasRoomRef>();
  const runningRooms = new Set<string>();
  let isClosing = false;

  async function flushCheckpoint(roomKey: string) {
    if (runningRooms.has(roomKey)) return;

    const room = roomsByKey.get(roomKey);
    const token = tokensByRoom.get(roomKey);

    if (!room || !token) return;

    const snapshot = roomStateService.getCheckpointSnapshot(room);

    if (!shouldCheckpoint(snapshot)) return;

    runningRooms.add(roomKey);

    const operations = snapshot.operations.slice(0, CANVAS_CHECKPOINT_MAX_OPERATIONS);
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

      if (!response.ok) {
        console.warn("Canvas room checkpoint failed.", {
          body: responseBody,
          canvasId: room.canvasId,
          status: response.status,
          workspaceId: room.workspaceId,
        });
        return;
      }

      roomStateService.markCheckpointSucceeded(room, operations);
    } catch (error) {
      console.warn("Canvas room checkpoint failed.", error);
    } finally {
      runningRooms.delete(roomKey);

      if (!isClosing && roomStateService.getCheckpointSnapshot(room).operations.length) {
        scheduleRoomCheckpoint(roomKey);
      }
    }
  }

  function scheduleRoomCheckpoint(roomKey: string) {
    const currentTimer = timersByRoom.get(roomKey);

    if (currentTimer) {
      clearTimeout(currentTimer);
    }

    timersByRoom.set(
      roomKey,
      setTimeout(() => {
        timersByRoom.delete(roomKey);
        void flushCheckpoint(roomKey);
      }, CANVAS_CHECKPOINT_DELAY_MS),
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
      runningRooms.clear();
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
