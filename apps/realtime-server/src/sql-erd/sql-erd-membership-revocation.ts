import type { RealtimeDatabase } from "../database/database";
import { createSqlErdRoomName } from "../socket/room-names";
import {
  isWorkspaceMembershipRevokedEvent,
  type WorkspaceMembershipRevokedEventV1,
} from "../workspace-membership-revocation/workspace-membership-revocation";
import {
  type SqlErdPresenceClearResult,
  type SqlErdPresenceService,
} from "./sql-erd-presence.service";
import { sqlErdServerEvents } from "./sql-erd-socket-events";
import type { SqlErdPresenceState, SqlErdRoomRef } from "./sql-erd-types";

type SqlErdMembershipSocket = {
  data: {
    auth?: {
      userId?: unknown;
    };
    sqlErdPresenceByRoom?: Record<string, SqlErdPresenceState>;
    sqlErdRevokedWorkspaceIds?: Set<string>;
    sqlErdRoomsByName?: Map<string, SqlErdRoomRef>;
  };
  disconnect: (close?: boolean) => unknown;
  id: string;
  leave: (roomName: string) => Promise<unknown> | unknown;
  to: (roomName: string) => {
    emit: (event: string, payload: unknown) => unknown;
  };
};

type SqlErdMembershipIo = {
  sockets: {
    sockets: {
      values: () => IterableIterator<unknown>;
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSqlErdMembershipSocket(
  value: unknown,
): value is SqlErdMembershipSocket {
  if (!isRecord(value) || !isRecord(value.data)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.disconnect === "function" &&
    typeof value.leave === "function" &&
    typeof value.to === "function"
  );
}

function readLocalSockets(
  io: SqlErdMembershipIo,
): SqlErdMembershipSocket[] | null {
  try {
    return [...io.sockets.sockets.values()].filter(isSqlErdMembershipSocket);
  } catch {
    return null;
  }
}

function emitPresenceClearResult(
  socket: SqlErdMembershipSocket,
  clearResult: SqlErdPresenceClearResult,
) {
  if (clearResult.kind === "update") {
    socket
      .to(createSqlErdRoomName(clearResult.presence))
      .emit(sqlErdServerEvents.presenceUpdate, clearResult.presence);
    return;
  }

  socket
    .to(createSqlErdRoomName(clearResult.payload))
    .emit(sqlErdServerEvents.presenceLeave, clearResult.payload);
}

function disconnectSocket(socket: SqlErdMembershipSocket): boolean {
  try {
    socket.disconnect(true);
    return true;
  } catch {
    return false;
  }
}

export async function evictSqlErdSocketFromRooms(
  socket: SqlErdMembershipSocket,
  roomNames: readonly string[],
): Promise<boolean> {
  const results = await Promise.allSettled(
    roomNames.map((roomName) => socket.leave(roomName)),
  );

  if (results.every((result) => result.status === "fulfilled")) return true;
  return disconnectSocket(socket);
}

async function deleteSourceLocks(
  database: Pick<RealtimeDatabase, "execute">,
  event: WorkspaceMembershipRevokedEventV1,
): Promise<boolean> {
  try {
    await database.execute(
      `DELETE FROM sql_erd_session_source_locks
       WHERE workspace_id = $1
         AND actor_user_id = $2`,
      [event.workspaceId, event.userId],
    );
    return true;
  } catch {
    return false;
  }
}

export function createSqlErdMembershipRevocationHandler({
  database,
  io,
  presenceService,
}: {
  database: Pick<RealtimeDatabase, "execute">;
  io: SqlErdMembershipIo;
  presenceService: SqlErdPresenceService;
}) {
  return {
    async handle(payload: unknown): Promise<boolean> {
      if (!isWorkspaceMembershipRevokedEvent(payload)) return false;

      const localSockets = readLocalSockets(io);
      if (!localSockets) {
        await deleteSourceLocks(database, payload);
        return false;
      }

      const targetSockets = localSockets.filter(
        (socket) => socket.data.auth?.userId === payload.userId,
      );
      const roomsToLeave = new Map<SqlErdMembershipSocket, string[]>();
      const finalPresenceClearByRoom = new Map<
        string,
        { clearResult: SqlErdPresenceClearResult; socket: SqlErdMembershipSocket }
      >();

      for (const socket of targetSockets) {
        const revokedWorkspaceIds =
          socket.data.sqlErdRevokedWorkspaceIds ?? new Set<string>();
        socket.data.sqlErdRevokedWorkspaceIds = revokedWorkspaceIds;
        revokedWorkspaceIds.add(payload.workspaceId);
        const joinedRooms = socket.data.sqlErdRoomsByName;
        if (!joinedRooms) continue;

        for (const [roomName, room] of joinedRooms) {
          if (room.workspaceId !== payload.workspaceId) continue;

          const clearResult = presenceService.clearRoomPresence(socket.id, room);
          if (clearResult) {
            finalPresenceClearByRoom.set(roomName, { clearResult, socket });
          }
          delete socket.data.sqlErdPresenceByRoom?.[roomName];
          joinedRooms.delete(roomName);

          const socketRooms = roomsToLeave.get(socket) ?? [];
          socketRooms.push(roomName);
          roomsToLeave.set(socket, socketRooms);
        }
      }

      let emittedPresenceCleanup = true;
      for (const { clearResult, socket } of finalPresenceClearByRoom.values()) {
        try {
          emitPresenceClearResult(socket, clearResult);
        } catch {
          emittedPresenceCleanup = false;
        }
      }

      const [sourceLocksDeleted, ...leaveResults] = await Promise.all([
        deleteSourceLocks(database, payload),
        ...[...roomsToLeave].map(([socket, roomNames]) =>
          evictSqlErdSocketFromRooms(socket, roomNames),
        ),
      ]);

      return (
        emittedPresenceCleanup &&
        sourceLocksDeleted &&
        leaveResults.every(Boolean)
      );
    },
  };
}
