import type { RealtimeDatabase } from "../database/database";
import { chatServerEvents } from "./chat-events";
import {
  isLocalChatSocketInRoom,
  readChatLocalSocketRegistry,
  readLocalChatRoomSockets,
  type ChatLocalSocketRegistry,
} from "./chat-local-sockets";
import {
  disconnectInvalidChatSocket,
  evictChatSocket,
  readAuthenticatedChatUserId,
  type ChatMembershipSocket,
} from "./chat-membership-eviction";
import { isChatRedisEvent, type ChatRedisEventV1 } from "./chat-payload";
import {
  createChatRoomName,
  createChatUserRoomName,
} from "./chat-room.service";

type ChatIo = Parameters<typeof readChatLocalSocketRegistry>[0];

type WorkspaceMembershipRow = {
  user_id: string;
};

type AuthenticatedLocalSocket = {
  socket: ChatMembershipSocket;
  userId: string;
};

async function evictUnauthorizedSockets(
  sockets: ChatMembershipSocket[],
  workspaceId: string,
  authorizedUserIds: ReadonlySet<string>,
): Promise<{ safe: boolean; authorizedSockets: AuthenticatedLocalSocket[] }> {
  const authorizedSockets: AuthenticatedLocalSocket[] = [];
  const cleanupResults = await Promise.all(
    sockets.map(async (socket) => {
      const userId = readAuthenticatedChatUserId(socket);
      if (!userId) {
        return disconnectInvalidChatSocket(socket);
      }
      if (!authorizedUserIds.has(userId)) {
        return evictChatSocket(socket, workspaceId, userId);
      }
      authorizedSockets.push({ socket, userId });
      return true;
    }),
  );

  return {
    authorizedSockets,
    safe: cleanupResults.every(Boolean),
  };
}

function emitCreatedEvent(
  registry: ChatLocalSocketRegistry,
  sockets: AuthenticatedLocalSocket[],
  payload: Extract<ChatRedisEventV1, { type: "message.created" }>,
): void {
  const generalRoomName = createChatRoomName(payload.workspaceId);
  const mentionedUserIds = new Set(payload.mentionedUserIds);
  for (const { socket, userId } of sockets) {
    if (!isLocalChatSocketInRoom(registry, generalRoomName, socket.id)) {
      continue;
    }
    socket.emit(chatServerEvents.messageCreated, payload.message);
    if (
      mentionedUserIds.has(userId) &&
      isLocalChatSocketInRoom(registry, generalRoomName, socket.id) &&
      isLocalChatSocketInRoom(
        registry,
        createChatUserRoomName(payload.workspaceId, userId),
        socket.id,
      )
    ) {
      socket.emit(chatServerEvents.mentionCreated, {
        message: payload.message,
        occurredAt: payload.occurredAt,
      });
    }
  }
}

export function createChatFanOut({
  database,
  io,
}: {
  database: Pick<RealtimeDatabase, "query">;
  io: ChatIo;
}) {
  return {
    async fanOut(payload: unknown): Promise<boolean> {
      if (!isChatRedisEvent(payload)) return false;

      const registry = readChatLocalSocketRegistry(io);
      if (!registry) return false;
      const sockets = readLocalChatRoomSockets(
        registry,
        createChatRoomName(payload.workspaceId),
      );
      if (!sockets) return false;

      const userIds = [
        ...new Set(
          sockets
            .map((socket) => readAuthenticatedChatUserId(socket))
            .filter((userId): userId is string => userId !== null),
        ),
      ];
      let memberships: WorkspaceMembershipRow[];
      try {
        memberships = await database.query<WorkspaceMembershipRow>(
          `SELECT user_id
           FROM workspace_members
           WHERE workspace_id = $1
             AND user_id = ANY($2::uuid[])`,
          [payload.workspaceId, userIds],
        );
      } catch {
        return false;
      }

      const authorizedUserIds = new Set(
        memberships.map((membership) => membership.user_id),
      );
      const cleanup = await evictUnauthorizedSockets(
        sockets,
        payload.workspaceId,
        authorizedUserIds,
      );
      if (!cleanup.safe) return false;

      try {
        if (payload.type === "message.created") {
          emitCreatedEvent(registry, cleanup.authorizedSockets, payload);
        } else {
          const generalRoomName = createChatRoomName(payload.workspaceId);
          for (const { socket } of cleanup.authorizedSockets) {
            if (
              !isLocalChatSocketInRoom(registry, generalRoomName, socket.id)
            ) {
              continue;
            }
            socket.emit(chatServerEvents.messageDeleted, {
              workspaceId: payload.workspaceId,
              messageId: payload.messageId,
              deletedAt: payload.deletedAt,
            });
          }
        }
      } catch {
        return false;
      }

      return true;
    },
  };
}
