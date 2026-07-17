export type WorkspaceChatAuthor = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export type WorkspaceChatMention = {
  userId: string;
  displayText: string;
};

export type WorkspaceChatMessage = {
  id: string;
  workspaceId: string;
  clientMessageId: string;
  content: string | null;
  author: WorkspaceChatAuthor | null;
  mentions: WorkspaceChatMention[];
  createdAt: string;
  deletedAt: string | null;
};

export type ChatDelivery = "pending" | "sent" | "failed";

export type ChatSendOutcome = "sent" | "failed";

export type ChatViewMessage = WorkspaceChatMessage & {
  delivery: ChatDelivery;
  failureMessage: string | null;
};

export type ChatSummary = {
  latestMessageId: string | null;
  lastReadMessageId: string | null;
  unreadCount: number;
  mentionUnreadCount: number;
};

export type ChatMentionNotification = {
  id: string;
  readAt: string | null;
  messageId: string;
  excerpt: string;
  actor: WorkspaceChatAuthor | null;
  workspaceId: string;
  workspaceName: string;
  createdAt: string;
};

export type ChatMessagePage = {
  items: WorkspaceChatMessage[];
  nextCursor: string | null;
};

export type ChatMessageContext = {
  items: WorkspaceChatMessage[];
};

export type ChatMentionPage = {
  items: ChatMentionNotification[];
  nextCursor: string | null;
};

export type ChatReadState = {
  lastReadMessageId: string;
  lastReadAt: string;
};

export type CreateChatMessageInput = {
  clientMessageId: string;
  content: string;
  mentionedUserIds: string[];
};
