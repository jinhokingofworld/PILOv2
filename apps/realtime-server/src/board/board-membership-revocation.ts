import {
  disconnectMembershipSocket,
  isWorkspaceMembershipRevokedEvent,
  readAuthenticatedMembershipUserId,
} from "../workspace-membership-revocation/workspace-membership-revocation";

export type BoardMembershipSocket = {
  data: {
    auth?: {
      userId?: unknown;
    };
  };
  disconnect: (close?: boolean) => unknown;
  id: string;
  leave: (roomName: string) => Promise<unknown> | unknown;
  rooms: ReadonlySet<string>;
};

type BoardMembershipIo = {
  sockets: {
    sockets: ReadonlyMap<string, BoardMembershipSocket>;
  };
};

function isTargetBoardRoom(roomName: string, workspaceId: string) {
  return (
    roomName === `workspace:${workspaceId}:boards` ||
    roomName.startsWith(`workspace:${workspaceId}:board:`)
  );
}

export async function evictBoardSocketFromRooms(
  socket: BoardMembershipSocket,
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

export function createBoardMembershipRevocationHandler({
  io,
}: {
  io: BoardMembershipIo;
}) {
  return {
    async handle(payload: unknown): Promise<boolean> {
      if (!isWorkspaceMembershipRevokedEvent(payload)) return false;

      try {
        const results = await Promise.all(
          [...io.sockets.sockets.values()].map((socket) => {
            if (readAuthenticatedMembershipUserId(socket) !== payload.userId) {
              return true;
            }
            const roomNames = [...socket.rooms].filter((roomName) =>
              isTargetBoardRoom(roomName, payload.workspaceId),
            );
            return evictBoardSocketFromRooms(socket, roomNames);
          }),
        );
        return results.every(Boolean);
      } catch {
        return false;
      }
    },
  };
}
