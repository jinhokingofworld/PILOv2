import type { QueryResultRow } from "pg";

export type WorkspaceChatMessage = {
  id: string;
  workspaceId: string;
  clientMessageId: string;
  content: string | null;
  author: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  mentions: Array<{ userId: string; displayText: string }>;
  createdAt: string;
  deletedAt: string | null;
};

export type ChatRedisEventV1 =
  | {
      version: 1;
      type: "message.created";
      workspaceId: string;
      occurredAt: string;
      message: WorkspaceChatMessage;
      mentionedUserIds: string[];
    }
  | {
      version: 1;
      type: "message.deleted";
      workspaceId: string;
      occurredAt: string;
      messageId: string;
      deletedAt: string;
    };

export type ChatCursor = {
  createdAt: string;
  id: string;
};

export type ChatSummaryPayload = {
  latestMessageId: string | null;
  lastReadMessageId: string | null;
  unreadCount: number;
  mentionUnreadCount: number;
};

export type ChatMessagePage = {
  items: WorkspaceChatMessage[];
  nextCursor: string | null;
};

export type ChatMessageContext = {
  items: WorkspaceChatMessage[];
};

export type ChatReadStatePayload = {
  lastReadMessageId: string;
  lastReadAt: string;
};

export type ChatMentionNotification = {
  id: string;
  readAt: string | null;
  messageId: string;
  excerpt: string;
  actor: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
};

export type ChatMentionPage = {
  items: ChatMentionNotification[];
  nextCursor: string | null;
};

export interface ChatMessageRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  sender_user_id: string | null;
  client_message_id: string;
  content: string | null;
  request_fingerprint: string;
  author_id: string | null;
  author_display_name: string | null;
  author_avatar_url: string | null;
  mentions:
    | Array<{ userId: string; displayText: string }>
    | string
    | null;
  created_at: Date | string;
  deleted_at: Date | string | null;
}

export interface ChatReadStateRow extends QueryResultRow {
  workspace_id: string;
  user_id: string;
  last_read_message_id: string;
  last_read_at: Date | string;
}

export interface ChatMentionRow extends QueryResultRow {
  id: string;
  read_at: Date | string | null;
  message_id: string;
  excerpt: string;
  actor_id: string | null;
  actor_display_name: string | null;
  actor_avatar_url: string | null;
  workspace_id: string;
  workspace_name: string;
  created_at: Date | string;
}

export interface ChatSummaryRow extends QueryResultRow {
  latest_message_id: string | null;
  last_read_message_id: string | null;
  unread_count: number | string;
  mention_unread_count: number | string;
}

export interface ChatMentionTargetRow extends QueryResultRow {
  user_id: string;
  display_name: string;
}

export type CreateChatMessageRecord = {
  workspaceId: string;
  senderUserId: string;
  clientMessageId: string;
  content: string;
  requestFingerprint: string;
};
