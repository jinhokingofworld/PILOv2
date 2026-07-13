import { createCanvasRoomName } from "../socket/room-names";
import type {
  CanvasRoomRef,
  CanvasShapeLockAcceptedPayload,
  CanvasShapeLockRejectedPayload,
  CanvasShapeLockReleaseEventPayload,
  CanvasShapeLockState,
} from "./canvas-types";

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
  ) => CanvasShapeLockClaimResult;
  clearRoomLocks: (
    socketId: string,
    ownerUserId: string,
    room: CanvasRoomRef,
    shapeIds?: string[],
  ) => CanvasShapeLockReleaseEventPayload | null;
  clearSocket: (socketId: string) => CanvasShapeLockReleaseEventPayload[];
};

const CANVAS_SHAPE_LOCK_TTL_MS = 8_000;

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

export function createCanvasShapeLockService(): CanvasShapeLockService {
  const locksByRoom = new Map<string, Map<string, StoredCanvasShapeLock>>();

  function getRoomLocks(room: CanvasRoomRef) {
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
    claimLocks(socketId, ownerUserId, room, shapeIds) {
      pruneExpiredLocks(room);

      const roomLocks = getRoomLocks(room);
      const acceptedLocks: CanvasShapeLockState[] = [];
      const rejectedShapeIds: string[] = [];
      const rejectedLocks: CanvasShapeLockState[] = [];
      const lockedAt = new Date();
      const expiresAt = new Date(
        lockedAt.getTime() + CANVAS_SHAPE_LOCK_TTL_MS,
      ).toISOString();

      uniqueShapeIds(shapeIds).forEach((shapeId) => {
        const currentLock = roomLocks.get(shapeId);

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

        roomLocks.set(shapeId, nextLock);
        acceptedLocks.push(toPublicLock(nextLock));
      });

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
    clearRoomLocks(socketId, ownerUserId, room, shapeIds) {
      const roomName = getRoomName(room);
      const roomLocks = locksByRoom.get(roomName);

      if (!roomLocks) return null;

      const releaseAll = !shapeIds?.length;
      const shapeIdSet = releaseAll ? null : new Set(uniqueShapeIds(shapeIds));
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
    clearSocket(socketId) {
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
  };
}
