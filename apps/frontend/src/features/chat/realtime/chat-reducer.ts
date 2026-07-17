import type {
  ChatViewMessage,
  WorkspaceChatMessage
} from "@/features/chat/types";

export type ChatState = {
  workspaceId: string;
  deletedMessageIds: Record<string, string>;
  messagesById: Record<string, ChatViewMessage>;
  messageIdByClientId: Record<string, string>;
  messages: ChatViewMessage[];
};

type ChatMessageDeletedPayload = {
  workspaceId?: string;
  messageId: string;
  deletedAt: string;
};

export type ChatStateAction =
  | {
      type: "workspace-reset";
      workspaceId: string;
    }
  | {
      type: "optimistic-added";
      message: ChatViewMessage;
    }
  | {
      type: "message-created";
      message: WorkspaceChatMessage;
    }
  | {
      type: "messages-merged";
      messages: WorkspaceChatMessage[];
    }
  | {
      type: "message-deleted";
      payload: ChatMessageDeletedPayload;
    }
  | {
      type: "message-failed";
      clientMessageId: string;
      failureMessage: string;
    }
  | {
      type: "message-retrying";
      clientMessageId: string;
    };

export function createChatState(workspaceId: string): ChatState {
  return {
    workspaceId,
    deletedMessageIds: {},
    messagesById: {},
    messageIdByClientId: {},
    messages: []
  };
}

export function reduceChatState(
  state: ChatState,
  action: ChatStateAction
): ChatState {
  switch (action.type) {
    case "workspace-reset":
      return createChatState(action.workspaceId);
    case "optimistic-added":
      return addOptimisticMessage(state, action.message);
    case "message-created":
      return addServerMessage(state, action.message);
    case "messages-merged":
      return mergeServerMessages(state, action.messages);
    case "message-deleted":
      return deleteMessage(state, action.payload);
    case "message-failed":
      return updateDeliveryState(
        state,
        action.clientMessageId,
        "failed",
        action.failureMessage
      );
    case "message-retrying":
      return updateDeliveryState(
        state,
        action.clientMessageId,
        "pending",
        null
      );
  }
}

export function getLatestSentMessageId(state: ChatState) {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message.delivery === "sent") return message.id;
  }

  return null;
}

function addOptimisticMessage(
  state: ChatState,
  message: ChatViewMessage
) {
  if (
    message.workspaceId !== state.workspaceId ||
    state.messageIdByClientId[message.clientMessageId]
  ) {
    return state;
  }

  return buildChatState(
    state.workspaceId,
    {
      ...state.messagesById,
      [message.id]: message
    },
    state.deletedMessageIds
  );
}

function addServerMessage(state: ChatState, message: WorkspaceChatMessage) {
  const canonicalMessage = applyRecordedTombstone(
    message,
    state.deletedMessageIds
  );
  if (
    canonicalMessage.workspaceId !== state.workspaceId ||
    state.messagesById[canonicalMessage.id]
  ) {
    return state;
  }

  const messagesById = { ...state.messagesById };
  const optimisticId =
    state.messageIdByClientId[canonicalMessage.clientMessageId];
  if (
    optimisticId &&
    optimisticId !== canonicalMessage.id &&
    isMatchingOptimisticMessage(
      messagesById[optimisticId],
      canonicalMessage
    )
  ) {
    delete messagesById[optimisticId];
  }
  messagesById[canonicalMessage.id] = toSentMessage(canonicalMessage);
  return buildChatState(
    state.workspaceId,
    messagesById,
    state.deletedMessageIds
  );
}

function mergeServerMessages(
  state: ChatState,
  messages: WorkspaceChatMessage[]
) {
  let messagesById = state.messagesById;
  let changed = false;

  for (const incomingMessage of messages) {
    const message = applyRecordedTombstone(
      incomingMessage,
      state.deletedMessageIds
    );
    if (message.workspaceId !== state.workspaceId) {
      continue;
    }

    const currentMessage = messagesById[message.id];
    if (
      currentMessage &&
      isSentTombstone(currentMessage) &&
      !isCanonicalTombstone(message)
    ) {
      continue;
    }
    if (currentMessage && matchesCanonicalMessage(currentMessage, message)) {
      continue;
    }

    if (!changed) messagesById = { ...messagesById };
    const optimisticId = state.messageIdByClientId[message.clientMessageId];
    if (
      optimisticId &&
      optimisticId !== message.id &&
      isMatchingOptimisticMessage(messagesById[optimisticId], message)
    ) {
      delete messagesById[optimisticId];
    }
    messagesById[message.id] = toSentMessage(message);
    changed = true;
  }

  return changed
    ? buildChatState(
        state.workspaceId,
        messagesById,
        state.deletedMessageIds
      )
    : state;
}

function deleteMessage(
  state: ChatState,
  payload: ChatMessageDeletedPayload
) {
  if (payload.workspaceId && payload.workspaceId !== state.workspaceId) {
    return state;
  }

  const currentMessage = state.messagesById[payload.messageId];
  const recordedDeletedAt = state.deletedMessageIds[payload.messageId];
  if (!currentMessage && recordedDeletedAt === payload.deletedAt) return state;
  const deletedMessageIds = {
    ...state.deletedMessageIds,
    [payload.messageId]: payload.deletedAt
  };
  if (!currentMessage) {
    return { ...state, deletedMessageIds };
  }
  if (
    recordedDeletedAt === payload.deletedAt &&
    currentMessage.content === null &&
    currentMessage.deletedAt === payload.deletedAt &&
    currentMessage.mentions.length === 0
  ) {
    return state;
  }

  return buildChatState(
    state.workspaceId,
    {
      ...state.messagesById,
      [payload.messageId]: {
        ...currentMessage,
        content: null,
        deletedAt: payload.deletedAt,
        mentions: []
      }
    },
    deletedMessageIds
  );
}

function updateDeliveryState(
  state: ChatState,
  clientMessageId: string,
  delivery: ChatViewMessage["delivery"],
  failureMessage: string | null
) {
  const messageId = state.messageIdByClientId[clientMessageId];
  const currentMessage = messageId
    ? state.messagesById[messageId]
    : undefined;
  if (!currentMessage) return state;
  if (currentMessage.delivery === "sent") return state;
  if (
    currentMessage.delivery === delivery &&
    currentMessage.failureMessage === failureMessage
  ) {
    return state;
  }

  return buildChatState(
    state.workspaceId,
    {
      ...state.messagesById,
      [messageId]: {
        ...currentMessage,
        delivery,
        failureMessage
      }
    },
    state.deletedMessageIds
  );
}

function toSentMessage(message: WorkspaceChatMessage): ChatViewMessage {
  return {
    ...message,
    delivery: "sent",
    failureMessage: null
  };
}

function buildChatState(
  workspaceId: string,
  messagesById: Record<string, ChatViewMessage>,
  deletedMessageIds: Record<string, string>
): ChatState {
  const messages = Object.values(messagesById).sort(compareMessages);
  const messageIdByClientId: Record<string, string> = {};
  for (const message of messages) {
    if (message.delivery !== "sent") {
      messageIdByClientId[message.clientMessageId] = message.id;
    }
  }

  return {
    workspaceId,
    deletedMessageIds,
    messagesById,
    messageIdByClientId,
    messages
  };
}

function applyRecordedTombstone(
  message: WorkspaceChatMessage,
  deletedMessageIds: Record<string, string>
): WorkspaceChatMessage {
  const deletedAt = deletedMessageIds[message.id];
  return deletedAt
    ? {
        ...message,
        content: null,
        deletedAt,
        mentions: []
      }
    : message;
}

function compareMessages(first: ChatViewMessage, second: ChatViewMessage) {
  const timestampOrder = first.createdAt.localeCompare(second.createdAt);
  return timestampOrder || first.id.localeCompare(second.id);
}

function isMatchingOptimisticMessage(
  optimisticMessage: ChatViewMessage | undefined,
  serverMessage: WorkspaceChatMessage
) {
  return (
    optimisticMessage?.delivery !== "sent" &&
    Boolean(optimisticMessage?.author?.id) &&
    optimisticMessage?.author?.id === serverMessage.author?.id
  );
}

function isSentTombstone(message: ChatViewMessage) {
  return (
    message.delivery === "sent" &&
    (message.deletedAt !== null || message.content === null)
  );
}

function isCanonicalTombstone(message: WorkspaceChatMessage) {
  return message.deletedAt !== null || message.content === null;
}

function matchesCanonicalMessage(
  currentMessage: ChatViewMessage,
  canonicalMessage: WorkspaceChatMessage
) {
  return (
    currentMessage.delivery === "sent" &&
    currentMessage.failureMessage === null &&
    currentMessage.workspaceId === canonicalMessage.workspaceId &&
    currentMessage.clientMessageId === canonicalMessage.clientMessageId &&
    currentMessage.content === canonicalMessage.content &&
    currentMessage.createdAt === canonicalMessage.createdAt &&
    currentMessage.deletedAt === canonicalMessage.deletedAt &&
    currentMessage.author?.id === canonicalMessage.author?.id &&
    currentMessage.author?.displayName === canonicalMessage.author?.displayName &&
    currentMessage.author?.avatarUrl === canonicalMessage.author?.avatarUrl &&
    currentMessage.mentions.length === canonicalMessage.mentions.length &&
    currentMessage.mentions.every((mention, index) => {
      const canonicalMention = canonicalMessage.mentions[index];
      return (
        mention.userId === canonicalMention?.userId &&
        mention.displayText === canonicalMention.displayText
      );
    })
  );
}
