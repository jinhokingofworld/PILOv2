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

export type SqlErdPresenceClearResult =
  | {
      kind: "leave";
      payload: SqlErdPresenceLeavePayload;
    }
  | {
      kind: "update";
      presence: SqlErdPresenceState;
    };

export type SqlErdPresenceService = {
  clearRoomPresence: (
    socketId: string,
    room: SqlErdRoomRef,
  ) => SqlErdPresenceClearResult | null;
  clearSocket: (socketId: string) => SqlErdPresenceClearResult[];
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

  function toPresenceState({ socketId: _socketId, ...presence }: StoredPresence) {
    return presence;
  }

  function getLatestUserPresence(
    roomPresence: Map<string, StoredPresence>,
    userId: string,
  ) {
    let latestPresence: StoredPresence | null = null;

    for (const presence of roomPresence.values()) {
      if (presence.userId === userId) latestPresence = presence;
    }

    return latestPresence;
  }

  function getClearResult(
    room: SqlErdRoomRef,
    roomPresence: Map<string, StoredPresence>,
    removedPresence: StoredPresence,
  ): SqlErdPresenceClearResult {
    const replacementPresence = getLatestUserPresence(
      roomPresence,
      removedPresence.userId,
    );

    if (replacementPresence) {
      return {
        kind: "update",
        presence: toPresenceState(replacementPresence),
      };
    }

    return {
      kind: "leave",
      payload: {
        ...room,
        userId: removedPresence.userId,
      },
    };
  }

  return {
    clearRoomPresence(socketId, room) {
      const roomName = createSqlErdRoomName(room);
      const roomPresence = presenceByRoom.get(roomName);

      if (!roomPresence) {
        return null;
      }

      const presence = roomPresence.get(socketId);
      if (!presence) return null;

      roomPresence.delete(socketId);
      const clearResult = getClearResult(room, roomPresence, presence);
      if (roomPresence.size === 0) presenceByRoom.delete(roomName);

      return clearResult;
    },
    clearSocket(socketId) {
      const clearResults: SqlErdPresenceClearResult[] = [];

      for (const [roomName, roomPresence] of presenceByRoom) {
        const presence = roomPresence.get(socketId);
        if (!presence) continue;

        roomPresence.delete(socketId);
        clearResults.push(
          getClearResult(
            {
              sessionId: presence.sessionId,
              workspaceId: presence.workspaceId,
            },
            roomPresence,
            presence,
          ),
        );

        if (roomPresence.size === 0) {
          presenceByRoom.delete(roomName);
        }
      }

      return clearResults;
    },
    getPresence(room) {
      const roomPresence = presenceByRoom.get(createSqlErdRoomName(room));

      if (!roomPresence) {
        return [];
      }

      const presenceByUserId = new Map<string, SqlErdPresenceState>();

      for (const presence of roomPresence.values()) {
        presenceByUserId.set(presence.userId, toPresenceState(presence));
      }

      return [...presenceByUserId.values()];
    },
    updatePresence(socketId, user, payload) {
      const state: StoredPresence = {
        cursor: payload.cursor,
        displayName: user.displayName,
        editingMode: payload.editingMode,
        selectedObjects: payload.selectedObjects,
        sessionId: payload.sessionId,
        sentAt: payload.sentAt,
        socketId,
        tool: payload.tool,
        updatedAt: new Date().toISOString(),
        userId: user.userId,
        workspaceId: payload.workspaceId,
      };

      const roomPresence = getOrCreateRoomPresence(payload);
      roomPresence.delete(socketId);
      roomPresence.set(socketId, state);

      return toPresenceState(state);
    },
  };
}
