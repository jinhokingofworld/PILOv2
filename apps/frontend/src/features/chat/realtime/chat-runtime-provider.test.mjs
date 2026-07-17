import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import * as chatRuntime from "./chat-runtime.ts";
import {
  createChatState,
  reduceChatState,
} from "./chat-reducer.ts";

const {
  CHAT_REFRESH_ERROR_MESSAGE,
  CHAT_MENTION_REFRESH_ERROR_MESSAGE,
  createOptimisticChatMentions,
  createChatSendConfirmationTracker,
  createChatMentionReadTracker,
  applyChatMentionReadSuccess,
  createChatRefreshActions,
  createChatRefreshCoordinator,
  createChatSocketLifecycle,
  createLatestRequestRunner,
  createWorkspaceRequestScope,
  getWorkspaceCoherentChatSnapshot,
  getChatRefreshErrorMessages,
  isAbortError,
  loadChatMessagesIntoState,
  loadChatRefresh,
  mergeChatMentionNotifications,
  resolveTrackedChatSendFailure,
  startChatMentionReadReconciliation,
} = chatRuntime;
import { chatClientEvents, chatServerEvents } from "./chat-events.ts";

assert.equal(typeof createChatRefreshActions, "function");
assert.equal(typeof createChatRefreshCoordinator, "function");
assert.equal(typeof createChatMentionReadTracker, "function");

{
  const staleSnapshot = getWorkspaceCoherentChatSnapshot({
    errorMessage: "old workspace error",
    mentionErrorMessage: "old mention error",
    mentions: [mention({ id: "old-mention" })],
    state: {
      ...createChatState("workspace-a"),
      messages: [message({ id: "old-message" })],
    },
    summary: summary({ mentionUnreadCount: 4, unreadCount: 7 }),
    workspaceId: "workspace-b",
  });

  assert.equal(staleSnapshot.state.workspaceId, "workspace-b");
  assert.deepEqual(staleSnapshot.state.messages, []);
  assert.deepEqual(staleSnapshot.mentions, []);
  assert.deepEqual(staleSnapshot.summary, summary());
  assert.equal(staleSnapshot.errorMessage, null);
  assert.equal(staleSnapshot.mentionErrorMessage, null);
}

{
  const readMention = mention({
    id: "mention-read",
    readAt: "2026-07-17T01:00:00.000Z",
  });
  const result = applyChatMentionReadSuccess({
    mention: readMention,
    mentions: [mention({ id: "mention-read" }), mention({ id: "mention-other" })],
    summary: summary({ mentionUnreadCount: 2 }),
  });

  assert.equal(result.mentions[0].readAt, "2026-07-17T01:00:00.000Z");
  assert.equal(result.summary.mentionUnreadCount, 1);
  const duplicate = applyChatMentionReadSuccess({
    mention: readMention,
    mentions: result.mentions,
    summary: result.summary,
  });
  assert.equal(duplicate.summary.mentionUnreadCount, 1);
}

{
  const merged = mergeChatMentionNotifications({
    current: [
      mention({
        id: "mention-read",
        readAt: "2026-07-17T01:00:00.000Z",
      }),
    ],
    incoming: [
      mention({ id: "mention-read", readAt: null }),
      mention({ id: "mention-live", messageId: "message-live" }),
    ],
  });

  assert.equal(merged.find(({ id }) => id === "mention-read").readAt, "2026-07-17T01:00:00.000Z");
  assert.equal(merged.find(({ id }) => id === "mention-live").messageId, "message-live");
}

{
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    const calls = [];
    const result = startChatMentionReadReconciliation({
      refreshMentions: async () => {
        calls.push("mentions");
        throw new Error("mentions refresh failed");
      },
      refreshSummary: async () => {
        calls.push("summary");
        throw new Error("summary refresh failed");
      },
    });
    assert.equal(result, undefined);
    assert.deepEqual(calls, ["mentions", "summary"]);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  assert.deepEqual(unhandled, []);
}

{
  const tracker = createChatMentionReadTracker();
  const request = deferred();
  const applied = [];
  let requestCount = 0;
  const input = {
    isCurrent: () => true,
    mentionId: "mention-1",
    onSuccess: (mention) => applied.push(mention.id),
    request: () => {
      requestCount += 1;
      return request.promise;
    },
    workspaceId: "workspace-1",
  };
  const first = tracker.run(input);
  const duplicate = tracker.run(input);

  assert.equal(first, duplicate);
  assert.equal(requestCount, 1);
  request.resolve({ id: "mention-1" });
  assert.equal(await first, "success");
  assert.equal(await duplicate, "success");
  assert.deepEqual(applied, ["mention-1"]);
}

{
  const tracker = createChatMentionReadTracker();
  let requestCount = 0;
  const run = () =>
    tracker.run({
      isCurrent: () => true,
      mentionId: "mention-retry",
      onSuccess: () => undefined,
      request: async () => {
        requestCount += 1;
        if (requestCount === 1) throw new Error("temporary failure");
        return { id: "mention-retry" };
      },
      workspaceId: "workspace-1",
    });

  await assert.rejects(run, /temporary failure/);
  assert.equal(await run(), "success");
  assert.equal(requestCount, 2);
}

{
  const tracker = createChatMentionReadTracker();
  const oldRequest = deferred();
  const applied = [];
  const oldRun = tracker.run({
    isCurrent: () => false,
    mentionId: "mention-stale",
    onSuccess: (mention) => applied.push(mention.id),
    request: () => oldRequest.promise,
    workspaceId: "workspace-1",
  });
  tracker.reset();
  oldRequest.resolve({ id: "mention-stale" });

  assert.equal(await oldRun, "stale");
  assert.deepEqual(applied, []);
}

{
  assert.deepEqual(
    createOptimisticChatMentions(
      ["user-2", "user-4"],
      [
        { userId: "user-2", displayText: "@Sein" },
        { userId: "user-3", displayText: "@Juhyeong" },
      ],
    ),
    [
      { userId: "user-2", displayText: "@Sein" },
      { userId: "user-4", displayText: "" },
    ],
  );
}

{
  assert.deepEqual(
    getChatRefreshErrorMessages({
      deep: false,
      mentions: true,
      summary: false,
    }),
    {
      errorMessage: null,
      mentionErrorMessage: CHAT_MENTION_REFRESH_ERROR_MESSAGE,
    },
  );
  assert.deepEqual(
    getChatRefreshErrorMessages({
      deep: true,
      mentions: false,
      summary: false,
    }),
    {
      errorMessage: CHAT_REFRESH_ERROR_MESSAGE,
      mentionErrorMessage: null,
    },
  );
}

{
  const tracker = createChatSendConfirmationTracker();
  const untrackedMessage = {
    ...message({ id: "message-untracked" }),
    clientMessageId: "client-untracked",
  };
  tracker.confirm(untrackedMessage, "user-1");
  assert.equal(tracker.resolveFailure("client-untracked"), "failed");

  tracker.begin("client-failed");
  assert.equal(tracker.resolveFailure("client-failed"), "failed");

  tracker.begin("client-confirmed");
  tracker.confirm(
    message({ id: "message-confirmed" }),
    "user-1",
  );
  assert.equal(tracker.resolveFailure("client-confirmed"), "failed");

  tracker.begin("client-confirmed");
  const confirmedMessage = {
    ...message({ id: "message-confirmed" }),
    clientMessageId: "client-confirmed",
  };
  tracker.confirm(confirmedMessage, "user-1");
  assert.equal(tracker.resolveFailure("client-confirmed"), "sent");

  tracker.reset();
  assert.equal(tracker.resolveFailure("client-confirmed"), "failed");
}

{
  const tracker = createChatSendConfirmationTracker();
  const failures = [];
  const clientMessageId = "client-retry-race";
  tracker.begin(clientMessageId);
  tracker.confirm(
    {
      ...message({ id: "message-retry-race" }),
      clientMessageId,
    },
    "user-1",
  );

  assert.equal(
    resolveTrackedChatSendFailure({
      clientMessageId,
      onFailure: () => failures.push("failed"),
      tracker,
    }),
    "sent",
  );
  assert.deepEqual(failures, []);

  tracker.begin("client-retry-failed");
  assert.equal(
    resolveTrackedChatSendFailure({
      clientMessageId: "client-retry-failed",
      onFailure: () => failures.push("failed"),
      tracker,
    }),
    "failed",
  );
  assert.deepEqual(failures, ["failed"]);

  tracker.begin("client-workspace-reset");
  tracker.reset();
  tracker.confirm(
    {
      ...message({ id: "message-workspace-reset" }),
      clientMessageId: "client-workspace-reset",
    },
    "user-1",
  );
  assert.equal(
    tracker.resolveFailure("client-workspace-reset"),
    "failed",
  );

  tracker.begin("client-stale-request");
  tracker.complete("client-stale-request");
  tracker.confirm(
    {
      ...message({ id: "message-stale-request" }),
      clientMessageId: "client-stale-request",
    },
    "user-1",
  );
  assert.equal(tracker.resolveFailure("client-stale-request"), "failed");
}

{
  const tracker = createChatSendConfirmationTracker();
  const clientMessageId = "client-late-confirmation";
  let state = createChatState("workspace-1");
  state = reduceChatState(state, {
    type: "optimistic-added",
    message: {
      ...message({ id: `pending:${clientMessageId}` }),
      clientMessageId,
      delivery: "pending",
      failureMessage: null,
    },
  });
  tracker.begin(clientMessageId);
  assert.equal(tracker.resolveFailure(clientMessageId), "failed");
  state = reduceChatState(state, {
    type: "message-failed",
    clientMessageId,
    failureMessage: "전송하지 못했습니다.",
  });

  const confirmedMessage = {
    ...message({ id: "message-late-confirmation" }),
    clientMessageId,
  };
  tracker.confirm(confirmedMessage, "user-1");
  state = reduceChatState(state, {
    type: "message-created",
    message: confirmedMessage,
  });

  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].id, "message-late-confirmation");
  assert.equal(state.messages[0].delivery, "sent");
}

{
  let state = createChatState("workspace-1");
  const page = await loadChatMessagesIntoState({
    isCurrent: () => true,
    onMessages: (messages) => {
      state = reduceChatState(state, { type: "messages-merged", messages });
    },
    request: async () => ({
      items: [message({ id: "older-message" })],
      nextCursor: null,
    }),
  });

  assert.equal(page.items[0].id, "older-message");
  state = reduceChatState(state, {
    type: "message-deleted",
    payload: {
      workspaceId: "workspace-1",
      messageId: "older-message",
      deletedAt: "2026-07-16T00:10:00.000Z",
    },
  });
  assert.equal(state.messages[0].content, null);
  assert.deepEqual(state.messages[0].mentions, []);
}

{
  let state = createChatState("workspace-1");
  state = reduceChatState(state, {
    type: "message-deleted",
    payload: {
      workspaceId: "workspace-1",
      messageId: "context-delete-race",
      deletedAt: "2026-07-16T00:12:00.000Z",
    },
  });

  await loadChatMessagesIntoState({
    isCurrent: () => true,
    onMessages: (messages) => {
      state = reduceChatState(state, { type: "messages-merged", messages });
    },
    request: async () => ({
      items: [message({ id: "context-delete-race" })],
    }),
  });

  assert.equal(state.messages[0].content, null);
  assert.equal(state.messages[0].deletedAt, "2026-07-16T00:12:00.000Z");
}

{
  let state = createChatState("workspace-1");
  const context = await loadChatMessagesIntoState({
    isCurrent: () => true,
    onMessages: (messages) => {
      state = reduceChatState(state, { type: "messages-merged", messages });
    },
    request: async () => ({ items: [message({ id: "context-message" })] }),
  });

  assert.equal(context.items[0].id, "context-message");
  state = reduceChatState(state, {
    type: "message-deleted",
    payload: {
      workspaceId: "workspace-1",
      messageId: "context-message",
      deletedAt: "2026-07-16T00:11:00.000Z",
    },
  });
  assert.equal(state.messages[0].content, null);
}

{
  let merged = false;
  const staleResult = await loadChatMessagesIntoState({
    isCurrent: () => false,
    onMessages: () => {
      merged = true;
    },
    request: async () => ({
      items: [message({ id: "old-workspace-message" })],
      nextCursor: null,
    }),
  });

  assert.equal(staleResult, null);
  assert.equal(merged, false);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function waitForAbort(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => reject(new DOMException("aborted", "AbortError")),
      { once: true },
    );
  });
}

function message({
  content = "hello",
  deletedAt = null,
  id,
  createdAt = "2026-07-16T00:00:00.000Z",
}) {
  return {
    id,
    workspaceId: "workspace-1",
    clientMessageId: `client-${id}`,
    content,
    author: {
      id: "user-1",
      displayName: "PILO user",
      avatarUrl: null,
    },
    mentions: [],
    createdAt,
    deletedAt,
  };
}

function mention({
  id,
  messageId = `message-${id}`,
  readAt = null,
}) {
  return {
    id,
    readAt,
    messageId,
    excerpt: "mention excerpt",
    actor: {
      id: "user-2",
      displayName: "Mention actor",
      avatarUrl: null,
    },
    workspaceId: "workspace-1",
    workspaceName: "Workspace 1",
    createdAt: "2026-07-17T00:00:00.000Z",
  };
}

function summary(overrides = {}) {
  return {
    latestMessageId: null,
    lastReadMessageId: null,
    unreadCount: 0,
    mentionUnreadCount: 0,
    ...overrides,
  };
}

{
  const runner = createLatestRequestRunner();
  const first = deferred();
  const second = deferred();
  const applied = [];
  const errors = [];
  const firstRun = runner.run({
    request: () => first.promise,
    onSuccess: (value) => applied.push(value),
    onError: () => errors.push("first"),
    isAbortError,
  });
  const secondRun = runner.run({
    request: () => second.promise,
    onSuccess: (value) => applied.push(value),
    onError: () => errors.push("second"),
    isAbortError,
  });

  second.resolve("newest");
  assert.equal(await secondRun, "success");
  first.resolve("stale");
  assert.equal(await firstRun, "stale");
  assert.deepEqual(applied, ["newest"]);
  assert.deepEqual(errors, []);
}

{
  const runner = createLatestRequestRunner();
  const oldWorkspace = deferred();
  const applied = [];
  const oldRun = runner.run({
    request: () => oldWorkspace.promise,
    onSuccess: (value) => applied.push(value),
    onError: () => applied.push("error"),
    isAbortError,
  });
  runner.invalidate();
  oldWorkspace.resolve("old-workspace");

  assert.equal(await oldRun, "stale");
  assert.deepEqual(applied, []);
}

{
  const runner = createLatestRequestRunner();
  const errors = [];
  const abortResult = await runner.run({
    request: async () => {
      throw new DOMException("aborted", "AbortError");
    },
    onSuccess: () => undefined,
    onError: () => errors.push("abort"),
    isAbortError,
  });
  const failureResult = await runner.run({
    request: async () => {
      throw new Error("Bearer secret must not be surfaced");
    },
    onSuccess: () => undefined,
    onError: () => errors.push(CHAT_REFRESH_ERROR_MESSAGE),
    isAbortError,
  });

  assert.equal(abortResult, "aborted");
  assert.equal(failureResult, "error");
  assert.deepEqual(errors, [CHAT_REFRESH_ERROR_MESSAGE]);
  assert.doesNotMatch(errors[0], /Bearer|secret/);
}

{
  const scope = createWorkspaceRequestScope();
  const firstSignal = scope.activate("workspace-1");
  const secondSignal = scope.activate("workspace-2");

  assert.equal(firstSignal.aborted, true);
  assert.equal(secondSignal.aborted, false);
  assert.equal(scope.getSignal("workspace-1"), undefined);
  assert.equal(scope.getSignal("workspace-2"), secondSignal);

  scope.clear("workspace-2");
  assert.equal(secondSignal.aborted, true);
  assert.equal(scope.getSignal("workspace-2"), undefined);
}

{
  const calls = [];
  const snapshot = await loadChatRefresh({
    cachedSentMessageIds: [],
    loadSummary: async () => ({
      latestMessageId: "message-new",
      lastReadMessageId: null,
      unreadCount: 1,
      mentionUnreadCount: 0,
    }),
    loadMessages: async (before) => {
      calls.push(before);
      return {
        items: [message({ id: "message-new" })],
        nextCursor: "older-page",
      };
    },
  });

  assert.deepEqual(calls, [undefined]);
  assert.deepEqual(snapshot.messages.map(({ id }) => id), ["message-new"]);
}

{
  const calls = [];
  const snapshot = await loadChatRefresh({
    cachedSentMessageIds: ["message-latest", "message-older"],
    loadSummary: async () => ({
      latestMessageId: "message-latest",
      lastReadMessageId: null,
      unreadCount: 0,
      mentionUnreadCount: 0,
    }),
    loadMessages: async (before) => {
      calls.push(before);
      if (!before) {
        return {
          items: [
            message({
              id: "message-latest",
              content: null,
              deletedAt: "2026-07-16T00:10:00.000Z",
            }),
            message({ id: "message-missed" }),
          ],
          nextCursor: "older-page",
        };
      }
      return {
        items: [
          message({
            id: "message-older",
            content: null,
            deletedAt: "2026-07-16T00:09:00.000Z",
          }),
        ],
        nextCursor: "unused-page",
      };
    },
  });

  assert.deepEqual(calls, [undefined, "older-page"]);
  assert.deepEqual(
    snapshot.messages.map(({ id }) => id),
    ["message-latest", "message-missed", "message-older"],
  );
  assert.equal(snapshot.messages[0].content, null);
  assert.equal(snapshot.messages[2].content, null);
}

{
  const coordinator = createChatRefreshCoordinator();
  const workspaceController = new AbortController();
  const summaries = [];
  let deepRefreshes = 0;
  let summaryOnlyRefreshes = 0;
  let mentionRefreshes = 0;
  const actions = createChatRefreshActions({
    reconcile: async () => {
      deepRefreshes += 1;
    },
    refreshMentions: async () => {
      mentionRefreshes += 1;
    },
    refreshSummaryOnly: async () => {
      summaryOnlyRefreshes += 1;
      await coordinator.refreshSummaryOnly({
        isAbortError,
        loadSummary: async () => ({
          latestMessageId: "message-live",
          lastReadMessageId: null,
          unreadCount: 1,
          mentionUnreadCount: 0,
        }),
        onError: () => undefined,
        onSummary: (summary) => summaries.push(summary),
        parentSignal: workspaceController.signal,
      });
    },
  });

  await actions.afterMessageChange();
  await actions.afterMessageChange();
  await actions.afterMessageChange();
  await actions.afterMessageChange();
  await actions.afterMessageChange();
  await actions.afterLiveMention();

  assert.equal(deepRefreshes, 0);
  assert.equal(summaryOnlyRefreshes, 6);
  assert.equal(mentionRefreshes, 1);
  assert.equal(summaries.length, 6);

  await actions.reconcile();
  assert.equal(deepRefreshes, 1);
}

{
  const coordinator = createChatRefreshCoordinator();
  const workspaceController = new AbortController();
  const secondPageStarted = deferred();
  const firstCalls = [];
  const firstRun = coordinator.refreshDeep({
    cachedSentMessageIds: ["message-old"],
    isAbortError,
    loadSummary: async () => ({
      latestMessageId: "message-new",
      lastReadMessageId: null,
      unreadCount: 0,
      mentionUnreadCount: 0,
    }),
    loadMessages: async (before, signal) => {
      firstCalls.push(before);
      if (!before) {
        return {
          items: [message({ id: "message-new" })],
          nextCursor: "older-page",
        };
      }
      secondPageStarted.resolve();
      await waitForAbort(signal);
      return { items: [], nextCursor: "must-not-page" };
    },
    onDeepError: () => undefined,
    onDeepSuccess: () => undefined,
    onMessages: () => undefined,
    onSummary: () => undefined,
    parentSignal: workspaceController.signal,
  });
  await secondPageStarted.promise;

  const secondMessages = [];
  const secondRun = coordinator.refreshDeep({
    cachedSentMessageIds: [],
    isAbortError,
    loadSummary: async () => ({
      latestMessageId: "message-newest",
      lastReadMessageId: null,
      unreadCount: 0,
      mentionUnreadCount: 0,
    }),
    loadMessages: async () => ({
      items: [message({ id: "message-newest" })],
      nextCursor: null,
    }),
    onDeepError: () => undefined,
    onDeepSuccess: () => undefined,
    onMessages: (messages) => secondMessages.push(...messages),
    onSummary: () => undefined,
    parentSignal: workspaceController.signal,
  });

  assert.equal(await firstRun, "stale");
  assert.equal(await secondRun, "success");
  assert.deepEqual(firstCalls, [undefined, "older-page"]);
  assert.deepEqual(secondMessages.map(({ id }) => id), ["message-newest"]);
}

{
  const coordinator = createChatRefreshCoordinator();
  const workspaceController = new AbortController();
  const deepPage = deferred();
  const deepPageStarted = deferred();
  const appliedSummaries = [];
  const mergedMessages = [];
  const deepRun = coordinator.refreshDeep({
    cachedSentMessageIds: ["message-old"],
    isAbortError,
    loadSummary: async () => ({
      latestMessageId: "message-old-summary",
      lastReadMessageId: null,
      unreadCount: 4,
      mentionUnreadCount: 0,
    }),
    loadMessages: async () => {
      deepPageStarted.resolve();
      return deepPage.promise;
    },
    onDeepError: () => undefined,
    onDeepSuccess: () => undefined,
    onMessages: (messages) => mergedMessages.push(...messages),
    onSummary: (summary) => appliedSummaries.push(summary),
    parentSignal: workspaceController.signal,
  });
  await deepPageStarted.promise;

  await coordinator.refreshSummaryOnly({
    isAbortError,
    loadSummary: async () => ({
      latestMessageId: "message-live-summary",
      lastReadMessageId: "message-live-summary",
      unreadCount: 0,
      mentionUnreadCount: 0,
    }),
    onError: () => undefined,
    onSummary: (summary) => appliedSummaries.push(summary),
    parentSignal: workspaceController.signal,
  });
  deepPage.resolve({
    items: [
      message({
        id: "message-old",
        content: null,
        deletedAt: "2026-07-16T00:20:00.000Z",
      }),
    ],
    nextCursor: null,
  });

  assert.equal(await deepRun, "success");
  assert.deepEqual(
    appliedSummaries.map(({ latestMessageId }) => latestMessageId),
    ["message-live-summary"],
  );
  assert.equal(mergedMessages[0].content, null);
  assert.equal(mergedMessages[0].deletedAt, "2026-07-16T00:20:00.000Z");
}

function createFakeSocket({ connected = false, active = true } = {}) {
  const listeners = new Map();
  const emits = [];
  return {
    active,
    connected,
    emits,
    emit(event, payload) {
      emits.push([event, payload]);
    },
    fire(event, payload) {
      listeners.get(event)?.(payload);
    },
    off(event, listener) {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
    on(event, listener) {
      listeners.set(event, listener);
    },
  };
}

{
  const socket = createFakeSocket();
  const connectionStates = [];
  let reconnectRefreshes = 0;
  const lifecycle = createChatSocketLifecycle({
    clientEvents: chatClientEvents,
    socket,
    workspaceId: "workspace-1",
    onConnected: () => {
      reconnectRefreshes += 1;
    },
    onConnectionStateChange: (state) => connectionStates.push(state),
    onMentionCreated: () => undefined,
    onMessageCreated: () => undefined,
    onMessageDeleted: () => undefined,
    serverEvents: chatServerEvents,
  });

  lifecycle.start();
  assert.deepEqual(connectionStates, ["reconnecting"]);
  socket.connected = true;
  socket.fire("connect");
  assert.deepEqual(socket.emits[0], ["chat:join", { workspaceId: "workspace-1" }]);
  assert.equal(reconnectRefreshes, 1);
  socket.fire("disconnect");
  assert.equal(connectionStates.at(-1), "reconnecting");
  lifecycle.stop();
  assert.deepEqual(socket.emits.at(-1), [
    "chat:leave",
    { workspaceId: "workspace-1" },
  ]);
  socket.fire("connect");
  assert.equal(reconnectRefreshes, 1);
}

const provider = await readFile(
  new URL("./chat-runtime-provider.tsx", import.meta.url),
  "utf8",
);
assert.match(provider, /useAuthSession\(\)/);
assert.match(provider, /useRealtimeSocket\(\)/);
assert.match(
  provider,
  /const \[refreshCoordinator\] = useState\(createChatRefreshCoordinator\)/,
);
assert.match(
  provider,
  /const \[mentionsRequestRunner\] = useState\(createLatestRequestRunner\)/,
);
assert.match(provider, /createChatRefreshActions/);
assert.ok(
  (provider.match(/void refreshActions\.afterMessageChange\(\)/g) ?? [])
    .length >= 2,
);
assert.ok(
  (provider.match(/await refreshActions\.afterMessageChange\(\)/g) ?? [])
    .length >= 4,
);
assert.match(provider, /void refreshActions\.afterLiveMention\(\)/);
assert.match(
  provider,
  /markMentionRead[\s\S]*mentionsRequestRunner\.invalidate\(\)/,
);
assert.match(
  provider,
  /markMentionRead[\s\S]*applyChatMentionReadSuccess[\s\S]*startChatMentionReadReconciliation/,
);
assert.match(provider, /getWorkspaceCoherentChatSnapshot/);
assert.match(
  provider,
  /refreshMentionReadSummary[\s\S]*onError: \(\) => undefined/,
);
assert.match(provider, /errorMessage/);
assert.match(provider, /loadMessagePage/);
assert.match(provider, /loadMessageContext/);
assert.match(
  provider,
  /retryMessage[\s\S]*sendConfirmationTracker\.begin\(clientMessageId\)[\s\S]*resolveTrackedChatSendFailure/,
);
assert.match(provider, /mentionErrorMessage/);
assert.match(provider, /refreshMentions/);
assert.match(provider, /optimisticMentions/);
