import type {
  WorkspaceChatMessage,
} from "@/features/chat/types";

export const chatClientEvents = {
  join: "chat:join",
  leave: "chat:leave"
} as const;

export const chatServerEvents = {
  error: "chat:error",
  joined: "chat:joined",
  messageCreated: "chat:message-created",
  messageDeleted: "chat:message-deleted",
  mentionCreated: "chat:mention-created"
} as const;

export type ChatRoomPayload = {
  workspaceId: string;
};

export type ChatMessageDeletedPayload = ChatRoomPayload & {
  messageId: string;
  deletedAt: string;
};

export type ChatMentionCreatedPayload = {
  message: WorkspaceChatMessage;
  occurredAt: string;
};
