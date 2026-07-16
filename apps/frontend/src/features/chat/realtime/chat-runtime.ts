import type {
  ChatMessagePage,
  ChatSummary,
  WorkspaceChatMessage
} from "@/features/chat/types";
import type {
  ChatMentionCreatedPayload,
  ChatMessageDeletedPayload
} from "./chat-events";

export const CHAT_REFRESH_ERROR_MESSAGE =
  "채팅 정보를 새로고침하지 못했습니다. 잠시 후 다시 시도해주세요.";

type LatestRequestStatus = "success" | "stale" | "aborted" | "error";

type LatestRequestOptions<T> = {
  request: () => Promise<T>;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
  isAbortError: (error: unknown) => boolean;
};

export function createLatestRequestRunner() {
  let generation = 0;

  return {
    invalidate() {
      generation += 1;
    },
    async run<T>({
      request,
      onSuccess,
      onError,
      isAbortError: readsAbortError
    }: LatestRequestOptions<T>): Promise<LatestRequestStatus> {
      const requestGeneration = ++generation;
      let value: T;

      try {
        value = await request();
      } catch (error) {
        if (requestGeneration !== generation) return "stale";
        if (readsAbortError(error)) return "aborted";
        onError(error);
        return "error";
      }

      if (requestGeneration !== generation) return "stale";
      onSuccess(value);
      return "success";
    }
  };
}

function createAbortableLatestRequestRunner() {
  let generation = 0;
  let activeController: AbortController | undefined;

  return {
    invalidate() {
      generation += 1;
      activeController?.abort();
      activeController = undefined;
    },
    async run<T>({
      parentSignal,
      request,
      onSuccess,
      onError,
      isAbortError: readsAbortError
    }: Omit<LatestRequestOptions<T>, "request"> & {
      parentSignal: AbortSignal;
      request: (signal: AbortSignal) => Promise<T>;
    }): Promise<LatestRequestStatus> {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const requestGeneration = ++generation;
      const abortFromParent = () => controller.abort();
      if (parentSignal.aborted) {
        controller.abort();
      } else {
        parentSignal.addEventListener("abort", abortFromParent, { once: true });
      }

      try {
        const value = await request(controller.signal);
        if (requestGeneration !== generation) return "stale";
        onSuccess(value);
        return "success";
      } catch (error) {
        if (requestGeneration !== generation) return "stale";
        if (readsAbortError(error)) return "aborted";
        onError(error);
        return "error";
      } finally {
        parentSignal.removeEventListener("abort", abortFromParent);
        if (activeController === controller) activeController = undefined;
      }
    }
  };
}

function createResultGeneration() {
  let generation = 0;
  return {
    issue() {
      generation += 1;
      return generation;
    },
    invalidate() {
      generation += 1;
    },
    isCurrent(ticket: number) {
      return ticket === generation;
    }
  };
}

export function createChatRefreshCoordinator() {
  const deepRunner = createAbortableLatestRequestRunner();
  const summaryRunner = createLatestRequestRunner();
  const summaryResults = createResultGeneration();

  return {
    invalidate() {
      deepRunner.invalidate();
      summaryRunner.invalidate();
      summaryResults.invalidate();
    },
    refreshSummaryOnly({
      isAbortError: readsAbortError,
      loadSummary,
      onError,
      onSummary,
      parentSignal
    }: {
      isAbortError: (error: unknown) => boolean;
      loadSummary: (signal: AbortSignal) => Promise<ChatSummary>;
      onError: (error: unknown) => void;
      onSummary: (summary: ChatSummary) => void;
      parentSignal: AbortSignal;
    }) {
      const summaryTicket = summaryResults.issue();
      return summaryRunner.run({
        request: () => loadSummary(parentSignal),
        isAbortError: readsAbortError,
        onError: (error) => {
          if (summaryResults.isCurrent(summaryTicket)) onError(error);
        },
        onSuccess: (summary) => {
          if (summaryResults.isCurrent(summaryTicket)) onSummary(summary);
        }
      });
    },
    refreshDeep({
      cachedSentMessageIds,
      isAbortError: readsAbortError,
      loadMessages,
      loadSummary,
      onDeepError,
      onDeepSuccess,
      onMessages,
      onSummary,
      parentSignal
    }: {
      cachedSentMessageIds: string[];
      isAbortError: (error: unknown) => boolean;
      loadMessages: (
        before: string | undefined,
        signal: AbortSignal
      ) => Promise<ChatMessagePage>;
      loadSummary: (signal: AbortSignal) => Promise<ChatSummary>;
      onDeepError: (error: unknown) => void;
      onDeepSuccess: () => void;
      onMessages: (messages: WorkspaceChatMessage[]) => void;
      onSummary: (summary: ChatSummary) => void;
      parentSignal: AbortSignal;
    }) {
      const summaryTicket = summaryResults.issue();
      return deepRunner.run({
        parentSignal,
        request: (signal) =>
          loadChatRefresh({
            cachedSentMessageIds,
            loadSummary: () => loadSummary(signal),
            loadMessages: (before) => loadMessages(before, signal)
          }),
        isAbortError: readsAbortError,
        onError: onDeepError,
        onSuccess: (snapshot) => {
          onMessages(snapshot.messages);
          onDeepSuccess();
          if (summaryResults.isCurrent(summaryTicket)) {
            onSummary(snapshot.summary);
          }
        }
      });
    }
  };
}

export function createChatRefreshActions({
  reconcile,
  refreshMentions,
  refreshSummaryOnly
}: {
  reconcile: () => Promise<void>;
  refreshMentions: () => Promise<void>;
  refreshSummaryOnly: () => Promise<void>;
}) {
  return {
    reconcile,
    afterMessageChange: refreshSummaryOnly,
    async afterLiveMention() {
      await Promise.all([refreshSummaryOnly(), refreshMentions()]);
    }
  };
}

export function createWorkspaceRequestScope() {
  let current:
    | {
        controller: AbortController;
        workspaceId: string;
      }
    | undefined;

  return {
    activate(workspaceId: string) {
      current?.controller.abort();
      const controller = new AbortController();
      current = { controller, workspaceId };
      return controller.signal;
    },
    clear(workspaceId: string) {
      if (current?.workspaceId !== workspaceId) return;
      current.controller.abort();
      current = undefined;
    },
    getSignal(workspaceId: string) {
      return current?.workspaceId === workspaceId
        ? current.controller.signal
        : undefined;
    }
  };
}

export async function loadChatRefresh({
  cachedSentMessageIds,
  loadSummary,
  loadMessages
}: {
  cachedSentMessageIds: string[];
  loadSummary: () => Promise<ChatSummary>;
  loadMessages: (before?: string) => Promise<ChatMessagePage>;
}) {
  const summary = await loadSummary();
  const remainingCachedIds = new Set(cachedSentMessageIds);
  const messages: WorkspaceChatMessage[] = [];
  let before: string | undefined;

  do {
    const page = await loadMessages(before);
    messages.push(...page.items);
    for (const message of page.items) {
      remainingCachedIds.delete(message.id);
    }

    if (cachedSentMessageIds.length === 0) break;
    before = page.nextCursor ?? undefined;
  } while (before && remainingCachedIds.size > 0);

  return { messages, summary };
}

type ChatSocketEventMap = {
  join: string;
  leave: string;
};

type ChatServerEventMap = {
  messageCreated: string;
  messageDeleted: string;
  mentionCreated: string;
};

type ChatRuntimeSocket = {
  active: boolean;
  connected: boolean;
  emit(event: string, payload: { workspaceId: string }): unknown;
  on(event: string, listener: (payload?: never) => void): unknown;
  off(event: string, listener: (payload?: never) => void): unknown;
};

export function createChatSocketLifecycle({
  clientEvents,
  onConnected,
  onConnectionStateChange,
  onMentionCreated,
  onMessageCreated,
  onMessageDeleted,
  serverEvents,
  socket,
  workspaceId
}: {
  clientEvents: ChatSocketEventMap;
  onConnected: () => void;
  onConnectionStateChange: (
    state: "connected" | "reconnecting" | "offline"
  ) => void;
  onMentionCreated: (payload: ChatMentionCreatedPayload) => void;
  onMessageCreated: (message: WorkspaceChatMessage) => void;
  onMessageDeleted: (payload: ChatMessageDeletedPayload) => void;
  serverEvents: ChatServerEventMap;
  socket: ChatRuntimeSocket;
  workspaceId: string;
}) {
  const room = { workspaceId };
  let started = false;
  const handleConnect = () => {
    onConnectionStateChange("connected");
    socket.emit(clientEvents.join, room);
    onConnected();
  };
  const handleDisconnect = () => {
    onConnectionStateChange(socket.active ? "reconnecting" : "offline");
  };

  return {
    start() {
      if (started) return;
      started = true;
      socket.on("connect", handleConnect);
      socket.on("disconnect", handleDisconnect);
      socket.on(serverEvents.messageCreated, onMessageCreated as () => void);
      socket.on(serverEvents.messageDeleted, onMessageDeleted as () => void);
      socket.on(serverEvents.mentionCreated, onMentionCreated as () => void);

      if (socket.connected) {
        handleConnect();
      } else {
        handleDisconnect();
      }
    },
    stop() {
      if (!started) return;
      started = false;
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off(serverEvents.messageCreated, onMessageCreated as () => void);
      socket.off(serverEvents.messageDeleted, onMessageDeleted as () => void);
      socket.off(serverEvents.mentionCreated, onMentionCreated as () => void);
      socket.emit(clientEvents.leave, room);
    }
  };
}

export function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
