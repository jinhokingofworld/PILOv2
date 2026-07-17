export const chatClientEvents = {
  join: "chat:join",
  leave: "chat:leave",
} as const;

export const chatServerEvents = {
  error: "chat:error",
  joined: "chat:joined",
  messageCreated: "chat:message-created",
  messageDeleted: "chat:message-deleted",
  mentionCreated: "chat:mention-created",
} as const;
