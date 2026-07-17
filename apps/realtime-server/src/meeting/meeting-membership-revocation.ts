import { createMeetingRoomName } from "../socket/room-names";
import {
  disconnectMembershipSocket,
  isWorkspaceMembershipRevokedEvent,
  readAuthenticatedMembershipUserId,
  readLocalMembershipRoomSockets,
  type WorkspaceMembershipRevocationIo,
} from "../workspace-membership-revocation/workspace-membership-revocation";

export function createMeetingMembershipRevocationHandler({
  io,
}: {
  io: WorkspaceMembershipRevocationIo;
}) {
  return {
    async handle(payload: unknown): Promise<boolean> {
      if (!isWorkspaceMembershipRevokedEvent(payload)) return false;

      const roomName = createMeetingRoomName(payload.workspaceId);
      const sockets = readLocalMembershipRoomSockets(io, roomName);
      if (!sockets) return false;

      const results = await Promise.all(
        sockets.map(async (socket) => {
          if (readAuthenticatedMembershipUserId(socket) !== payload.userId) return true;

          try {
            await socket.leave(roomName);
            return true;
          } catch {
            return disconnectMembershipSocket(socket);
          }
        }),
      );
      return results.every(Boolean);
    },
  };
}

export { isWorkspaceMembershipRevokedEvent };
