"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from "react";
import { usePathname } from "next/navigation";

import { useAuthSession } from "@/features/auth";
import {
  createChatMessage,
  deleteChatMessage,
  getChatMessageContext,
  getChatSummary,
  listChatMentions,
  listChatMessages,
  readChatMention,
  updateChatReadState
} from "@/features/chat/api/client";
import type {
  ChatMentionNotification,
  ChatMessageContext,
  ChatMessagePage,
  ChatSendOutcome,
  ChatSummary,
  CreateChatMessageInput,
  WorkspaceChatMention,
  WorkspaceChatMessage
} from "@/features/chat/types";
import { useRealtimeSocket } from "@/shared/realtime/realtime-provider";
import { chatClientEvents, chatServerEvents } from "./chat-events";
import {
  createChatState,
  reduceChatState,
  type ChatState
} from "./chat-reducer";
import {
  createOptimisticChatMentions,
  createChatRefreshActions,
  createChatRefreshCoordinator,
  createChatMentionReadTracker,
  createChatSendConfirmationTracker,
  createChatSocketLifecycle,
  createLatestRequestRunner,
  createWorkspaceRequestScope,
  applyChatMentionReadSuccess,
  getChatRefreshErrorMessages,
  getWorkspaceCoherentChatSnapshot,
  isAbortError,
  loadChatMessagesIntoState,
  mergeChatMentionNotifications,
  startChatMentionReadReconciliation,
  resolveTrackedChatSendFailure
} from "./chat-runtime";

type ChatConnectionState = "connected" | "reconnecting" | "offline";
type RefreshChannel = "deep" | "summary" | "mentions";

export type ChatRuntimeValue = {
  state: ChatState;
  summary: ChatSummary;
  mentions: ChatMentionNotification[];
  connectionState: ChatConnectionState;
  errorMessage: string | null;
  mentionErrorMessage: string | null;
  refreshSummary(): Promise<void>;
  refreshMentions(): Promise<void>;
  loadMessagePage(before?: string): Promise<ChatMessagePage | null>;
  loadMessageContext(messageId: string): Promise<ChatMessageContext | null>;
  sendMessage(
    input: CreateChatMessageInput,
    optimisticMentions?: WorkspaceChatMention[]
  ): Promise<ChatSendOutcome>;
  retryMessage(clientMessageId: string): Promise<void>;
  removeMessage(messageId: string): Promise<void>;
  markRead(messageId: string): Promise<void>;
  markMentionRead(mentionId: string): Promise<void>;
};

const emptySummary: ChatSummary = {
  latestMessageId: null,
  lastReadMessageId: null,
  unreadCount: 0,
  mentionUnreadCount: 0
};

const ChatRuntimeContext = createContext<ChatRuntimeValue | null>(null);

export function ChatRuntimeProvider({ children }: { children: ReactNode }) {
  const authSession = useAuthSession();
  const socket = useRealtimeSocket();
  const pathname = usePathname();
  const accessToken = authSession?.accessToken.trim() ?? "";
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const [state, dispatch] = useReducer(
    reduceChatState,
    workspaceId,
    createChatState
  );
  const [summary, setSummary] = useState<ChatSummary>(emptySummary);
  const [mentions, setMentions] = useState<ChatMentionNotification[]>([]);
  const [connectionState, setConnectionState] =
    useState<ChatConnectionState>("offline");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mentionErrorMessage, setMentionErrorMessage] = useState<
    string | null
  >(null);
  const [requestScope] = useState(createWorkspaceRequestScope);
  const [refreshCoordinator] = useState(createChatRefreshCoordinator);
  const [mentionsRequestRunner] = useState(createLatestRequestRunner);
  const [mentionReadTracker] = useState(createChatMentionReadTracker);
  const [sendConfirmationTracker] = useState(
    createChatSendConfirmationTracker
  );
  const stateRef = useRef(state);
  const mentionsRef = useRef(mentions);
  const summaryRef = useRef(summary);
  const activeWorkspaceIdRef = useRef(workspaceId);
  const previousChatRouteRef = useRef(false);
  const refreshErrorsRef = useRef<Record<RefreshChannel, boolean>>({
    deep: false,
    summary: false,
    mentions: false
  });

  stateRef.current = state;
  mentionsRef.current = mentions;
  summaryRef.current = summary;
  activeWorkspaceIdRef.current = workspaceId;

  const setRefreshError = useCallback(
    (channel: RefreshChannel, hasError: boolean) => {
      const nextErrors = {
        ...refreshErrorsRef.current,
        [channel]: hasError
      };
      refreshErrorsRef.current = nextErrors;
      const messages = getChatRefreshErrorMessages(nextErrors);
      setErrorMessage(messages.errorMessage);
      setMentionErrorMessage(messages.mentionErrorMessage);
    },
    []
  );

  const getRequestSignal = useCallback(
    (targetWorkspaceId: string) => requestScope.getSignal(targetWorkspaceId),
    [requestScope]
  );

  const refreshMentions = useCallback(async () => {
    if (!accessToken || !workspaceId) return;
    const signal = getRequestSignal(workspaceId);
    if (!signal || signal.aborted) return;

    await mentionsRequestRunner.run({
      request: () => listChatMentions(accessToken, workspaceId, { signal }),
      isAbortError,
      onSuccess: (page) => {
        if (activeWorkspaceIdRef.current !== workspaceId) return;
        setMentions((currentMentions) => {
          const nextMentions = mergeChatMentionNotifications({
            current: currentMentions.filter(
              (mention) => mention.workspaceId === workspaceId
            ),
            incoming: page.items
          });
          mentionsRef.current = nextMentions;
          return nextMentions;
        });
        setRefreshError("mentions", false);
      },
      onError: () => {
        if (activeWorkspaceIdRef.current === workspaceId) {
          setRefreshError("mentions", true);
        }
      }
    });
  }, [
    accessToken,
    getRequestSignal,
    mentionsRequestRunner,
    setRefreshError,
    workspaceId
  ]);

  const refreshSummaryOnly = useCallback(async () => {
    if (!accessToken || !workspaceId) return;
    const signal = getRequestSignal(workspaceId);
    if (!signal || signal.aborted) return;

    await refreshCoordinator.refreshSummaryOnly({
      parentSignal: signal,
      loadSummary: (requestSignal) =>
        getChatSummary(accessToken, workspaceId, { signal: requestSignal }),
      isAbortError,
      onSummary: (nextSummary) => {
        if (activeWorkspaceIdRef.current !== workspaceId) return;
        setSummary(nextSummary);
        setRefreshError("summary", false);
      },
      onError: () => {
        if (activeWorkspaceIdRef.current === workspaceId) {
          setRefreshError("summary", true);
        }
      }
    });
  }, [
    accessToken,
    getRequestSignal,
    refreshCoordinator,
    setRefreshError,
    workspaceId
  ]);

  const refreshMentionReadSummary = useCallback(async () => {
    if (!accessToken || !workspaceId) return;
    const signal = getRequestSignal(workspaceId);
    if (!signal || signal.aborted) return;

    await refreshCoordinator.refreshSummaryOnly({
      parentSignal: signal,
      loadSummary: (requestSignal) =>
        getChatSummary(accessToken, workspaceId, { signal: requestSignal }),
      isAbortError,
      onSummary: (nextSummary) => {
        if (activeWorkspaceIdRef.current !== workspaceId) return;
        summaryRef.current = nextSummary;
        setSummary(nextSummary);
        setRefreshError("summary", false);
      },
      onError: () => undefined
    });
  }, [
    accessToken,
    getRequestSignal,
    refreshCoordinator,
    setRefreshError,
    workspaceId
  ]);

  const refreshSummary = useCallback(async () => {
    if (!accessToken || !workspaceId) return;
    const signal = getRequestSignal(workspaceId);
    if (!signal || signal.aborted) return;
    const currentState = stateRef.current;
    const cachedSentMessageIds =
      currentState.workspaceId === workspaceId
        ? currentState.messages
            .filter(({ delivery }) => delivery === "sent")
            .map(({ id }) => id)
        : [];

    await refreshCoordinator.refreshDeep({
      cachedSentMessageIds,
      parentSignal: signal,
      loadSummary: (requestSignal) =>
        getChatSummary(accessToken, workspaceId, { signal: requestSignal }),
      loadMessages: (before, requestSignal) =>
        listChatMessages(accessToken, workspaceId, {
          ...(before ? { before } : {}),
          signal: requestSignal
        }),
      isAbortError,
      onMessages: (messages) => {
        if (activeWorkspaceIdRef.current !== workspaceId) return;
        dispatch({ type: "messages-merged", messages });
      },
      onSummary: (nextSummary) => {
        if (activeWorkspaceIdRef.current !== workspaceId) return;
        setSummary(nextSummary);
        setRefreshError("summary", false);
      },
      onDeepSuccess: () => {
        if (activeWorkspaceIdRef.current === workspaceId) {
          setRefreshError("deep", false);
        }
      },
      onDeepError: () => {
        if (activeWorkspaceIdRef.current === workspaceId) {
          setRefreshError("deep", true);
        }
      }
    });
  }, [
    accessToken,
    getRequestSignal,
    refreshCoordinator,
    setRefreshError,
    workspaceId
  ]);

  const refreshActions = useMemo(
    () =>
      createChatRefreshActions({
        reconcile: refreshSummary,
        refreshMentions,
        refreshSummaryOnly
      }),
    [refreshMentions, refreshSummary, refreshSummaryOnly]
  );

  useEffect(() => {
    refreshCoordinator.invalidate();
    mentionsRequestRunner.invalidate();
    requestScope.activate(workspaceId);
    dispatch({ type: "workspace-reset", workspaceId });
    summaryRef.current = emptySummary;
    mentionsRef.current = [];
    setSummary(emptySummary);
    setMentions([]);
    refreshErrorsRef.current = {
      deep: false,
      summary: false,
      mentions: false
    };
    setErrorMessage(null);
    setMentionErrorMessage(null);
    sendConfirmationTracker.reset();
    mentionReadTracker.reset();

    if (accessToken && workspaceId) {
      void refreshActions.reconcile();
      void refreshMentions();
    }

    return () => {
      refreshCoordinator.invalidate();
      mentionsRequestRunner.invalidate();
      mentionReadTracker.reset();
      requestScope.clear(workspaceId);
    };
  }, [
    accessToken,
    mentionsRequestRunner,
    mentionReadTracker,
    refreshActions,
    refreshCoordinator,
    refreshMentions,
    requestScope,
    sendConfirmationTracker,
    workspaceId
  ]);

  useEffect(() => {
    if (!socket || !workspaceId) {
      setConnectionState("offline");
      return;
    }

    const refreshAfterReconnect = () => {
      void refreshActions.reconcile();
      void refreshMentions();
    };
    const lifecycle = createChatSocketLifecycle({
      clientEvents: chatClientEvents,
      onConnected: refreshAfterReconnect,
      onConnectionStateChange: setConnectionState,
      onMessageCreated: (message) => {
        if (message.workspaceId !== workspaceId) return;
        sendConfirmationTracker.confirm(
          message,
          authSession?.user.id ?? ""
        );
        dispatch({ type: "message-created", message });
        void refreshActions.afterMessageChange();
      },
      onMessageDeleted: (payload) => {
        if (payload.workspaceId !== workspaceId) return;
        dispatch({ type: "message-deleted", payload });
        void refreshActions.afterMessageChange();
      },
      onMentionCreated: (payload) => {
        if (payload.message.workspaceId !== workspaceId) return;
        void refreshActions.afterLiveMention();
      },
      serverEvents: chatServerEvents,
      socket,
      workspaceId
    });

    lifecycle.start();
    return lifecycle.stop;
  }, [
    authSession?.user.id,
    refreshActions,
    refreshMentions,
    sendConfirmationTracker,
    socket,
    workspaceId
  ]);

  useEffect(() => {
    const handleFocus = () => {
      void refreshActions.reconcile();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshActions]);

  useEffect(() => {
    const isChatRoute =
      pathname === "/chat" || pathname.startsWith("/chat/");
    if (isChatRoute && !previousChatRouteRef.current) {
      void refreshActions.reconcile();
    }
    previousChatRouteRef.current = isChatRoute;
  }, [pathname, refreshActions]);

  const sendMessage = useCallback(
    async (
      input: CreateChatMessageInput,
      optimisticMentions: WorkspaceChatMention[] = []
    ): Promise<ChatSendOutcome> => {
      if (!accessToken || !workspaceId || !authSession) return "failed";
      sendConfirmationTracker.begin(input.clientMessageId);
      const optimisticMessage = createOptimisticMessage({
        input,
        optimisticMentions,
        workspaceId,
        author: {
          id: authSession.user.id,
          displayName: authSession.user.displayName,
          avatarUrl: authSession.user.avatarUrl
        }
      });
      dispatch({ type: "optimistic-added", message: optimisticMessage });

      try {
        const message = await createChatMessage(
          accessToken,
          workspaceId,
          input,
          { signal: getRequestSignal(workspaceId) }
        );
        if (activeWorkspaceIdRef.current !== workspaceId) {
          sendConfirmationTracker.complete(input.clientMessageId);
          return "failed";
        }
        dispatch({ type: "message-created", message });
        await refreshActions.afterMessageChange();
        sendConfirmationTracker.complete(input.clientMessageId);
        return "sent";
      } catch (error) {
        if (isAbortError(error) || activeWorkspaceIdRef.current !== workspaceId) {
          sendConfirmationTracker.complete(input.clientMessageId);
          return "failed";
        }
        return resolveTrackedChatSendFailure({
          clientMessageId: input.clientMessageId,
          tracker: sendConfirmationTracker,
          onFailure: () =>
            dispatch({
              type: "message-failed",
              clientMessageId: input.clientMessageId,
              failureMessage: getFailureMessage(error)
            })
        });
      }
    },
    [
      accessToken,
      authSession,
      getRequestSignal,
      refreshActions,
      sendConfirmationTracker,
      workspaceId
    ]
  );

  const loadMessagePage = useCallback(
    async (before?: string) => {
      if (!accessToken || !workspaceId) return null;
      const signal = getRequestSignal(workspaceId);
      if (!signal || signal.aborted) return null;

      return loadChatMessagesIntoState({
        request: () =>
          listChatMessages(accessToken, workspaceId, {
            ...(before ? { before } : {}),
            signal
          }),
        isCurrent: () =>
          activeWorkspaceIdRef.current === workspaceId && !signal.aborted,
        onMessages: (messages) =>
          dispatch({ type: "messages-merged", messages })
      });
    },
    [accessToken, getRequestSignal, workspaceId]
  );

  const loadMessageContext = useCallback(
    async (messageId: string) => {
      if (!accessToken || !workspaceId) return null;
      const signal = getRequestSignal(workspaceId);
      if (!signal || signal.aborted) return null;

      return loadChatMessagesIntoState({
        request: () =>
          getChatMessageContext(accessToken, workspaceId, messageId, {
            signal
          }),
        isCurrent: () =>
          activeWorkspaceIdRef.current === workspaceId && !signal.aborted,
        onMessages: (messages) =>
          dispatch({ type: "messages-merged", messages })
      });
    },
    [accessToken, getRequestSignal, workspaceId]
  );

  const retryMessage = useCallback(
    async (clientMessageId: string) => {
      if (!accessToken || !workspaceId) return;
      const currentState = stateRef.current;
      const messageId = currentState.messageIdByClientId[clientMessageId];
      const message = messageId ? currentState.messagesById[messageId] : null;
      if (!message || message.content === null || message.delivery !== "failed") {
        return;
      }

      sendConfirmationTracker.begin(clientMessageId);
      dispatch({ type: "message-retrying", clientMessageId });
      const input: CreateChatMessageInput = {
        clientMessageId,
        content: message.content,
        mentionedUserIds: message.mentions.map(({ userId }) => userId)
      };
      try {
        const confirmedMessage = await createChatMessage(
          accessToken,
          workspaceId,
          input,
          { signal: getRequestSignal(workspaceId) }
        );
        if (activeWorkspaceIdRef.current !== workspaceId) {
          sendConfirmationTracker.complete(clientMessageId);
          return;
        }
        dispatch({ type: "message-created", message: confirmedMessage });
        await refreshActions.afterMessageChange();
        sendConfirmationTracker.complete(clientMessageId);
      } catch (error) {
        if (isAbortError(error) || activeWorkspaceIdRef.current !== workspaceId) {
          sendConfirmationTracker.complete(clientMessageId);
          return;
        }
        resolveTrackedChatSendFailure({
          clientMessageId,
          tracker: sendConfirmationTracker,
          onFailure: () =>
            dispatch({
              type: "message-failed",
              clientMessageId,
              failureMessage: getFailureMessage(error)
            })
        });
      }
    },
    [
      accessToken,
      getRequestSignal,
      refreshActions,
      sendConfirmationTracker,
      workspaceId
    ]
  );

  const removeMessage = useCallback(
    async (messageId: string) => {
      if (!accessToken || !workspaceId) return;
      const message = await deleteChatMessage(
        accessToken,
        workspaceId,
        messageId,
        { signal: getRequestSignal(workspaceId) }
      );
      if (
        activeWorkspaceIdRef.current !== workspaceId ||
        !message.deletedAt
      ) {
        return;
      }
      dispatch({
        type: "message-deleted",
        payload: {
          workspaceId,
          messageId: message.id,
          deletedAt: message.deletedAt
        }
      });
      await refreshActions.afterMessageChange();
    },
    [accessToken, getRequestSignal, refreshActions, workspaceId]
  );

  const markRead = useCallback(
    async (messageId: string) => {
      if (!accessToken || !workspaceId) return;
      await updateChatReadState(accessToken, workspaceId, messageId, {
        signal: getRequestSignal(workspaceId)
      });
      await refreshActions.afterMessageChange();
    },
    [accessToken, getRequestSignal, refreshActions, workspaceId]
  );

  const markMentionRead = useCallback(
    async (mentionId: string) => {
      if (!accessToken || !workspaceId) return;
      const currentMention = mentionsRef.current.find(
        (mention) => mention.id === mentionId
      );
      if (currentMention?.readAt) return;

      const signal = getRequestSignal(workspaceId);
      if (!signal || signal.aborted) return;
      await mentionReadTracker.run({
        workspaceId,
        mentionId,
        request: () =>
          readChatMention(accessToken, workspaceId, mentionId, { signal }),
        isCurrent: () =>
          activeWorkspaceIdRef.current === workspaceId && !signal.aborted,
        onSuccess: (mention) => {
          const result = applyChatMentionReadSuccess({
            mention,
            mentions: mentionsRef.current,
            summary: summaryRef.current
          });
          mentionsRef.current = result.mentions;
          summaryRef.current = result.summary;
          mentionsRequestRunner.invalidate();
          setMentions(result.mentions);
          setSummary(result.summary);
          startChatMentionReadReconciliation({
            refreshMentions,
            refreshSummary: refreshMentionReadSummary
          });
        }
      });
    },
    [
      accessToken,
      getRequestSignal,
      mentionReadTracker,
      mentionsRequestRunner,
      refreshMentionReadSummary,
      refreshMentions,
      workspaceId
    ]
  );

  const coherentSnapshot = useMemo(
    () =>
      getWorkspaceCoherentChatSnapshot({
        errorMessage,
        mentionErrorMessage,
        mentions,
        state,
        summary,
        workspaceId
      }),
    [
      errorMessage,
      mentionErrorMessage,
      mentions,
      state,
      summary,
      workspaceId
    ]
  );

  const contextValue = useMemo<ChatRuntimeValue>(
    () => ({
      state: coherentSnapshot.state,
      summary: coherentSnapshot.summary,
      mentions: coherentSnapshot.mentions,
      connectionState,
      errorMessage: coherentSnapshot.errorMessage,
      mentionErrorMessage: coherentSnapshot.mentionErrorMessage,
      refreshSummary: refreshActions.reconcile,
      refreshMentions,
      loadMessagePage,
      loadMessageContext,
      sendMessage,
      retryMessage,
      removeMessage,
      markRead,
      markMentionRead
    }),
    [
      connectionState,
      coherentSnapshot,
      loadMessageContext,
      loadMessagePage,
      markMentionRead,
      markRead,
      refreshActions,
      refreshMentions,
      removeMessage,
      retryMessage,
      sendMessage,
    ]
  );

  return (
    <ChatRuntimeContext.Provider value={contextValue}>
      {children}
    </ChatRuntimeContext.Provider>
  );
}

export function useChatRuntime() {
  const context = useContext(ChatRuntimeContext);
  if (!context) {
    throw new Error("useChatRuntime must be used inside ChatRuntimeProvider");
  }
  return context;
}

function createOptimisticMessage({
  input,
  optimisticMentions,
  workspaceId,
  author
}: {
  input: CreateChatMessageInput;
  optimisticMentions: WorkspaceChatMention[];
  workspaceId: string;
  author: NonNullable<WorkspaceChatMessage["author"]>;
}) {
  return {
    id: `pending:${input.clientMessageId}`,
    workspaceId,
    clientMessageId: input.clientMessageId,
    content: input.content,
    author,
    mentions: createOptimisticChatMentions(
      input.mentionedUserIds,
      optimisticMentions
    ),
    createdAt: new Date().toISOString(),
    deletedAt: null,
    delivery: "pending" as const,
    failureMessage: null
  };
}

function getFailureMessage(error: unknown) {
  return error instanceof Error ? error.message : "메시지를 전송하지 못했습니다.";
}
