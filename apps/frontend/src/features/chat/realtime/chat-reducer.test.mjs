import assert from "node:assert/strict";

import {
  createChatState,
  reduceChatState,
} from "./chat-reducer.ts";

const timestamp = "2026-07-16T00:00:00.000Z";

function pendingMessage({
  clientMessageId,
  createdAt = timestamp,
  workspaceId = "workspace-1",
}) {
  return {
    id: `pending:${clientMessageId}`,
    workspaceId,
    clientMessageId,
    content: "hello",
    author: {
      id: "user-1",
      displayName: "PILO user",
      avatarUrl: null,
    },
    mentions: [],
    createdAt,
    deletedAt: null,
    delivery: "pending",
    failureMessage: null,
  };
}

function serverMessage({
  authorId = "user-1",
  id,
  clientMessageId,
  createdAt = timestamp,
  workspaceId = "workspace-1",
}) {
  return {
    id,
    workspaceId,
    clientMessageId,
    content: "hello",
    author: {
      id: authorId,
      displayName: "PILO user",
      avatarUrl: null,
    },
    mentions: [],
    createdAt,
    deletedAt: null,
  };
}

{
  let state = createChatState("workspace-1");
  state = reduceChatState(state, {
    type: "optimistic-added",
    message: pendingMessage({ clientMessageId: "shared-client-id" }),
  });
  state = reduceChatState(state, {
    type: "message-created",
    message: serverMessage({
      id: "other-author-message",
      clientMessageId: "shared-client-id",
      authorId: "user-2",
    }),
  });

  assert.deepEqual(
    state.messages.map(({ id }) => id),
    ["other-author-message", "pending:shared-client-id"],
  );
  assert.equal(
    state.messageIdByClientId["shared-client-id"],
    "pending:shared-client-id",
  );

  state = reduceChatState(state, {
    type: "message-created",
    message: serverMessage({
      id: "local-confirmation",
      clientMessageId: "shared-client-id",
      authorId: "user-1",
    }),
  });

  assert.deepEqual(
    state.messages.map(({ id }) => id),
    ["local-confirmation", "other-author-message"],
  );
  assert.equal(state.messageIdByClientId["shared-client-id"], undefined);
}

{
  let state = createChatState("workspace-1");
  state = reduceChatState(state, {
    type: "optimistic-added",
    message: pendingMessage({ clientMessageId: "client-race" }),
  });
  state = reduceChatState(state, {
    type: "message-created",
    message: serverMessage({
      id: "message-race",
      clientMessageId: "client-race",
    }),
  });
  const confirmedState = state;
  state = reduceChatState(state, {
    type: "message-failed",
    clientMessageId: "client-race",
    failureMessage: "late fetch failure",
  });
  state = reduceChatState(state, {
    type: "message-retrying",
    clientMessageId: "client-race",
  });

  assert.equal(state, confirmedState);
  assert.equal(state.messages[0].delivery, "sent");
  assert.equal(state.messages[0].failureMessage, null);
}

{
  let state = createChatState("workspace-1");
  state = reduceChatState(state, {
    type: "message-created",
    message: serverMessage({
      id: "message-canonical",
      clientMessageId: "client-canonical",
    }),
  });
  state = reduceChatState(state, {
    type: "messages-merged",
    messages: [
      {
        ...serverMessage({
          id: "message-canonical",
          clientMessageId: "client-canonical",
        }),
        content: null,
        deletedAt: "2026-07-16T00:10:00.000Z",
      },
    ],
  });

  assert.equal(state.messages[0].content, null);
  assert.equal(state.messages[0].deletedAt, "2026-07-16T00:10:00.000Z");
}

{
  let state = createChatState("workspace-1");
  const activeMessageCapturedByDeepRefresh = serverMessage({
    id: "message-delete-race",
    clientMessageId: "client-delete-race",
  });
  state = reduceChatState(state, {
    type: "message-created",
    message: activeMessageCapturedByDeepRefresh,
  });
  state = reduceChatState(state, {
    type: "message-deleted",
    payload: {
      workspaceId: "workspace-1",
      messageId: "message-delete-race",
      deletedAt: "2026-07-16T00:10:00.000Z",
    },
  });

  state = reduceChatState(state, {
    type: "messages-merged",
    messages: [activeMessageCapturedByDeepRefresh],
  });

  assert.equal(state.messages[0].content, null);
  assert.equal(state.messages[0].deletedAt, "2026-07-16T00:10:00.000Z");
  assert.deepEqual(state.messages[0].mentions, []);
}

{
  let state = createChatState("workspace-1");
  state = reduceChatState(state, {
    type: "optimistic-added",
    message: pendingMessage({ clientMessageId: "client-1" }),
  });
  state = reduceChatState(state, {
    type: "message-created",
    message: serverMessage({
      id: "message-1",
      clientMessageId: "client-1",
    }),
  });

  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].id, "message-1");
  assert.equal(state.messages[0].delivery, "sent");
  assert.equal(state.messageIdByClientId["client-1"], undefined);
}

{
  let state = createChatState("workspace-1");
  const message = serverMessage({
    id: "message-1",
    clientMessageId: "client-1",
  });
  state = reduceChatState(state, { type: "message-created", message });
  const duplicateState = reduceChatState(state, {
    type: "message-created",
    message,
  });

  assert.equal(duplicateState, state);
  assert.equal(duplicateState.messages.length, 1);
}

{
  let state = createChatState("workspace-1");
  state = reduceChatState(state, {
    type: "message-created",
    message: serverMessage({
      id: "message-1",
      clientMessageId: "client-1",
    }),
  });
  const unchangedState = reduceChatState(state, {
    type: "message-created",
    message: serverMessage({
      id: "message-2",
      clientMessageId: "client-2",
      workspaceId: "workspace-2",
    }),
  });

  assert.equal(unchangedState, state);
}

{
  let state = createChatState("workspace-1");
  state = reduceChatState(state, {
    type: "message-created",
    message: {
      ...serverMessage({ id: "message-1", clientMessageId: "client-1" }),
      mentions: [{ userId: "user-2", displayText: "@PILO" }],
    },
  });
  state = reduceChatState(state, {
    type: "message-deleted",
    payload: {
      messageId: "message-1",
      deletedAt: "2026-07-16T00:10:00.000Z",
    },
  });

  assert.equal(state.messages[0].content, null);
  assert.equal(state.messages[0].deletedAt, "2026-07-16T00:10:00.000Z");
  assert.deepEqual(state.messages[0].mentions, []);
  const duplicateDeleteState = reduceChatState(state, {
    type: "message-deleted",
    payload: {
      workspaceId: "workspace-1",
      messageId: "message-1",
      deletedAt: "2026-07-16T00:10:00.000Z",
    },
  });
  assert.equal(duplicateDeleteState, state);
}

{
  let state = createChatState("workspace-1");
  state = reduceChatState(state, {
    type: "messages-merged",
    messages: [
      serverMessage({
        id: "message-2",
        clientMessageId: "client-2",
        createdAt: "2026-07-16T00:02:00.000Z",
      }),
      serverMessage({
        id: "message-1",
        clientMessageId: "client-1",
        createdAt: "2026-07-16T00:01:00.000Z",
      }),
    ],
  });
  state = reduceChatState(state, {
    type: "messages-merged",
    messages: [
      serverMessage({
        id: "message-2",
        clientMessageId: "client-2",
        createdAt: "2026-07-16T00:02:00.000Z",
      }),
    ],
  });

  assert.deepEqual(
    state.messages.map(({ id }) => id),
    ["message-1", "message-2"],
  );
}

{
  let state = createChatState("workspace-1");
  state = reduceChatState(state, {
    type: "optimistic-added",
    message: pendingMessage({ clientMessageId: "client-1" }),
  });
  state = reduceChatState(state, {
    type: "message-failed",
    clientMessageId: "client-1",
    failureMessage: "전송하지 못했습니다.",
  });
  assert.equal(state.messages[0].delivery, "failed");
  assert.equal(state.messages[0].failureMessage, "전송하지 못했습니다.");

  state = reduceChatState(state, {
    type: "message-retrying",
    clientMessageId: "client-1",
  });
  assert.equal(state.messages[0].delivery, "pending");
  assert.equal(state.messages[0].failureMessage, null);
}

{
  let state = createChatState("workspace-1");
  state = reduceChatState(state, {
    type: "message-created",
    message: serverMessage({
      id: "message-1",
      clientMessageId: "client-1",
    }),
  });
  state = reduceChatState(state, {
    type: "workspace-reset",
    workspaceId: "workspace-2",
  });

  assert.equal(state.workspaceId, "workspace-2");
  assert.deepEqual(state.messages, []);
  assert.deepEqual(state.messagesById, {});
  assert.deepEqual(state.messageIdByClientId, {});
}

{
  let state = createChatState("workspace-1");
  state = reduceChatState(state, {
    type: "message-deleted",
    payload: {
      workspaceId: "workspace-1",
      messageId: "message-unknown-delete",
      deletedAt: "2026-07-16T00:30:00.000Z",
    },
  });

  assert.equal(
    state.deletedMessageIds["message-unknown-delete"],
    "2026-07-16T00:30:00.000Z",
  );
  assert.deepEqual(state.messages, []);

  state = reduceChatState(state, {
    type: "messages-merged",
    messages: [
      serverMessage({
        id: "message-unknown-delete",
        clientMessageId: "client-unknown-delete",
      }),
    ],
  });
  assert.equal(state.messages[0].content, null);
  assert.equal(state.messages[0].deletedAt, "2026-07-16T00:30:00.000Z");
  assert.deepEqual(state.messages[0].mentions, []);

  state = reduceChatState(state, {
    type: "workspace-reset",
    workspaceId: "workspace-2",
  });
  assert.deepEqual(state.deletedMessageIds, {});
}
