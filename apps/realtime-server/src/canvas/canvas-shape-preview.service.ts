import { createCanvasRoomName } from "../socket/room-names";
import type { RedisStateClient } from "../redis/redis-pubsub";
import type {
  CanvasRoomRef,
  CanvasShapePreviewClearPayload,
  CanvasShapePreviewEventPayload,
} from "./canvas-types";

type StoredCanvasShapePreview = CanvasShapePreviewEventPayload & {
  ownerSocketId: string;
};

export type CanvasShapePreviewService = {
  clearRoomPreview: (
    socketId: string,
    actorUserId: string,
    room: CanvasRoomRef,
    shapeIds?: string[],
  ) => Promise<CanvasShapePreviewClearPayload | null>;
  clearSocket: (socketId: string) => Promise<CanvasShapePreviewClearPayload[]>;
  getRoomPreviews: (room: CanvasRoomRef) => Promise<CanvasShapePreviewEventPayload[]>;
  updatePreview: (
    socketId: string,
    actorUserId: string,
    preview: CanvasShapePreviewEventPayload,
  ) => Promise<void>;
};

const CANVAS_SHAPE_PREVIEW_TTL_MS = 5_000;
const CANVAS_SHAPE_PREVIEW_REDIS_PREFIX = "pilo:canvas:shape-preview";

function createPreviewRedisKey(room: CanvasRoomRef, actorUserId: string) {
  return [
    CANVAS_SHAPE_PREVIEW_REDIS_PREFIX,
    encodeURIComponent(room.workspaceId),
    encodeURIComponent(room.canvasId),
    encodeURIComponent(actorUserId),
  ].join(":");
}

function createRoomPreviewRedisPattern(room: CanvasRoomRef) {
  return [
    CANVAS_SHAPE_PREVIEW_REDIS_PREFIX,
    encodeURIComponent(room.workspaceId),
    encodeURIComponent(room.canvasId),
    "*",
  ].join(":");
}

function createAllPreviewRedisPattern() {
  return `${CANVAS_SHAPE_PREVIEW_REDIS_PREFIX}:*`;
}

function uniqueShapeIds(shapeIds: string[]) {
  return Array.from(
    new Set(shapeIds.map((shapeId) => shapeId.trim()).filter(Boolean)),
  );
}

function hasPreviewPayload(preview: CanvasShapePreviewEventPayload) {
  return Boolean(preview.shapes.length || preview.deletedShapeIds?.length);
}

function prunePreviewPayload(
  preview: StoredCanvasShapePreview,
  shapeIds?: string[],
): StoredCanvasShapePreview | null {
  if (!shapeIds?.length) return null;

  const shapeIdSet = new Set(uniqueShapeIds(shapeIds));
  const nextPreview = {
    ...preview,
    deletedShapeIds: preview.deletedShapeIds?.filter(
      (shapeId) => !shapeIdSet.has(shapeId),
    ),
    shapes: preview.shapes.filter((shape) => {
      const shapeId = shape.id;

      return typeof shapeId === "string" ? !shapeIdSet.has(shapeId) : true;
    }),
  };

  return hasPreviewPayload(nextPreview) ? nextPreview : null;
}

function toPublicPreview({
  ownerSocketId: _ownerSocketId,
  ...preview
}: StoredCanvasShapePreview): CanvasShapePreviewEventPayload {
  return preview;
}

function parseStoredPreview(value: string | null): StoredCanvasShapePreview | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<StoredCanvasShapePreview>;

    if (
      typeof parsed.workspaceId !== "string" ||
      typeof parsed.canvasId !== "string" ||
      typeof parsed.actorUserId !== "string" ||
      typeof parsed.ownerSocketId !== "string" ||
      typeof parsed.phase !== "string" ||
      typeof parsed.sentAt !== "string" ||
      !Array.isArray(parsed.shapes)
    ) {
      return null;
    }

    return parsed as StoredCanvasShapePreview;
  } catch {
    return null;
  }
}

export function createCanvasShapePreviewService({
  redisClient = null,
}: {
  redisClient?: RedisStateClient | null;
} = {}): CanvasShapePreviewService {
  const previewsByRoom = new Map<string, Map<string, StoredCanvasShapePreview>>();

  function getRoomPreviewsMap(room: CanvasRoomRef) {
    const roomName = createCanvasRoomName(room);
    let roomPreviews = previewsByRoom.get(roomName);

    if (!roomPreviews) {
      roomPreviews = new Map<string, StoredCanvasShapePreview>();
      previewsByRoom.set(roomName, roomPreviews);
    }

    return roomPreviews;
  }

  function pruneExpiredRoomPreviews(room: CanvasRoomRef) {
    const roomName = createCanvasRoomName(room);
    const roomPreviews = previewsByRoom.get(roomName);

    if (!roomPreviews) return;

    const staleBefore = Date.now() - CANVAS_SHAPE_PREVIEW_TTL_MS;

    for (const [actorUserId, preview] of roomPreviews) {
      if (Date.parse(preview.sentAt) < staleBefore) {
        roomPreviews.delete(actorUserId);
      }
    }

    if (!roomPreviews.size) {
      previewsByRoom.delete(roomName);
    }
  }

  return {
    async clearRoomPreview(socketId, actorUserId, room, shapeIds) {
      if (redisClient) {
        const key = createPreviewRedisKey(room, actorUserId);
        const preview = parseStoredPreview(await redisClient.get(key));

        if (!preview || preview.ownerSocketId !== socketId) return null;

        const nextPreview = prunePreviewPayload(preview, shapeIds);

        if (nextPreview) {
          await redisClient.set(key, JSON.stringify(nextPreview), {
            px: CANVAS_SHAPE_PREVIEW_TTL_MS,
          });
        } else {
          await redisClient.del([key]);
        }

        return {
          actorUserId,
          canvasId: room.canvasId,
          shapeIds: shapeIds?.length ? uniqueShapeIds(shapeIds) : [],
          workspaceId: room.workspaceId,
        };
      }

      const roomPreviews = getRoomPreviewsMap(room);
      const preview = roomPreviews.get(actorUserId);

      if (!preview || preview.ownerSocketId !== socketId) return null;

      const nextPreview = prunePreviewPayload(preview, shapeIds);

      if (nextPreview) {
        roomPreviews.set(actorUserId, nextPreview);
      } else {
        roomPreviews.delete(actorUserId);
      }

      return {
        actorUserId,
        canvasId: room.canvasId,
        shapeIds: shapeIds?.length ? uniqueShapeIds(shapeIds) : [],
        workspaceId: room.workspaceId,
      };
    },
    async clearSocket(socketId) {
      if (redisClient) {
        const events: CanvasShapePreviewClearPayload[] = [];
        const keys = await redisClient.keys(createAllPreviewRedisPattern());
        const keysToDelete: string[] = [];

        for (const key of keys) {
          const preview = parseStoredPreview(await redisClient.get(key));

          if (!preview || preview.ownerSocketId !== socketId) continue;

          keysToDelete.push(key);
          events.push({
            actorUserId: preview.actorUserId,
            canvasId: preview.canvasId,
            shapeIds: [
              ...preview.shapes.flatMap((shape) =>
                typeof shape.id === "string" ? [shape.id] : [],
              ),
              ...(preview.deletedShapeIds ?? []),
            ],
            workspaceId: preview.workspaceId,
          });
        }

        await redisClient.del(keysToDelete);

        return events;
      }

      const events: CanvasShapePreviewClearPayload[] = [];

      for (const [roomName, roomPreviews] of previewsByRoom) {
        for (const [actorUserId, preview] of roomPreviews) {
          if (preview.ownerSocketId !== socketId) continue;

          roomPreviews.delete(actorUserId);
          events.push({
            actorUserId,
            canvasId: preview.canvasId,
            shapeIds: [
              ...preview.shapes.flatMap((shape) =>
                typeof shape.id === "string" ? [shape.id] : [],
              ),
              ...(preview.deletedShapeIds ?? []),
            ],
            workspaceId: preview.workspaceId,
          });
        }

        if (!roomPreviews.size) {
          previewsByRoom.delete(roomName);
        }
      }

      return events;
    },
    async getRoomPreviews(room) {
      if (redisClient) {
        const keys = await redisClient.keys(createRoomPreviewRedisPattern(room));
        const previews: CanvasShapePreviewEventPayload[] = [];

        for (const key of keys) {
          const preview = parseStoredPreview(await redisClient.get(key));

          if (preview) {
            previews.push(toPublicPreview(preview));
          }
        }

        return previews;
      }

      pruneExpiredRoomPreviews(room);

      return Array.from(getRoomPreviewsMap(room).values(), toPublicPreview);
    },
    async updatePreview(socketId, actorUserId, preview) {
      const storedPreview = {
        ...preview,
        ownerSocketId: socketId,
      };

      if (redisClient) {
        await redisClient.set(
          createPreviewRedisKey(preview, actorUserId),
          JSON.stringify(storedPreview),
          { px: CANVAS_SHAPE_PREVIEW_TTL_MS },
        );
        return;
      }

      getRoomPreviewsMap(preview).set(actorUserId, storedPreview);
    },
  };
}
