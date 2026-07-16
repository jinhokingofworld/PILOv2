import assert from "node:assert/strict";

import { ChatApiError } from "../api/client.ts";
import {
  CHAT_TARGET_UNAVAILABLE_MESSAGE,
  CHAT_TARGET_VISIBILITY_THRESHOLD,
  buildChatMentionHref,
  createChatTargetFocusLifecycle,
  createVisibleMentionReadRetry,
  formatChatNotificationBadgeCount,
  formatChatNotificationDateTime,
  formatChatNotificationTime,
  getNotificationUnreadCount,
  handleChatTargetLoadError,
  loadChatTargetIfMissing,
  navigateToChatMention,
  shouldReadVisibleMention,
} from "./chat-notification.ts";

assert.equal(
  CHAT_TARGET_UNAVAILABLE_MESSAGE,
  "해당 메시지를 확인할 수 없습니다",
);
assert.equal(CHAT_TARGET_VISIBILITY_THRESHOLD, 0);

assert.equal(
  getNotificationUnreadCount({ invitationUnread: 2, mentionUnread: 3 }),
  5,
);
assert.equal(
  getNotificationUnreadCount({ invitationUnread: 98, mentionUnread: 5 }),
  103,
);
assert.equal(formatChatNotificationBadgeCount(103), "99+");
assert.equal(formatChatNotificationBadgeCount(7), "7");
assert.equal(
  buildChatMentionHref("message 1"),
  "/chat?messageId=message%201",
);
assert.equal(
  shouldReadVisibleMention({
    targetMessageId: "m1",
    visibleMessageIds: new Set(["m1"]),
  }),
  true,
);
assert.equal(
  shouldReadVisibleMention({
    targetMessageId: "m1",
    visibleMessageIds: new Set(["m2"]),
  }),
  false,
);

{
  const events = [];
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    navigateToChatMention({
      closePopover: () => events.push("closed"),
      markMentionRead: async (mentionId) => {
        events.push(`read:${mentionId}`);
        throw new Error("read failed");
      },
      mentionId: "mention-1",
      messageId: "message /1",
      navigate: (href) => events.push(`navigate:${href}`),
    });
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }

  assert.deepEqual(events, [
    "closed",
    "read:mention-1",
    "navigate:/chat?messageId=message%20%2F1",
  ]);
  assert.deepEqual(unhandled, []);
}

{
  let contextCalls = 0;
  const result = await loadChatTargetIfMissing({
    hasLocalMessage: true,
    loadContext: async () => {
      contextCalls += 1;
      return { items: [] };
    },
    targetMessageId: "local-message",
  });

  assert.equal(result, "local");
  assert.equal(contextCalls, 0);
}

assert.equal(
  await loadChatTargetIfMissing({
    hasLocalMessage: false,
    loadContext: async () => ({ items: [{ id: "context-message" }] }),
    targetMessageId: "context-message",
  }),
  "loaded",
);
assert.equal(
  await loadChatTargetIfMissing({
    hasLocalMessage: false,
    loadContext: async () => ({ items: [] }),
    targetMessageId: "missing-message",
  }),
  "missing",
);

{
  const errors = [];
  const replacements = [];
  const result = handleChatTargetLoadError({
    error: new ChatApiError("not found", { status: 404 }),
    onError: (message) => errors.push(message),
    replace: (href) => replacements.push(href),
  });

  assert.equal(result, "not-found");
  assert.deepEqual(errors, [CHAT_TARGET_UNAVAILABLE_MESSAGE]);
  assert.deepEqual(replacements, ["/chat"]);
}

{
  const errors = [];
  const replacements = [];
  const result = handleChatTargetLoadError({
    error: new ChatApiError("failed", { status: 500 }),
    onError: (message) => errors.push(message),
    replace: (href) => replacements.push(href),
  });

  assert.equal(result, "error");
  assert.deepEqual(errors, ["요청한 메시지를 불러오지 못했습니다."]);
  assert.deepEqual(replacements, []);
}

assert.equal(
  formatChatNotificationTime(
    "2026-07-17T00:29:30.000Z",
    new Date("2026-07-17T00:30:00.000Z"),
  ),
  "방금 전",
);
assert.equal(formatChatNotificationTime("invalid", new Date(0)), "시간 정보 없음");
assert.match(
  formatChatNotificationDateTime("2026-07-17T00:30:00.000Z"),
  /2026/,
);

{
  const lifecycle = createChatTargetFocusLifecycle();
  const first = lifecycle.begin({
    targetAvailable: true,
    targetMessageId: "message-1",
    workspaceId: "workspace-1",
  });

  assert.notEqual(first, null);
  assert.equal(
    lifecycle.begin({
      targetAvailable: true,
      targetMessageId: "message-1",
      workspaceId: "workspace-1",
    }),
    null,
  );
  assert.equal(lifecycle.complete(first), true);
  assert.equal(lifecycle.complete(first), false);
  assert.equal(
    lifecycle.begin({
      targetAvailable: true,
      targetMessageId: "message-1",
      workspaceId: "workspace-1",
    }),
    null,
  );

  lifecycle.reset();
  const reentry = lifecycle.begin({
    targetAvailable: true,
    targetMessageId: "message-1",
    workspaceId: "workspace-1",
  });
  assert.notEqual(reentry, null);

  const nextWorkspace = lifecycle.begin({
    targetAvailable: true,
    targetMessageId: "message-1",
    workspaceId: "workspace-2",
  });
  assert.notEqual(nextWorkspace, null);
  assert.equal(lifecycle.complete(reentry), false);
  assert.equal(lifecycle.complete(nextWorkspace), true);
}

{
  const scheduled = [];
  const cleared = [];
  let attempts = 0;
  const retry = createVisibleMentionReadRetry({
    clearScheduled: (handle) => cleared.push(handle),
    retryDelayMs: 1,
    schedule: (callback) => {
      const handle = { callback };
      scheduled.push(handle);
      return handle;
    },
  });

  retry.start({
    isCurrent: () => true,
    key: "workspace-1:mention-1",
    read: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 1);
  assert.equal(scheduled.length, 1);

  scheduled.shift().callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.equal(scheduled.length, 0);

  retry.start({
    isCurrent: () => true,
    key: "workspace-1:mention-reset",
    read: async () => {
      throw new Error("reset failure");
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const pendingHandle = scheduled[0];
  retry.reset();
  assert.deepEqual(cleared, [pendingHandle]);
}

{
  let attempts = 0;
  const retry = createVisibleMentionReadRetry({ maxAttempts: 1 });
  const input = {
    isCurrent: () => true,
    key: "workspace-1:mention-exhausted",
    read: async () => {
      attempts += 1;
      throw new Error("exhausted");
    },
  };

  retry.start(input);
  await new Promise((resolve) => setImmediate(resolve));
  retry.start(input);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 1);

  retry.reset();
  retry.start(input);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 2);
}

{
  let attempts = 0;
  const retry = createVisibleMentionReadRetry({ maxAttempts: 1 });
  const input = {
    isCurrent: () => true,
    key: "workspace-1:mention-succeeded",
    read: async () => {
      attempts += 1;
    },
  };

  retry.start(input);
  await new Promise((resolve) => setImmediate(resolve));
  retry.start(input);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 1);

  retry.reset();
  retry.start(input);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 2);
}
