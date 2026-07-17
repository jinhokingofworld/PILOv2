import type { Server } from "socket.io";

import {
  disconnectMembershipSocket,
  isWorkspaceMembershipRevokedEvent,
  readAuthenticatedMembershipUserId,
  readLocalMembershipRoomSockets,
} from "../workspace-membership-revocation/workspace-membership-revocation";
import {
  createWorkspacePresenceRoomName,
  emitWorkspacePresenceClearResult,
} from "./workspace-presence-socket-handlers";
import type { WorkspacePresenceService } from "./workspace-presence.service";

export function createWorkspacePresenceMembershipRevocationHandler({
  io,
  service,
}: {
  io: Server;
  service: WorkspacePresenceService;
}) {
  return {
    async handle(payload: unknown): Promise<boolean> {
      if (!isWorkspaceMembershipRevokedEvent(payload)) return false;

      const roomName = createWorkspacePresenceRoomName(payload.workspaceId);
      const sockets = readLocalMembershipRoomSockets(io, roomName);
      if (!sockets) return false;

      const results = await Promise.all(
        sockets.map(async (socket) => {
          if (readAuthenticatedMembershipUserId(socket) !== payload.userId) return true;

          const clearResult = service.leaveSocket(socket.id, payload.workspaceId);
          try {
            await socket.leave(roomName);
          } catch {
            const disconnected = disconnectMembershipSocket(socket);
            if (clearResult) emitWorkspacePresenceClearResult(io, clearResult);
            return disconnected;
          }

          if (clearResult) emitWorkspacePresenceClearResult(io, clearResult);
          return true;
        }),
      );
      return results.every(Boolean);
    },
  };
}
