"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  FileText,
  Loader2,
  MessageCircle,
  SendHorizontal,
  SquarePen,
  Workflow,
  Wrench,
  X
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { useAuthSession } from "@/features/auth";
import {
  AgentApiError,
  createAgentApiClient
} from "@/features/agent/api/client";
import { AgentConfirmationCard } from "@/features/agent/components/agent-confirmation-card";
import { AgentCandidateSelections } from "@/features/agent/components/agent-candidate-selections";
import { AgentResourceLinks } from "@/features/agent/components/agent-resource-links";
import { AgentCanvasArtifact } from "@/features/agent/components/agent-canvas-artifact";
import { applyAgentSqlErdTableFocus } from "@/features/agent/resource-links";
import {
  getCanvasAgentDelegationAdapter,
  subscribeCanvasAgentDelegationAdapter,
} from "@/features/agent/canvas-delegation-context";
import { readAgentRequestContext } from "@/features/agent/request-context";
import { shouldFallbackToLegacyMessageApiCode } from "@/features/agent/message-routing-policy";
import {
  didAgentRunAcceptInput,
  getLatestAgentRunMessageSequence
} from "@/features/agent/run-input-recovery";
import type {
  AgentMessageDisposition,
  AgentMessagePayload,
  AgentRun,
  AgentRunRequestContext,
  RouteAgentMessageInput,
  SubmitAgentRunInput
} from "@/features/agent/types";
import { enqueueMeetingConnectionAction } from "@/features/meeting/stores/meeting-connection-action-store";
import { stageSqlErdAgentTableFocus } from "@/features/sql-erd/utils/agent-table-focus";
import { cn } from "@/lib/utils";

type AgentChatMessage = {
  id: string;
  content: string;
  routingChoice?: {
    activeRunId: string;
    clientRequestId: string;
    conversationId: string;
    message: string;
    requestContext: AgentRunRequestContext;
    targetMessageId: string | null;
    timezone: string;
  };
  run?: AgentRun;
  role: "assistant" | "user";
};

type AgentConfirmationActionState = {
  action: "approve" | "reject";
  confirmationId: string;
  messageId: string;
};

type AgentChatBusyState = "idle" | "polling" | "submitting";

const AGENT_RUN_POLL_INTERVAL_MS = 1800;
const AGENT_PLANNING_POLL_TIMEOUT_MS = 270_000;
const DEFAULT_AGENT_TIMEZONE = "Asia/Seoul";
const MAX_MEETING_CLIENT_ACTION_EXPIRY_SECONDS = 300;
const MAX_PERSISTED_AGENT_MESSAGES = 20;
const MAX_PERSISTED_AGENT_STORAGE_CHARS = 200_000;
const AGENT_CONVERSATION_STORAGE_VERSION = 1;
const AGENT_RUN_STATUSES = new Set<AgentRun["status"]>([
  "planning",
  "waiting_user_input",
  "waiting_confirmation",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

const initialMessages: AgentChatMessage[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    content:
      "안녕하세요, PILO AI입니다.\n일정 관리, 회의록 확인 등 다양한 업무를 스마트하게 도와드릴게요.\n어떤 업무를 도와드릴까요?"
  }
];

function getConversationStorageKey(userId: string, workspaceId: string) {
  return `pilo-agent-conversation:${userId}:${workspaceId}`;
}

function readPersistedConversation(storageKey: string): {
  conversationId: string;
  messages: AgentChatMessage[];
} | null {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "null"
    );
    if (
      !isRecord(value) ||
      value.version !== AGENT_CONVERSATION_STORAGE_VERSION ||
      typeof value.conversationId !== "string" ||
      !Array.isArray(value.messages)
    ) {
      return null;
    }
    const messages = value.messages.flatMap((message): AgentChatMessage[] => {
      if (
        !isRecord(message) ||
        typeof message.id !== "string" ||
        typeof message.content !== "string" ||
        (message.role !== "assistant" && message.role !== "user")
      ) {
        return [];
      }
      const run = isPersistedAgentRun(message.run) ? message.run : undefined;
      return [
        {
          id: message.id,
          content: message.content,
          role: message.role,
          ...(run ? { run } : {})
        }
      ];
    });
    return messages.length > 0
      ? { conversationId: value.conversationId, messages }
      : null;
  } catch {
    return null;
  }
}

function persistConversation(
  storageKey: string,
  conversationId: string,
  messages: AgentChatMessage[]
) {
  try {
    const persistedMessages = messages.slice(-MAX_PERSISTED_AGENT_MESSAGES);
    let serialized = JSON.stringify({
      version: AGENT_CONVERSATION_STORAGE_VERSION,
      conversationId,
      messages: persistedMessages
    });
    while (
      serialized.length > MAX_PERSISTED_AGENT_STORAGE_CHARS &&
      persistedMessages.length > 1
    ) {
      persistedMessages.shift();
      serialized = JSON.stringify({
        version: AGENT_CONVERSATION_STORAGE_VERSION,
        conversationId,
        messages: persistedMessages
      });
    }
    window.localStorage.setItem(storageKey, serialized);
  } catch {
    // Storage may be disabled or full; the server conversation remains valid.
  }
}

function isPersistedAgentRun(value: unknown): value is AgentRun {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.conversationId === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.status === "string" &&
    AGENT_RUN_STATUSES.has(value.status as AgentRun["status"]) &&
    Array.isArray(value.messages) &&
    Array.isArray(value.steps) &&
    (value.confirmation === null || isRecord(value.confirmation))
  );
}

function createClientId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getBrowserTimezone() {
  if (typeof Intl === "undefined") {
    return DEFAULT_AGENT_TIMEZONE;
  }

  return (
    Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_AGENT_TIMEZONE
  );
}

function createAbortError() {
  const error = new Error("Agent run polling was aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function createAgentPlanningPollingTimeoutError() {
  return new Error(
    "요청 처리 시간이 초과되었습니다. 잠시 후 다시 시도해주세요."
  );
}

function waitForAgentRunPollInterval(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    const handleAbort = () => {
      window.clearTimeout(timeoutId);
      reject(createAbortError());
    };
    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, AGENT_RUN_POLL_INTERVAL_MS);

    signal.addEventListener("abort", handleAbort, {
      once: true
    });
  });
}

function shouldStopPolling(run: AgentRun) {
  return (
    run.status === "waiting_user_input" ||
    run.status === "waiting_confirmation" ||
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "cancelled"
  );
}

function isRunAwaitingClarification(run: AgentRun | undefined) {
  if (run?.status !== "waiting_user_input") {
    return false;
  }

  const latestCompletedDecision = [...run.steps]
    .reverse()
    .find(
      (step) =>
        step.status === "completed" &&
        (step.type === "planner" || step.type === "tool")
    );

  return latestCompletedDecision?.outputSummary?.status === "needs_clarification";
}

function getActivePlannerStepId(run: AgentRun) {
  return (
    [...run.steps]
      .reverse()
      .find((step) => step.type === "planner" && step.status === "running")
      ?.id ?? null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getMeetingConnectionAction(run: AgentRun) {
  const completedSteps = run.steps
    .filter((step) => step.status === "completed" && step.completedAt)
    .sort((left, right) => {
      const completedAtDifference =
        Date.parse(right.completedAt ?? "") -
        Date.parse(left.completedAt ?? "");
      return completedAtDifference || right.order - left.order;
    });

  for (const step of completedSteps) {
    const clientAction = isRecord(step.outputSummary?.clientAction)
      ? step.outputSummary.clientAction
      : null;
    const completedAtMs = Date.parse(step.completedAt ?? "");
    const expiresInSec = clientAction?.expiresInSec;

    if (
      clientAction?.type !== "connect_meeting" ||
      typeof clientAction.meetingId !== "string" ||
      !clientAction.meetingId.trim() ||
      (clientAction.meetingRoomId !== undefined &&
        typeof clientAction.meetingRoomId !== "string") ||
      typeof expiresInSec !== "number" ||
      !Number.isInteger(expiresInSec) ||
      expiresInSec <= 0 ||
      expiresInSec > MAX_MEETING_CLIENT_ACTION_EXPIRY_SECONDS ||
      !Number.isFinite(completedAtMs)
    ) {
      continue;
    }

    return {
      actionId: `agent-step:${step.id}:connect_meeting`,
      expiresAtMs: completedAtMs + expiresInSec * 1000,
      meetingId: clientAction.meetingId.trim(),
      workspaceId: run.workspaceId,
      ...(typeof clientAction.meetingRoomId === "string" &&
      clientAction.meetingRoomId.trim()
        ? { meetingRoomId: clientAction.meetingRoomId.trim() }
        : {})
    };
  }

  return null;
}

function getAgentRunDisplayMessage(run: AgentRun) {
  switch (run.status) {
    case "completed":
      return (
        run.finalAnswer?.trim() ||
        run.message?.trim() ||
        "요청 처리가 완료됐습니다."
      );
    case "failed":
      return "요청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.";
    case "cancelled":
      return run.message?.trim() || "요청이 취소됐습니다.";
    case "waiting_user_input": {
      const latestAssistantMessage = [...(run.messages ?? [])]
        .reverse()
        .find((message) => message.role === "assistant");
      return (
        latestAssistantMessage?.content.trim() ||
        run.message?.trim() ||
        "요청을 계속하려면 추가 정보를 입력해주세요."
      );
    }
    case "waiting_confirmation": {
      return run.message?.trim() || "승인이 필요한 작업입니다.";
    }
    case "running":
      return run.message?.trim() || "요청한 작업을 실행하고 있습니다.";
    case "planning":
      return run.message?.trim() || "요청을 분석하고 있습니다.";
  }
}

type GroundedCitation = {
  sourceId: string;
  sourceType: "activity" | "transcript";
  occurredAt?: string;
  startedAtMs?: number;
  endedAtMs?: number;
  summary?: string;
};

function getGroundedCitations(run: AgentRun): GroundedCitation[] {
  const answerStep = [...run.steps]
    .filter((step) => step.type === "answer" && step.status === "completed")
    .sort((left, right) => right.order - left.order)[0];
  const candidates = answerStep?.outputSummary?.citationSources;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.sourceId !== "string") return [];
    if (candidate.sourceType !== "transcript" && candidate.sourceType !== "activity") return [];
    const citation: GroundedCitation = { sourceId: candidate.sourceId, sourceType: candidate.sourceType };
    if (typeof candidate.occurredAt === "string") citation.occurredAt = candidate.occurredAt;
    if (typeof candidate.startedAtMs === "number") citation.startedAtMs = candidate.startedAtMs;
    if (typeof candidate.endedAtMs === "number") citation.endedAtMs = candidate.endedAtMs;
    if (typeof candidate.summary === "string") citation.summary = candidate.summary.slice(0, 500);
    return [citation];
  });
}

function formatTranscriptTime(milliseconds: number | undefined) {
  if (typeof milliseconds !== "number" || milliseconds < 0) return null;
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function GroundedCitationList({ run }: { run: AgentRun }) {
  const citations = getGroundedCitations(run);
  if (citations.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5 border-l-2 border-slate-200 pl-2 text-xs text-slate-600">
      <p className="font-medium text-slate-700">답변 근거</p>
      {citations.map((citation) => {
        const transcriptTime = formatTranscriptTime(citation.startedAtMs);
        const occurredAt = citation.occurredAt ? new Date(citation.occurredAt).toLocaleString("ko-KR") : null;
        return (
          <div key={citation.sourceId} className="rounded border border-slate-200 bg-white px-2 py-1.5">
            <div className="flex items-center gap-1 font-medium text-slate-700">
              {citation.sourceType === "transcript" ? <FileText className="size-3" /> : <Workflow className="size-3" />}
              {citation.sourceType === "transcript" ? "회의 발언" : "실제 활동"}
              {transcriptTime ? <span className="font-normal text-slate-500">{transcriptTime}</span> : null}
              {occurredAt ? <span className="font-normal text-slate-500">{occurredAt}</span> : null}
            </div>
            {citation.sourceType === "activity" && citation.summary ? <p className="mt-0.5 whitespace-pre-wrap">{citation.summary}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function getAgentRequestErrorMessage(error: unknown) {
  if (error instanceof AgentApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Agent 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function getConfirmationRefreshErrorMessage(
  action: "approve" | "reject",
  run: AgentRun
) {
  const actionLabel = action === "approve" ? "승인 작업" : "거절 요청";

  return `${getAgentRunDisplayMessage(run)}\n\n${actionLabel}은 서버에서 처리되었습니다. 다만 최신 상태를 다시 불러오지 못했습니다. 잠시 후 이 대화를 다시 열어 상태를 확인해주세요.`;
}

function getConfirmationOutcomeUnknownMessage(action: "approve" | "reject") {
  const actionLabel = action === "approve" ? "승인 작업" : "거절 요청";

  return `${actionLabel} 결과를 확인하지 못했습니다. 서버에서 처리되었을 수 있으므로 같은 요청을 반복하지 말고, 잠시 후 이 대화를 다시 열어 상태를 확인해주세요.`;
}

export function AgentChatWidget() {
  const router = useRouter();
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const currentUserId = authSession?.user.id ?? "";
  const accessToken = authSession?.accessToken ?? null;
  const agentApiClient = useMemo(
    () =>
      createAgentApiClient({
        accessToken
      }),
    [accessToken]
  );
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AgentChatMessage[]>(initialMessages);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(
    null
  );
  const [draft, setDraft] = useState("");
  const [busyState, setBusyState] = useState<AgentChatBusyState>("idle");
  const [confirmationAction, setConfirmationAction] =
    useState<AgentConfirmationActionState | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const activeRunAbortControllerRef = useRef<AbortController | null>(null);
  const appliedSqlErdFocusActionKeysRef = useRef(new Set<string>());
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const canvasDelegationAdapter = useSyncExternalStore(
    subscribeCanvasAgentDelegationAdapter,
    getCanvasAgentDelegationAdapter,
    () => null,
  );
  const [isCanvasToolHelpMode, setIsCanvasToolHelpMode] = useState(false);
  const conversationStorageKey = useMemo(
    () =>
      currentUserId && workspaceId
        ? getConversationStorageKey(currentUserId, workspaceId)
        : null,
    [currentUserId, workspaceId]
  );

  const isBusy = busyState !== "idle";
  const hasActiveAgentRequest =
    isBusy || activeRunAbortControllerRef.current !== null;
  const canSend = draft.trim().length > 0 && !hasActiveAgentRequest;
  const panelTitleId = useMemo(() => "agent-chat-title", []);
  const hasPendingConfirmation = useMemo(
    () =>
      messages.some(
        (message) =>
          message.run?.status === "waiting_confirmation" &&
          message.run.confirmation?.status === "pending"
      ),
    [messages]
  );
  const activeWaitingMessage = useMemo(
    () =>
      [...messages]
        .reverse()
        .find(
          (message) =>
            message.run?.status === "waiting_user_input" ||
            (message.run?.status === "waiting_confirmation" &&
              message.run.confirmation?.status === "pending")
        ) ??
      null,
    [messages]
  );
  const waitingUserInputMessage =
    activeWaitingMessage?.run?.status === "waiting_user_input"
      ? activeWaitingMessage
      : null;

  useEffect(() => {
    return () => {
      activeRunAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!conversationStorageKey) {
      setMessages(initialMessages);
      setConversationId(null);
      setHydratedStorageKey(null);
      return;
    }
    const persisted = readPersistedConversation(conversationStorageKey);
    setMessages(persisted?.messages ?? initialMessages);
    setConversationId(persisted?.conversationId ?? null);
    setHydratedStorageKey(conversationStorageKey);
  }, [conversationStorageKey]);

  useEffect(() => {
    if (
      !conversationStorageKey ||
      hydratedStorageKey !== conversationStorageKey ||
      !conversationId
    ) {
      return;
    }
    persistConversation(conversationStorageKey, conversationId, messages);
  }, [conversationId, conversationStorageKey, hydratedStorageKey, messages]);

  useEffect(() => {
    setIsCanvasToolHelpMode(false);
  }, [canvasDelegationAdapter?.canvasId]);

  useEffect(() => {
    if (!hasPendingConfirmation) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [hasPendingConfirmation]);

  useEffect(() => {
    if (isOpen) {
      shouldAutoScrollRef.current = true;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !shouldAutoScrollRef.current) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const messageList = messageListRef.current;

      messageList?.scrollTo({
        top: messageList.scrollHeight,
        behavior: "smooth"
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isOpen, messages]);

  function handleMessageListScroll() {
    const messageList = messageListRef.current;

    if (!messageList) {
      return;
    }

    shouldAutoScrollRef.current =
      messageList.scrollHeight -
        messageList.scrollTop -
        messageList.clientHeight <=
      24;
  }

  const updateAssistantMessage = useCallback(
    (messageId: string, content: string, run?: AgentRun | null) => {
      setMessages((currentMessages) =>
        currentMessages.map((message) => {
          if (message.id !== messageId) {
            return message;
          }

          return {
            ...message,
            content,
            ...(run !== undefined ? { run: run ?? undefined } : {})
          };
        })
      );
    },
    []
  );

  const rememberConversation = useCallback((run: AgentRun) => {
    setConversationId(run.conversationId);
  }, []);

  const handleRunClientAction = useCallback(
    (run: AgentRun) => {
      applyAgentSqlErdTableFocus(
        run,
        readAgentRequestContext(
          window.location.pathname,
          window.location.search
        ),
        appliedSqlErdFocusActionKeysRef.current,
        stageSqlErdAgentTableFocus
      );

      const action = getMeetingConnectionAction(run);
      if (!action || !enqueueMeetingConnectionAction(action)) {
        return;
      }

      router.push("/meeting");
    },
    [router]
  );

  const pollAgentRunUntilStop = useCallback(async function pollAgentRunUntilStop(
    initialRun: AgentRun,
    assistantMessageId: string,
    signal: AbortSignal
  ) {
    let currentRun = initialRun;
    rememberConversation(currentRun);
    let planningDeadlineAt =
      currentRun.status === "planning"
        ? Date.now() + AGENT_PLANNING_POLL_TIMEOUT_MS
        : null;
    let activePlannerStepId = getActivePlannerStepId(currentRun);
    handleRunClientAction(currentRun);
    updateAssistantMessage(
      assistantMessageId,
      getAgentRunDisplayMessage(currentRun),
      currentRun
    );

    if (!shouldStopPolling(currentRun)) {
      setBusyState("polling");
    }

    while (!shouldStopPolling(currentRun)) {
      if (
        currentRun.status === "planning" &&
        planningDeadlineAt !== null &&
        Date.now() >= planningDeadlineAt
      ) {
        throw createAgentPlanningPollingTimeoutError();
      }
      await waitForAgentRunPollInterval(signal);
      const runPayload = await agentApiClient.getRun(
        currentRun.workspaceId,
        currentRun.id,
        {
          signal
        }
      );
      const previousStatus = currentRun.status;
      currentRun = runPayload.run;
      rememberConversation(currentRun);
      const nextActivePlannerStepId = getActivePlannerStepId(currentRun);
      if (
        currentRun.status === "planning" &&
        (previousStatus !== "planning" ||
          (nextActivePlannerStepId !== null &&
            nextActivePlannerStepId !== activePlannerStepId))
      ) {
        planningDeadlineAt = Date.now() + AGENT_PLANNING_POLL_TIMEOUT_MS;
      } else if (currentRun.status !== "planning") {
        planningDeadlineAt = null;
      }
      activePlannerStepId = nextActivePlannerStepId;
      handleRunClientAction(currentRun);
      updateAssistantMessage(
        assistantMessageId,
        getAgentRunDisplayMessage(currentRun),
        currentRun
      );
    }

    return currentRun;
  }, [
    agentApiClient,
    handleRunClientAction,
    rememberConversation,
    updateAssistantMessage
  ]);

  async function applyRoutedMessagePayload(
    payload: AgentMessagePayload,
    assistantMessageId: string,
    targetMessageId: string | null,
    routingInput: RouteAgentMessageInput,
    signal: AbortSignal
  ) {
    if (payload.previousRun && targetMessageId) {
      updateAssistantMessage(
        targetMessageId,
        getAgentRunDisplayMessage(payload.previousRun),
        payload.previousRun
      );
    } else if (payload.outcome === "continued" && targetMessageId) {
      const targetMessage = messages.find(
        (message) => message.id === targetMessageId
      );
      if (targetMessage) {
        updateAssistantMessage(targetMessageId, targetMessage.content, null);
      }
    }

    if (payload.run) {
      rememberConversation(payload.run);
    }

    if (payload.outcome === "needs_choice" && payload.clarification) {
      const activeRunId = routingInput.activeRunId ?? payload.run?.id ?? null;
      if (!activeRunId) {
        throw new Error("Agent routing choice is missing its active run");
      }
      setMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: payload.clarification?.question ?? message.content,
                run: undefined,
                routingChoice: {
                  activeRunId,
                  clientRequestId: routingInput.clientRequestId,
                  conversationId:
                    payload.run?.conversationId ??
                    routingInput.conversationId ??
                    "",
                  message: routingInput.message,
                  requestContext: routingInput.requestContext ?? null,
                  targetMessageId,
                  timezone: routingInput.timezone ?? DEFAULT_AGENT_TIMEZONE
                }
              }
            : message
        )
      );
      return;
    }

    if (payload.outcome === "cancelled") {
      if (payload.run && targetMessageId) {
        updateAssistantMessage(
          targetMessageId,
          getAgentRunDisplayMessage(payload.run),
          payload.run
        );
      }
      updateAssistantMessage(
        assistantMessageId,
        payload.run?.message?.trim() || "기존 작업을 취소했습니다.",
        null
      );
      return;
    }

    if (!payload.run) {
      throw new Error("Agent message response did not include a run");
    }
    updateAssistantMessage(
      assistantMessageId,
      payload.outcome === "started_new" && payload.previousRun
        ? payload.previousRun.status === "cancelled"
          ? "이전 작업을 종료하고 새 요청을 처리하고 있습니다."
          : "기존 승인 대기를 유지하고 새 요청을 처리하고 있습니다."
        : payload.outcome === "continued"
          ? "기존 작업을 이어서 처리하고 있습니다."
          : getAgentRunDisplayMessage(payload.run),
      payload.run
    );
    await pollAgentRunUntilStop(payload.run, assistantMessageId, signal);
  }

  function shouldFallbackToLegacyMessageApi(error: unknown) {
    return (
      error instanceof AgentApiError &&
      shouldFallbackToLegacyMessageApiCode(error.code)
    );
  }

  async function refreshRoutingTargetAfterStale(
    error: unknown,
    workspaceId: string,
    activeRunId: string | null,
    targetMessageId: string | null,
    signal: AbortSignal
  ) {
    if (
      !(error instanceof AgentApiError) ||
      error.code !== "AGENT_MESSAGE_ROUTING_STALE"
    ) {
      return false;
    }
    if (activeRunId && targetMessageId) {
      try {
        const payload = await agentApiClient.getRun(workspaceId, activeRunId, {
          signal
        });
        updateAssistantMessage(
          targetMessageId,
          getAgentRunDisplayMessage(payload.run),
          payload.run
        );
      } catch {
        // The next idempotent message submission lets the server recover the latest wait.
      }
    }
    return true;
  }

  async function appendRunInput(
    targetMessage: AgentChatMessage,
    input: SubmitAgentRunInput
  ) {
    const displayMessage = input.message.trim();
    const run = targetMessage.run;

    if (
      !displayMessage ||
      run?.status !== "waiting_user_input" ||
      isBusy ||
      activeRunAbortControllerRef.current
    ) {
      return;
    }

    const userMessageId = createClientId("user-input");
    const assistantMessageId = createClientId("assistant");
    const clientRequestId = createClientId("agent-message");
    const previousLatestMessageSequence = getLatestAgentRunMessageSequence(
      run.messages ?? []
    );
    shouldAutoScrollRef.current = true;
    updateAssistantMessage(targetMessage.id, targetMessage.content, null);
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: userMessageId,
        role: "user",
        content: displayMessage
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "추가 정보를 Agent API로 보내고 있습니다."
      }
    ]);
    setDraft("");

    if (!accessToken?.trim()) {
      updateAssistantMessage(
        assistantMessageId,
        "Agent를 사용하려면 로그인과 워크스페이스 선택이 필요합니다.",
        run
      );
      return;
    }

    const abortController = new AbortController();
    activeRunAbortControllerRef.current = abortController;
    setBusyState("submitting");

    try {
      const requestContext = canvasDelegationAdapter
        ? await canvasDelegationAdapter.buildRequestContext(isCanvasToolHelpMode)
        : readAgentRequestContext(
            window.location.pathname,
            window.location.search
          );
      const routingInput: RouteAgentMessageInput = {
        activeRunId: run.id,
        clientRequestId,
        conversationId: run.conversationId,
        disposition: "auto",
        message: displayMessage,
        requestContext,
        selection: input.selection,
        timezone: getBrowserTimezone()
      };
      let routedPayload: AgentMessagePayload;
      try {
        routedPayload = await agentApiClient.routeMessage(
          run.workspaceId,
          routingInput,
          { signal: abortController.signal }
        );
      } catch (error) {
        if (shouldFallbackToLegacyMessageApi(error)) {
          try {
            const legacyPayload = await agentApiClient.submitRunInput(
              run.workspaceId,
              run.id,
              { ...input, message: displayMessage },
              { signal: abortController.signal }
            );
            updateAssistantMessage(
              targetMessage.id,
              targetMessage.content,
              null
            );
            await pollAgentRunUntilStop(
              legacyPayload.run,
              assistantMessageId,
              abortController.signal
            );
            return;
          } catch (legacyError) {
            if (isAbortError(legacyError)) throw legacyError;

            let refreshRun: AgentRun | null = null;
            try {
              const refreshPayload = await agentApiClient.getRun(
                run.workspaceId,
                run.id,
                { signal: abortController.signal }
              );
              refreshRun = refreshPayload.run;
            } catch (refreshError) {
              if (isAbortError(refreshError)) throw refreshError;
            }

            const inputWasAccepted = Boolean(
              refreshRun &&
                didAgentRunAcceptInput(
                  refreshRun.messages ?? [],
                  previousLatestMessageSequence,
                  displayMessage
                )
            );
            if (
              refreshRun &&
              (inputWasAccepted ||
                refreshRun.status !== "waiting_user_input")
            ) {
              updateAssistantMessage(
                targetMessage.id,
                targetMessage.content,
                null
              );
              await pollAgentRunUntilStop(
                refreshRun,
                assistantMessageId,
                abortController.signal
              );
              return;
            }

            throw legacyError;
          }
        }
        if (error instanceof AgentApiError || isAbortError(error)) throw error;
        routedPayload = await agentApiClient.routeMessage(
          run.workspaceId,
          routingInput,
          { signal: abortController.signal }
        );
      }
      await applyRoutedMessagePayload(
        routedPayload,
        assistantMessageId,
        targetMessage.id,
        routingInput,
        abortController.signal
      );
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      const wasStale = await refreshRoutingTargetAfterStale(
        error,
        run.workspaceId,
        run.id,
        targetMessage.id,
        abortController.signal
      );

      updateAssistantMessage(
        assistantMessageId,
        wasStale
          ? "다른 요청으로 대기 작업 상태가 변경되었습니다. 최신 상태를 확인한 뒤 다시 요청해주세요."
          : getAgentRequestErrorMessage(error),
        null
      );
    } finally {
      if (activeRunAbortControllerRef.current === abortController) {
        activeRunAbortControllerRef.current = null;
      }
      setBusyState("idle");
    }
  }

  async function appendPrompt(
    prompt: string,
    targetMessage: AgentChatMessage | null = null
  ) {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || isBusy || activeRunAbortControllerRef.current) {
      return;
    }

    const userMessageId = createClientId("user");
    const assistantMessageId = createClientId("assistant");
    const clientRequestId = createClientId("agent-message");

    shouldAutoScrollRef.current = true;
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: userMessageId,
        role: "user",
        content: trimmedPrompt
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "요청을 Agent API로 보내고 있습니다."
      }
    ]);
    setDraft("");
    setIsOpen(true);

    if (!workspaceId || !accessToken?.trim()) {
      updateAssistantMessage(
        assistantMessageId,
        "Agent를 사용하려면 로그인과 워크스페이스 선택이 필요합니다."
      );
      return;
    }

    const abortController = new AbortController();
    activeRunAbortControllerRef.current = abortController;
    setBusyState("submitting");

    try {
      const requestContext = canvasDelegationAdapter
        ? await canvasDelegationAdapter.buildRequestContext(isCanvasToolHelpMode)
        : readAgentRequestContext(
            window.location.pathname,
            window.location.search
          );
      const routingInput: RouteAgentMessageInput = {
        activeRunId: targetMessage?.run?.id ?? null,
        clientRequestId,
        conversationId: targetMessage?.run?.conversationId ?? conversationId,
        disposition: "auto",
        message: trimmedPrompt,
        timezone: getBrowserTimezone(),
        requestContext
      };
      let routedPayload: AgentMessagePayload;
      try {
        routedPayload = await agentApiClient.routeMessage(
          workspaceId,
          routingInput,
          {
            signal: abortController.signal
          }
        );
      } catch (error) {
        if (shouldFallbackToLegacyMessageApi(error)) {
          const createdRunPayload = await agentApiClient.createRun(
            workspaceId,
            {
              clientRequestId,
              conversationId,
              prompt: trimmedPrompt,
              timezone: getBrowserTimezone(),
              requestContext
            },
            {
              signal: abortController.signal
            }
          );
          await pollAgentRunUntilStop(
            createdRunPayload.run,
            assistantMessageId,
            abortController.signal
          );
          return;
        }
        if (error instanceof AgentApiError || isAbortError(error)) throw error;
        routedPayload = await agentApiClient.routeMessage(
          workspaceId,
          routingInput,
          {
            signal: abortController.signal
          }
        );
      }
      await applyRoutedMessagePayload(
        routedPayload,
        assistantMessageId,
        targetMessage?.id ?? null,
        routingInput,
        abortController.signal
      );
    } catch (error) {
      if (!isAbortError(error)) {
        const wasStale = await refreshRoutingTargetAfterStale(
          error,
          workspaceId,
          targetMessage?.run?.id ?? null,
          targetMessage?.id ?? null,
          abortController.signal
        );
        updateAssistantMessage(
          assistantMessageId,
          wasStale
            ? "다른 요청으로 대기 작업 상태가 변경되었습니다. 최신 상태를 확인한 뒤 다시 요청해주세요."
            : getAgentRequestErrorMessage(error),
          null
        );
      }
    } finally {
      if (activeRunAbortControllerRef.current === abortController) {
        activeRunAbortControllerRef.current = null;
      }
      setBusyState("idle");
    }
  }

  async function handleRoutingChoice(
    message: AgentChatMessage,
    disposition: Exclude<AgentMessageDisposition, "auto">
  ) {
    const choice = message.routingChoice;
    if (
      !choice ||
      !accessToken?.trim() ||
      isBusy ||
      activeRunAbortControllerRef.current
    ) {
      return;
    }
    const abortController = new AbortController();
    activeRunAbortControllerRef.current = abortController;
    setBusyState("submitting");
    try {
      const routingInput: RouteAgentMessageInput = {
        activeRunId: choice.activeRunId,
        clientRequestId: choice.clientRequestId,
        conversationId: choice.conversationId,
        disposition,
        message: choice.message,
        requestContext: choice.requestContext,
        timezone: choice.timezone
      };
      let payload: AgentMessagePayload;
      try {
        payload = await agentApiClient.routeMessage(
          workspaceId,
          routingInput,
          { signal: abortController.signal }
        );
      } catch (error) {
        if (error instanceof AgentApiError || isAbortError(error)) throw error;
        payload = await agentApiClient.routeMessage(
          workspaceId,
          routingInput,
          { signal: abortController.signal }
        );
      }
      setMessages((currentMessages) =>
        currentMessages.map((currentMessage) =>
          currentMessage.id === message.id
            ? { ...currentMessage, routingChoice: undefined }
            : currentMessage
        )
      );
      await applyRoutedMessagePayload(
        payload,
        message.id,
        choice.targetMessageId,
        routingInput,
        abortController.signal
      );
    } catch (error) {
      if (!isAbortError(error)) {
        updateAssistantMessage(
          message.id,
          getAgentRequestErrorMessage(error),
          null
        );
      }
    } finally {
      if (activeRunAbortControllerRef.current === abortController) {
        activeRunAbortControllerRef.current = null;
      }
      setBusyState("idle");
    }
  }

  async function handleConfirmationAction(
    message: AgentChatMessage,
    action: "approve" | "reject",
    choiceId?: string
  ) {
    const run = message.run;
    const confirmation = run?.confirmation;

    if (
      !run ||
      !confirmation ||
      confirmationAction ||
      isBusy ||
      activeRunAbortControllerRef.current !== null
    ) {
      return;
    }

    if (!accessToken?.trim()) {
      updateAssistantMessage(
        message.id,
        "Agent confirmation을 처리하려면 로그인과 워크스페이스 선택이 필요합니다.",
        run
      );
      return;
    }

    const abortController = new AbortController();
    activeRunAbortControllerRef.current = abortController;
    setBusyState("submitting");
    setConfirmationAction({
      action,
      confirmationId: confirmation.id,
      messageId: message.id
    });
    updateAssistantMessage(
      message.id,
      action === "approve"
        ? "승인 요청을 보내고 있습니다."
        : "거절 요청을 보내고 있습니다.",
      run
    );

    let lastKnownRun = run;
    let confirmationActionHandled = false;
    try {
      const actionPayload =
        action === "approve"
          ? await agentApiClient.approveConfirmation(
              run.workspaceId,
              run.id,
              confirmation.id,
              choiceId ? { choiceId } : undefined,
              {
                signal: abortController.signal
              }
            )
          : await agentApiClient.rejectConfirmation(
              run.workspaceId,
              run.id,
              confirmation.id,
              {
                signal: abortController.signal
              }
            );
      const updatedRun: AgentRun = {
        ...run,
        status: actionPayload.run.status,
        message: actionPayload.run.message,
        confirmation: {
          ...confirmation,
          ...actionPayload.run.confirmation
        }
      };
      lastKnownRun = updatedRun;
      confirmationActionHandled = true;
      updateAssistantMessage(
        message.id,
        getAgentRunDisplayMessage(updatedRun),
        updatedRun
      );

      const runPayload = await agentApiClient.getRun(run.workspaceId, run.id, {
        signal: abortController.signal
      });
      await pollAgentRunUntilStop(
        runPayload.run,
        message.id,
        abortController.signal
      );
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      if (confirmationActionHandled) {
        updateAssistantMessage(
          message.id,
          getConfirmationRefreshErrorMessage(action, lastKnownRun),
          lastKnownRun
        );
        return;
      }

      if (!(error instanceof AgentApiError)) {
        let reconciliationFailed = false;
        const reconciledRun = await agentApiClient
          .getRun(run.workspaceId, run.id, {
            signal: abortController.signal
          })
          .then((runPayload) => runPayload.run)
          .catch(() => {
            reconciliationFailed = true;
            return null;
          });
        if (
          reconciledRun &&
          (reconciledRun.status !== "waiting_confirmation" ||
            reconciledRun.confirmation?.status !== "pending")
        ) {
          updateAssistantMessage(
            message.id,
            getAgentRunDisplayMessage(reconciledRun),
            reconciledRun
          );
          return;
        }
        if (reconciliationFailed) {
          updateAssistantMessage(
            message.id,
            getConfirmationOutcomeUnknownMessage(action),
            lastKnownRun
          );
          return;
        }
      }

      let refreshedAfterActionError = false;
      if (
        error instanceof AgentApiError &&
        (error.code === "CONFIRMATION_EXPIRED" ||
          error.code === "CONFIRMATION_NOT_PENDING")
      ) {
        await agentApiClient
          .getRun(run.workspaceId, run.id, {
            signal: abortController.signal
          })
          .then((runPayload) => {
            updateAssistantMessage(
              message.id,
              getAgentRunDisplayMessage(runPayload.run),
              runPayload.run
            );
            refreshedAfterActionError = true;
          })
          .catch(() => undefined);
      }

      if (!refreshedAfterActionError) {
        updateAssistantMessage(
          message.id,
          getAgentRequestErrorMessage(error),
          lastKnownRun
        );
      }
    } finally {
      if (activeRunAbortControllerRef.current === abortController) {
        activeRunAbortControllerRef.current = null;
      }
      setConfirmationAction(null);
      setBusyState("idle");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSend) {
      return;
    }

    if (waitingUserInputMessage) {
      void appendRunInput(waitingUserInputMessage, { message: draft });
      return;
    }

    void appendPrompt(draft, activeWaitingMessage);
  }

  function handleDraftKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    if (canSend) {
      if (waitingUserInputMessage) {
        void appendRunInput(waitingUserInputMessage, { message: draft });
      } else {
        void appendPrompt(draft, activeWaitingMessage);
      }
    }
  }

  function handleNewConversation() {
    if (hasActiveAgentRequest) return;
    if (conversationStorageKey) {
      window.localStorage.removeItem(conversationStorageKey);
    }
    setConversationId(null);
    setMessages(initialMessages);
    setDraft("");
    setConfirmationAction(null);
    shouldAutoScrollRef.current = true;
  }

  return (
    <>
      {isOpen ? (
        <section
          aria-labelledby={panelTitleId}
          className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-[420px] flex-col border-l border-slate-200 bg-white shadow-2xl shadow-slate-950/15"
        >
          <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
                  <Bot className="size-4" />
                </div>
                <div className="min-w-0">
                  <h2
                    id={panelTitleId}
                    className="truncate text-sm font-semibold text-slate-950"
                  >
                    PILO AI
                  </h2>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        hasActiveAgentRequest
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      )}
                    />
                    {hasActiveAgentRequest ? "처리 중" : "API 연결"}
                  </div>
                </div>
              </div>

              {canvasDelegationAdapter ? (
                <Button
                  type="button"
                  variant={isCanvasToolHelpMode ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={isCanvasToolHelpMode}
                  onClick={() => setIsCanvasToolHelpMode((current) => !current)}
                  className="ml-auto gap-1.5"
                >
                  <Wrench className="size-3.5" />
                  기능 설명
                </Button>
              ) : null}

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="새 대화"
                title="새 대화"
                disabled={hasActiveAgentRequest}
                onClick={handleNewConversation}
              >
                <SquarePen className="size-4" />
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="AI 채팅 닫기"
                onClick={() => setIsOpen(false)}
              >
                <X className="size-4" />
              </Button>
          </header>

          <div
            ref={messageListRef}
            onScroll={handleMessageListScroll}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-white px-4 py-4"
          >
              {messages.map((message) => {
                const confirmation =
                  message.run?.status === "waiting_confirmation"
                    ? message.run.confirmation
                    : null;
                const isActionTarget =
                  confirmationAction?.messageId === message.id &&
                  confirmationAction.confirmationId === confirmation?.id;

                return (
                  <div
                    key={message.id}
                    className={cn(
                      "flex",
                      message.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    <div
                      className={cn(
                        "min-w-0",
                        confirmation ? "max-w-[94%]" : "max-w-[82%]"
                      )}
                    >
                      <div
                        className={cn(
                          "whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-6",
                          message.role === "user"
                            ? "bg-slate-900 text-white"
                            : "border border-slate-200 bg-slate-50 text-slate-800"
                        )}
                      >
                        {message.content}
                      </div>
                      {message.routingChoice ? (
                        <div className="mt-2 flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={hasActiveAgentRequest}
                            onClick={() =>
                              void handleRoutingChoice(
                                message,
                                "continue_previous"
                              )
                            }
                          >
                            기존 작업 계속
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={hasActiveAgentRequest}
                            onClick={() =>
                              void handleRoutingChoice(message, "start_new")
                            }
                          >
                            새 요청 시작
                          </Button>
                        </div>
                      ) : null}
                      {message.run?.status === "completed" ? (
                        <GroundedCitationList run={message.run} />
                      ) : null}
                      {confirmation ? (
                        <AgentConfirmationCard
                          confirmation={confirmation}
                          disabled={
                            !accessToken?.trim() || hasActiveAgentRequest
                          }
                          isApproving={
                            isActionTarget &&
                            confirmationAction?.action === "approve"
                          }
                          isRejecting={
                            isActionTarget &&
                            confirmationAction?.action === "reject"
                          }
                          nowMs={nowMs}
                          onApprove={(choiceId) =>
                            void handleConfirmationAction(
                              message,
                              "approve",
                              choiceId
                            )
                          }
                          onReject={() =>
                            void handleConfirmationAction(message, "reject")
                          }
                        />
                      ) : null}
                      {message.run ? (
                        <AgentCandidateSelections
                          run={message.run}
                          disabled={
                            !accessToken?.trim() || hasActiveAgentRequest
                          }
                          onSelect={(input) =>
                            void appendRunInput(message, input)
                          }
                          onRetry={() =>
                            void appendRunInput(message, {
                              message: "후보를 다시 찾아주세요."
                            })
                          }
                        />
                      ) : null}
                      {message.run ? (
                        <AgentResourceLinks run={message.run} />
                      ) : null}
                      {message.run?.status === "completed" ? (
                        <AgentCanvasArtifact run={message.run} />
                      ) : null}
                    </div>
                  </div>
                );
              })}
          </div>

          <div className="border-t border-slate-200 bg-white px-4 py-3">
              {waitingUserInputMessage ? (
                <p className="mb-2 text-xs text-slate-500">
                  서버가 기존 작업의 추가 정보인지 새 요청인지 확인합니다.
                </p>
              ) : activeWaitingMessage?.run?.status ===
                "waiting_confirmation" ? (
                <p className="mb-2 text-xs text-slate-500">
                  일반 메시지는 승인으로 처리되지 않습니다. 새 질문도 입력할 수
                  있습니다.
                </p>
              ) : null}

              <form className="flex items-end gap-2" onSubmit={handleSubmit}>
                <textarea
                  value={draft}
                  rows={1}
                  aria-label="AI에게 보낼 메시지"
                  placeholder={
                    waitingUserInputMessage
                      ? "추가 정보 또는 새 요청을 입력하세요"
                      : "메시지를 입력하세요"
                  }
                  className="min-h-9 flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-5 text-slate-900 outline-none transition placeholder:text-slate-400 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-200"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleDraftKeyDown}
                  disabled={isBusy}
                />
                <Button
                  type="submit"
                  size="icon-lg"
                  aria-label="AI에게 메시지 보내기"
                  disabled={!canSend}
                >
                  {isBusy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <SendHorizontal className="size-4" />
                  )}
                </Button>
              </form>
          </div>
        </section>
      ) : null}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-lg"
              aria-label={isOpen ? "AI 채팅 접기" : "AI 채팅 열기"}
              className={cn(
                "fixed bottom-4 right-4 z-[70] size-14 rounded-full border border-slate-800 bg-slate-950 text-white shadow-xl shadow-slate-950/20 hover:bg-slate-800 sm:bottom-6 sm:right-6",
                isOpen && "pointer-events-none opacity-0"
              )}
              onClick={() => setIsOpen((currentValue) => !currentValue)}
            >
              {isOpen ? (
                <X className="size-5" />
              ) : (
                <MessageCircle className="size-5" />
              )}
            </Button>
          }
        />
        <TooltipContent side="left">PILO AI</TooltipContent>
      </Tooltip>
    </>
  );
}
