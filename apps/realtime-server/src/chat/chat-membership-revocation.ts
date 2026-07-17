import {
  readChatLocalSocketRegistry,
  readLocalChatRoomSockets,
} from "./chat-local-sockets";
import {
  type ChatMembershipSocket,
  disconnectInvalidChatSocket,
  evictChatSocket,
  readAuthenticatedChatUserId,
} from "./chat-membership-eviction";
import { createChatUserRoomName } from "./chat-room.service";
import {
  isWorkspaceMembershipRevokedEvent,
  type WorkspaceMembershipRevokedEventV1,
} from "../workspace-membership-revocation/workspace-membership-revocation";

export {
  isWorkspaceMembershipRevokedEvent,
  WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL,
  type WorkspaceMembershipRevokedEventV1,
} from "../workspace-membership-revocation/workspace-membership-revocation";

type ChatMembershipIo = Parameters<typeof readChatLocalSocketRegistry>[0];

export function createChatMembershipRevocationHandler({
  io,
}: {
  io: ChatMembershipIo;
}) {
  return {
    async handle(payload: unknown): Promise<boolean> {
      if (!isWorkspaceMembershipRevokedEvent(payload)) return false;

      const registry = readChatLocalSocketRegistry(io);
      if (!registry) return false;
      const sockets = readLocalChatRoomSockets(
        registry,
        createChatUserRoomName(payload.workspaceId, payload.userId),
      );
      if (!sockets) return false;

      const cleanupResults = await Promise.all(
        sockets.map((socket) => {
          if (readAuthenticatedChatUserId(socket) !== payload.userId) {
            return disconnectInvalidChatSocket(socket);
          }
          return evictChatSocket(socket, payload.workspaceId, payload.userId);
        }),
      );
      return cleanupResults.every(Boolean);
    },
  };
}
