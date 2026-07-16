import type {
  CanvasPresenceLeavePayload,
  CanvasPresenceState,
  CanvasPresenceUpdatePayload,
  CanvasPresenceUser,
  CanvasRoomRef,
} from "../contracts/canvas-types";
import { createCanvasRoomName } from "../../socket/room-names";

type StoredPresence = CanvasPresenceState & {
  socketId: string;
};

export type CanvasPresenceService = {
  clearRoomPresence: (
    socketId: string,
    room: CanvasRoomRef,
  ) => CanvasPresenceLeavePayload | null;
  clearSocket: (socketId: string) => CanvasPresenceLeavePayload[];
  getPresence: (room: CanvasRoomRef) => CanvasPresenceState[];
  updatePresence: (
    socketId: string,
    user: CanvasPresenceUser,
    payload: CanvasPresenceUpdatePayload,
  ) => CanvasPresenceState;
};

export function createCanvasPresenceService(): CanvasPresenceService {
  const presenceByRoom = new Map<string, Map<string, StoredPresence>>();

  function getRoomPresence(room: CanvasRoomRef) {
    const roomName = createCanvasRoomName(room);
    let roomPresence = presenceByRoom.get(roomName);

    if (!roomPresence) {
      roomPresence = new Map<string, StoredPresence>();
      presenceByRoom.set(roomName, roomPresence);
    }

    return roomPresence;
  }

  return {
    clearRoomPresence(socketId, room) {
      const roomPresence = getRoomPresence(room);

      for (const [userId, presence] of roomPresence) {
        if (presence.socketId !== socketId) continue;

        roomPresence.delete(userId);

        return {
          canvasId: room.canvasId,
          userId,
          workspaceId: room.workspaceId,
        };
      }

      return null;
    },
    clearSocket(socketId) {
      const leaveEvents: CanvasPresenceLeavePayload[] = [];

      for (const [roomName, roomPresence] of presenceByRoom) {
        for (const [userId, presence] of roomPresence) {
          if (presence.socketId !== socketId) continue;

          roomPresence.delete(userId);

          const [, workspaceId, , canvasId] = roomName.split(":");
          leaveEvents.push({
            canvasId: canvasId ?? "",
            userId,
            workspaceId: workspaceId ?? "",
          });
        }

        if (roomPresence.size === 0) {
          presenceByRoom.delete(roomName);
        }
      }

      return leaveEvents;
    },
    getPresence(room) {
      return [...getRoomPresence(room).values()].map(
        ({ socketId: _socketId, ...presence }) => presence,
      );
    },
    updatePresence(socketId, user, payload) {
      const state: StoredPresence = {
        canvasId: payload.canvasId,
        cursor: payload.cursor,
        ...(user.displayName ? { displayName: user.displayName } : {}),
        editingMode: payload.editingMode ?? null,
        editingShapeId: payload.editingShapeId ?? null,
        selectedShapeIds: payload.selectedShapeIds,
        ...(payload.sentAt ? { sentAt: payload.sentAt } : {}),
        socketId,
        updatedAt: new Date().toISOString(),
        userId: user.userId,
        ...(payload.viewport ? { viewport: payload.viewport } : {}),
        workspaceId: payload.workspaceId,
      };

      getRoomPresence(payload).set(user.userId, state);

      const { socketId: _socketId, ...presence } = state;
      return presence;
    },
  };
}
