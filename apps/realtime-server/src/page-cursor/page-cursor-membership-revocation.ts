import {
  disconnectMembershipSocket,
  isWorkspaceMembershipRevokedEvent,
  readAuthenticatedMembershipUserId,
} from "../workspace-membership-revocation/workspace-membership-revocation";
import { pageCursorServerEvents } from "./page-cursor-events";
import type { PageCursorPresenceState } from "./page-cursor-types";

export type PageCursorMembershipSocket = {
  data: {
    auth?: {
      userId?: unknown;
    };
    pageCursorPresenceByRoom?: Record<string, PageCursorPresenceState>;
  };
  disconnect: (close?: boolean) => unknown;
  id: string;
  leave: (roomName: string) => Promise<unknown> | unknown;
  rooms: ReadonlySet<string>;
  to: (roomName: string) => {
    emit: (event: string, payload: unknown) => unknown;
  };
};

type PageCursorMembershipIo = {
  sockets: {
    sockets: ReadonlyMap<string, PageCursorMembershipSocket>;
  };
};

function isTargetPageCursorRoom(roomName: string, workspaceId: string) {
  return roomName.startsWith(`workspace:${workspaceId}:page:`);
}

export async function evictPageCursorSocketFromRooms(
  socket: PageCursorMembershipSocket,
  roomNames: readonly string[],
): Promise<boolean> {
  const results = await Promise.allSettled(
    roomNames.map((roomName) =>
      Promise.resolve().then(() => socket.leave(roomName)),
    ),
  );

  if (results.every((result) => result.status === "fulfilled")) return true;
  return disconnectMembershipSocket(socket);
}

export function createPageCursorMembershipRevocationHandler({
  io,
}: {
  io: PageCursorMembershipIo;
}) {
  return {
    async handle(payload: unknown): Promise<boolean> {
      if (!isWorkspaceMembershipRevokedEvent(payload)) return false;

      try {
        const results = await Promise.all(
          [...io.sockets.sockets.values()].map(async (socket) => {
            if (readAuthenticatedMembershipUserId(socket) !== payload.userId) {
              return true;
            }

            const presenceByRoom = socket.data.pageCursorPresenceByRoom ?? {};
            const roomNames = new Set(
              [...socket.rooms, ...Object.keys(presenceByRoom)].filter((roomName) =>
                isTargetPageCursorRoom(roomName, payload.workspaceId),
              ),
            );
            let emittedPresenceCleanup = true;

            for (const roomName of roomNames) {
              const presence = presenceByRoom[roomName];
              delete presenceByRoom[roomName];
              if (!presence || presence.workspaceId !== payload.workspaceId) {
                continue;
              }
              try {
                socket.to(roomName).emit(pageCursorServerEvents.leave, {
                  ...(presence.boardId ? { boardId: presence.boardId } : {}),
                  page: presence.page,
                  userId: presence.userId,
                  workspaceId: presence.workspaceId,
                });
              } catch {
                emittedPresenceCleanup = false;
              }
            }

            const safelyEvicted = await evictPageCursorSocketFromRooms(
              socket,
              [...roomNames],
            );
            return emittedPresenceCleanup && safelyEvicted;
          }),
        );
        return results.every(Boolean);
      } catch {
        return false;
      }
    },
  };
}
