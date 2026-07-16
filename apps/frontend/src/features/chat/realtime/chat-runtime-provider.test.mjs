import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import * as chatRuntime from "./chat-runtime.ts";

const {
  CHAT_REFRESH_ERROR_MESSAGE,
  createChatRefreshActions,
  createChatRefreshCoordinator,
  createChatSocketLifecycle,
  createLatestRequestRunner,
  createWorkspaceRequestScope,
  isAbortError,
  loadChatRefresh,
} = chatRuntime;
import { chatClientEvents, chatServerEvents } from "./chat-events.ts";

assert.equal(typeof createChatRefreshActions, "function");
assert.equal(typeof createChatRefreshCoordinator, "function");

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
    .length >= 5,
);
assert.match(provider, /void refreshActions\.afterLiveMention\(\)/);
assert.match(
  provider,
  /markMentionRead[\s\S]*mentionsRequestRunner\.invalidate\(\)/,
);
assert.match(provider, /errorMessage/);
