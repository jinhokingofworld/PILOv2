import {
  disconnectMembershipSocket,
  isWorkspaceMembershipRevokedEvent,
  readAuthenticatedMembershipUserId,
} from "../workspace-membership-revocation/workspace-membership-revocation";

export type GithubSourceMembershipSocket = {
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

type GithubSourceMembershipIo = {
  sockets: {
    sockets: ReadonlyMap<string, GithubSourceMembershipSocket>;
  };
};

export async function evictGithubSourceSocketFromRooms(
  socket: GithubSourceMembershipSocket,
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

export function createGithubSourceMembershipRevocationHandler({
  io,
}: {
  io: GithubSourceMembershipIo;
}) {
  return {
    async handle(payload: unknown): Promise<boolean> {
      if (!isWorkspaceMembershipRevokedEvent(payload)) return false;

      try {
        const roomName = `workspace:${payload.workspaceId}:github-source`;
        const results = await Promise.all(
          [...io.sockets.sockets.values()].map((socket) => {
            if (readAuthenticatedMembershipUserId(socket) !== payload.userId) {
              return true;
            }
            return evictGithubSourceSocketFromRooms(
              socket,
              socket.rooms.has(roomName) ? [roomName] : [],
            );
          }),
        );
        return results.every(Boolean);
      } catch {
        return false;
      }
    },
  };
}
