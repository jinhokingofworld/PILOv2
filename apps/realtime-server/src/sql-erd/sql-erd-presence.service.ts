import { createSqlErdRoomName } from "../socket/room-names";
import type {
  SqlErdPresenceLeavePayload,
  SqlErdPresenceState,
  SqlErdPresenceUpdatePayload,
  SqlErdPresenceUser,
  SqlErdRoomRef,
} from "./sql-erd-types";

type StoredPresence = SqlErdPresenceState & {
  socketId: string;
};

export type SqlErdPresenceService = {
  clearRoomPresence: (
    socketId: string,
    room: SqlErdRoomRef,
  ) => SqlErdPresenceLeavePayload | null;
  clearSocket: (socketId: string) => SqlErdPresenceLeavePayload[];
  getPresence: (room: SqlErdRoomRef) => SqlErdPresenceState[];
  updatePresence: (
    socketId: string,
    user: SqlErdPresenceUser,
    payload: SqlErdPresenceUpdatePayload,
  ) => SqlErdPresenceState;
};

export function createSqlErdPresenceService(): SqlErdPresenceService {
  const presenceByRoom = new Map<string, Map<string, StoredPresence>>();

  function getOrCreateRoomPresence(room: SqlErdRoomRef) {
    const roomName = createSqlErdRoomName(room);
    let roomPresence = presenceByRoom.get(roomName);

    if (!roomPresence) {
      roomPresence = new Map<string, StoredPresence>();
      presenceByRoom.set(roomName, roomPresence);
    }

    return roomPresence;
  }

  return {
    clearRoomPresence(socketId, room) {
      const roomName = createSqlErdRoomName(room);
      const roomPresence = presenceByRoom.get(roomName);

      if (!roomPresence) {
        return null;
      }

      for (const [userId, presence] of roomPresence) {
        if (presence.socketId !== socketId) continue;

        roomPresence.delete(userId);
        if (roomPresence.size === 0) {
          presenceByRoom.delete(roomName);
        }

        return { ...room, userId };
      }

      return null;
    },
    clearSocket(socketId) {
      const leaveEvents: SqlErdPresenceLeavePayload[] = [];

      for (const [roomName, roomPresence] of presenceByRoom) {
        for (const [userId, presence] of roomPresence) {
          if (presence.socketId !== socketId) continue;

          roomPresence.delete(userId);
          const [, workspaceId, , sessionId] = roomName.split(":");
          leaveEvents.push({
            sessionId: sessionId ?? "",
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
      const roomPresence = presenceByRoom.get(createSqlErdRoomName(room));

      if (!roomPresence) {
        return [];
      }

      return [...roomPresence.values()].map(
        ({ socketId: _socketId, ...presence }) => presence,
      );
    },
    updatePresence(socketId, user, payload) {
      const state: StoredPresence = {
        cursor: payload.cursor,
        ...(user.displayName ? { displayName: user.displayName } : {}),
        selectedShapeIds: payload.selectedShapeIds,
        sessionId: payload.sessionId,
        socketId,
        tool: payload.tool,
        updatedAt: new Date().toISOString(),
        userId: user.userId,
        workspaceId: payload.workspaceId,
      };

      getOrCreateRoomPresence(payload).set(user.userId, state);

      const { socketId: _socketId, ...presence } = state;
      return presence;
    },
  };
}
