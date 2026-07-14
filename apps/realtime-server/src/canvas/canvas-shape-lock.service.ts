import { createCanvasRoomName } from "../socket/room-names";
import type {
  CanvasRoomRef,
  CanvasShapeLockAcceptedPayload,
  CanvasShapeLockRejectedPayload,
  CanvasShapeLockReleaseEventPayload,
  CanvasShapeLockState,
} from "./canvas-types";
import type { RedisStateClient } from "../redis/redis-pubsub";

type StoredCanvasShapeLock = CanvasShapeLockState & {
  ownerSocketId: string;
};

export type CanvasShapeLockClaimResult = {
  accepted: CanvasShapeLockAcceptedPayload;
  rejected: CanvasShapeLockRejectedPayload;
};

export type CanvasShapeLockService = {
  claimLocks: (
    socketId: string,
    ownerUserId: string,
    room: CanvasRoomRef,
    shapeIds: string[],
  ) => Promise<CanvasShapeLockClaimResult>;
  clearRoomLocks: (
    socketId: string,
    ownerUserId: string,
    room: CanvasRoomRef,
    shapeIds?: string[],
  ) => Promise<CanvasShapeLockReleaseEventPayload | null>;
  clearSocket: (socketId: string) => Promise<CanvasShapeLockReleaseEventPayload[]>;
  getRoomLocks: (room: CanvasRoomRef) => Promise<CanvasShapeLockState[]>;
};

const CANVAS_SHAPE_LOCK_TTL_MS = 8_000;
const CANVAS_SHAPE_LOCK_REDIS_PREFIX = "pilo:canvas:shape-lock";

function uniqueShapeIds(shapeIds: string[]) {
  return Array.from(
    new Set(shapeIds.map((shapeId) => shapeId.trim()).filter(Boolean)),
  );
}

function getRoomName(room: CanvasRoomRef) {
  return createCanvasRoomName(room);
}

function toPublicLock({
  ownerSocketId: _ownerSocketId,
  ...lock
}: StoredCanvasShapeLock): CanvasShapeLockState {
  return lock;
}

function createLockRedisKey(room: CanvasRoomRef, shapeId: string) {
  return [
    CANVAS_SHAPE_LOCK_REDIS_PREFIX,
    encodeURIComponent(room.workspaceId),
    encodeURIComponent(room.canvasId),
    encodeURIComponent(shapeId),
  ].join(":");
}

function createRoomLockRedisPattern(room: CanvasRoomRef) {
  return [
    CANVAS_SHAPE_LOCK_REDIS_PREFIX,
    encodeURIComponent(room.workspaceId),
    encodeURIComponent(room.canvasId),
    "*",
  ].join(":");
}

function createAllLockRedisPattern() {
  return `${CANVAS_SHAPE_LOCK_REDIS_PREFIX}:*`;
}

function parseStoredLock(value: string | null): StoredCanvasShapeLock | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<StoredCanvasShapeLock>;

    if (
      typeof parsed.canvasId !== "string" ||
      typeof parsed.workspaceId !== "string" ||
      typeof parsed.shapeId !== "string" ||
      typeof parsed.ownerUserId !== "string" ||
      typeof parsed.ownerSocketId !== "string" ||
      typeof parsed.lockedAt !== "string" ||
      typeof parsed.expiresAt !== "string"
    ) {
      return null;
    }

    return parsed as StoredCanvasShapeLock;
  } catch {
    return null;
  }
}

export function createCanvasShapeLockService({
  redisClient = null,
}: {
  redisClient?: RedisStateClient | null;
} = {}): CanvasShapeLockService {
  const locksByRoom = new Map<string, Map<string, StoredCanvasShapeLock>>();

  function getMemoryRoomLocks(room: CanvasRoomRef) {
    const roomName = getRoomName(room);
    let roomLocks = locksByRoom.get(roomName);

    if (!roomLocks) {
      roomLocks = new Map<string, StoredCanvasShapeLock>();
      locksByRoom.set(roomName, roomLocks);
    }

    return roomLocks;
  }

  function pruneExpiredLocks(room: CanvasRoomRef) {
    const roomName = getRoomName(room);
    const roomLocks = locksByRoom.get(roomName);

    if (!roomLocks) return;

    const now = Date.now();

    for (const [shapeId, lock] of roomLocks) {
      if (Date.parse(lock.expiresAt) <= now) {
        roomLocks.delete(shapeId);
      }
    }

    if (roomLocks.size === 0) {
      locksByRoom.delete(roomName);
    }
  }

  return {
    async claimLocks(socketId, ownerUserId, room, shapeIds) {
      pruneExpiredLocks(room);

      const roomLocks = redisClient ? null : getMemoryRoomLocks(room);
      const acceptedLocks: CanvasShapeLockState[] = [];
      const rejectedShapeIds: string[] = [];
      const rejectedLocks: CanvasShapeLockState[] = [];
      const lockedAt = new Date();
      const expiresAt = new Date(
        lockedAt.getTime() + CANVAS_SHAPE_LOCK_TTL_MS,
      ).toISOString();

      uniqueShapeIds(shapeIds).forEach((shapeId) => {
        if (redisClient) return;

        const currentLock = roomLocks?.get(shapeId);

        if (
          currentLock &&
          currentLock.ownerSocketId !== socketId &&
          currentLock.ownerUserId !== ownerUserId
        ) {
          rejectedShapeIds.push(shapeId);
          rejectedLocks.push(toPublicLock(currentLock));
          return;
        }

        const nextLock: StoredCanvasShapeLock = {
          canvasId: room.canvasId,
          expiresAt,
          lockedAt: lockedAt.toISOString(),
          ownerSocketId: socketId,
          ownerUserId,
          shapeId,
          workspaceId: room.workspaceId,
        };

        roomLocks?.set(shapeId, nextLock);
        acceptedLocks.push(toPublicLock(nextLock));
      });

      if (redisClient) {
        for (const shapeId of uniqueShapeIds(shapeIds)) {
          const nextLock: StoredCanvasShapeLock = {
            canvasId: room.canvasId,
            expiresAt,
            lockedAt: lockedAt.toISOString(),
            ownerSocketId: socketId,
            ownerUserId,
            shapeId,
            workspaceId: room.workspaceId,
          };
          const key = createLockRedisKey(room, shapeId);
          const currentLock = parseStoredLock(await redisClient.get(key));

          if (
            currentLock &&
            currentLock.ownerSocketId !== socketId &&
            currentLock.ownerUserId !== ownerUserId
          ) {
            rejectedShapeIds.push(shapeId);
            rejectedLocks.push(toPublicLock(currentLock));
            continue;
          }

          const result = await redisClient.set(
            key,
            JSON.stringify(nextLock),
            currentLock
              ? { px: CANVAS_SHAPE_LOCK_TTL_MS }
              : { mode: "NX", px: CANVAS_SHAPE_LOCK_TTL_MS },
          );

          if (result === "OK") {
            acceptedLocks.push(toPublicLock(nextLock));
            continue;
          }

          const latestLock = parseStoredLock(await redisClient.get(key));

          if (latestLock) {
            rejectedShapeIds.push(shapeId);
            rejectedLocks.push(toPublicLock(latestLock));
          }
        }
      }

      return {
        accepted: {
          canvasId: room.canvasId,
          locks: acceptedLocks,
          workspaceId: room.workspaceId,
        },
        rejected: {
          canvasId: room.canvasId,
          locks: rejectedLocks,
          shapeIds: rejectedShapeIds,
          workspaceId: room.workspaceId,
        },
      };
    },
    async clearRoomLocks(socketId, ownerUserId, room, shapeIds) {
      if (redisClient) {
        const releaseAll = !shapeIds?.length;
        const shapeIdSet = releaseAll
          ? null
          : new Set(uniqueShapeIds(shapeIds ?? []));
        const keys = releaseAll
          ? await redisClient.keys(createRoomLockRedisPattern(room))
          : Array.from(shapeIdSet ?? []).map((shapeId) =>
              createLockRedisKey(room, shapeId),
            );
        const keysToDelete: string[] = [];
        const releasedShapeIds: string[] = [];

        for (const key of keys) {
          const lock = parseStoredLock(await redisClient.get(key));

          if (!lock) continue;
          if (
            lock.ownerSocketId !== socketId &&
            lock.ownerUserId !== ownerUserId
          ) {
            continue;
          }
          if (shapeIdSet && !shapeIdSet.has(lock.shapeId)) {
            continue;
          }

          keysToDelete.push(key);
          releasedShapeIds.push(lock.shapeId);
        }

        await redisClient.del(keysToDelete);

        if (!releasedShapeIds.length) return null;

        return {
          canvasId: room.canvasId,
          ownerUserId,
          shapeIds: releasedShapeIds,
          workspaceId: room.workspaceId,
        };
      }

      const roomName = getRoomName(room);
      const roomLocks = locksByRoom.get(roomName);

      if (!roomLocks) return null;

      const releaseAll = !shapeIds?.length;
      const shapeIdSet = releaseAll
        ? null
        : new Set(uniqueShapeIds(shapeIds ?? []));
      const releasedShapeIds: string[] = [];

      for (const [shapeId, lock] of roomLocks) {
        if (lock.ownerSocketId !== socketId && lock.ownerUserId !== ownerUserId) {
          continue;
        }

        if (shapeIdSet && !shapeIdSet.has(shapeId)) {
          continue;
        }

        roomLocks.delete(shapeId);
        releasedShapeIds.push(shapeId);
      }

      if (roomLocks.size === 0) {
        locksByRoom.delete(roomName);
      }

      if (!releasedShapeIds.length) return null;

      return {
        canvasId: room.canvasId,
        ownerUserId,
        shapeIds: releasedShapeIds,
        workspaceId: room.workspaceId,
      };
    },
    async clearSocket(socketId) {
      if (redisClient) {
        const releaseEventsByRoom = new Map<
          string,
          CanvasShapeLockReleaseEventPayload
        >();
        const keys = await redisClient.keys(createAllLockRedisPattern());
        const keysToDelete: string[] = [];

        for (const key of keys) {
          const lock = parseStoredLock(await redisClient.get(key));

          if (!lock || lock.ownerSocketId !== socketId) continue;

          const roomName = getRoomName(lock);
          const currentEvent = releaseEventsByRoom.get(roomName) ?? {
            canvasId: lock.canvasId,
            ownerUserId: lock.ownerUserId,
            shapeIds: [],
            workspaceId: lock.workspaceId,
          };

          currentEvent.shapeIds.push(lock.shapeId);
          releaseEventsByRoom.set(roomName, currentEvent);
          keysToDelete.push(key);
        }

        await redisClient.del(keysToDelete);

        return Array.from(releaseEventsByRoom.values());
      }

      const releaseEvents: CanvasShapeLockReleaseEventPayload[] = [];

      for (const [roomName, roomLocks] of locksByRoom) {
        const releasedShapeIds: string[] = [];
        const [, workspaceId, , canvasId] = roomName.split(":");
        let ownerUserId = "";

        for (const [shapeId, lock] of roomLocks) {
          if (lock.ownerSocketId !== socketId) continue;

          roomLocks.delete(shapeId);
          ownerUserId = lock.ownerUserId;
          releasedShapeIds.push(shapeId);
        }

        if (roomLocks.size === 0) {
          locksByRoom.delete(roomName);
        }

        if (!releasedShapeIds.length) continue;

        releaseEvents.push({
          canvasId: canvasId ?? "",
          ownerUserId,
          shapeIds: releasedShapeIds,
          workspaceId: workspaceId ?? "",
        });
      }

      return releaseEvents;
    },
    async getRoomLocks(room) {
      if (redisClient) {
        const keys = await redisClient.keys(createRoomLockRedisPattern(room));
        const locks: CanvasShapeLockState[] = [];

        for (const key of keys) {
          const lock = parseStoredLock(await redisClient.get(key));

          if (lock) {
            locks.push(toPublicLock(lock));
          }
        }

        return locks;
      }

      pruneExpiredLocks(room);

      return Array.from(getMemoryRoomLocks(room).values(), toPublicLock);
    },
  };
}
