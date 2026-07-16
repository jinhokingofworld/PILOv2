import { chatServerEvents } from "./chat-events";
import { isChatRedisEvent } from "./chat-payload";
import {
  createChatRoomName,
  createChatUserRoomName,
} from "./chat-room.service";

type ChatIo = {
  to: (roomName: string) => {
    emit: (event: string, payload: unknown) => unknown;
  };
};

export function createChatFanOut({ io }: { io: ChatIo }) {
  return {
    fanOut(payload: unknown) {
      if (!isChatRedisEvent(payload)) return false;

      if (payload.type === "message.created") {
        io.to(createChatRoomName(payload.workspaceId)).emit(
          chatServerEvents.messageCreated,
          payload.message,
        );
        for (const userId of new Set(payload.mentionedUserIds)) {
          io.to(createChatUserRoomName(payload.workspaceId, userId)).emit(
            chatServerEvents.mentionCreated,
            { message: payload.message, occurredAt: payload.occurredAt },
          );
        }
      } else {
        io.to(createChatRoomName(payload.workspaceId)).emit(
          chatServerEvents.messageDeleted,
          {
            workspaceId: payload.workspaceId,
            messageId: payload.messageId,
            deletedAt: payload.deletedAt,
          },
        );
      }

      return true;
    },
  };
}
