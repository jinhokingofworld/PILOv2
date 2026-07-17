import type { Server } from "socket.io";

import { isWorkspaceMembershipRevokedEvent } from "../../workspace-membership-revocation/workspace-membership-revocation";
import type { CanvasRoomCheckpointService } from "../checkpoint/canvas-room-checkpoint.service";
import type { CanvasRoomRef } from "../contracts/canvas-types";
import type { CanvasPresenceService } from "../presence/canvas-presence.service";
import type { CanvasShapePreviewService } from "../preview/canvas-shape-preview.service";
import type { CanvasShapeLockService } from "../review-lock/canvas-shape-lock.service";
import { isClassicCanvasRoomAccess } from "../room/canvas-access.service";
import { canvasServerEvents } from "./canvas-socket-events";
import type { CanvasAuthedSocket } from "./canvas-socket-types";

type CanvasLockReleasePayload = {
  canvasId: string;
  ownerUserId: string;
  shapeIds: string[];
  workspaceId: string;
};

type ClassicCanvasRoomEntry = {
  room: CanvasRoomRef;
  roomName: string;
};

export function createClassicCanvasMembershipRevocationHandler({
  emitLockReleases,
  io,
  presenceService,
  roomCheckpointService,
  shapeLockService,
  shapePreviewService,
}: {
  emitLockReleases: (payload: CanvasLockReleasePayload) => void;
  io: Server;
  presenceService: CanvasPresenceService;
  roomCheckpointService: CanvasRoomCheckpointService;
  shapeLockService: CanvasShapeLockService;
  shapePreviewService: CanvasShapePreviewService;
}) {
  return {
    async handle(payload: unknown): Promise<boolean> {
      if (!isWorkspaceMembershipRevokedEvent(payload)) return false;

      let authorizationRevoked = true;

      try {
        const results = await Promise.all(
          Array.from(io.sockets.sockets.values(), async (rawSocket) => {
            const socket = rawSocket as CanvasAuthedSocket;
            if (socket.data.auth?.userId !== payload.userId) return true;

            socket.data.revokedClassicCanvasWorkspaceIds.add(
              payload.workspaceId,
            );

            const classicRooms = getClassicCanvasRooms(
              socket,
              payload.workspaceId,
            );
            for (const { room } of classicRooms) {
              try {
                roomCheckpointService.revokeRoomAuthorization(
                  room,
                  payload.userId,
                );
              } catch {
                authorizationRevoked = false;
              }
            }
            for (const { roomName } of classicRooms) {
              socket.data.canvasRoomAccess.delete(roomName);
              socket.data.canvasRoomsByName.delete(roomName);
            }

            const cleanupResults = await Promise.allSettled(
              classicRooms.map(({ room, roomName }) =>
                cleanupClassicCanvasRoom({
                  emitLockReleases,
                  io,
                  presenceService,
                  room,
                  roomName,
                  shapeLockService,
                  shapePreviewService,
                  socket,
                }),
              ),
            );

            if (
              cleanupResults.every((result) => result.status === "fulfilled")
            ) {
              return true;
            }

            try {
              socket.disconnect(true);
              return true;
            } catch {
              return false;
            }
          }),
        );

        return authorizationRevoked && results.every(Boolean);
      } catch {
        return false;
      }
    },
  };
}

function getClassicCanvasRooms(
  socket: CanvasAuthedSocket,
  workspaceId: string,
): ClassicCanvasRoomEntry[] {
  const rooms: ClassicCanvasRoomEntry[] = [];

  for (const [roomName, room] of socket.data.canvasRoomsByName) {
    const access = socket.data.canvasRoomAccess.get(roomName);
    if (
      room.workspaceId !== workspaceId ||
      !access ||
      !isClassicCanvasRoomAccess(access)
    ) {
      continue;
    }

    rooms.push({ room, roomName });
  }

  return rooms;
}

async function cleanupClassicCanvasRoom({
  emitLockReleases,
  io,
  presenceService,
  room,
  roomName,
  shapeLockService,
  shapePreviewService,
  socket,
}: {
  emitLockReleases: (payload: CanvasLockReleasePayload) => void;
  io: Server;
  presenceService: CanvasPresenceService;
  room: CanvasRoomRef;
  roomName: string;
  shapeLockService: CanvasShapeLockService;
  shapePreviewService: CanvasShapePreviewService;
  socket: CanvasAuthedSocket;
}) {
  const leavePayload = presenceService.clearRoomPresence(socket.id, room);
  const [lockReleasePayload, previewClearPayload] = await Promise.all([
    shapeLockService.clearRoomLocks(
      socket.id,
      socket.data.auth.userId,
      room,
    ),
    shapePreviewService.clearRoomPreview(
      socket.id,
      socket.data.auth.userId,
      room,
    ),
  ]);

  await socket.leave(roomName);

  if (leavePayload) {
    io.to(roomName).emit(canvasServerEvents.presenceLeave, leavePayload);
  }
  if (lockReleasePayload) {
    emitLockReleases(lockReleasePayload);
  }
  if (previewClearPayload) {
    io.to(roomName).emit(
      canvasServerEvents.shapePreviewClear,
      previewClearPayload,
    );
  }
}
