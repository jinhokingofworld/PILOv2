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
  CalendarDays,
  FileText,
  Loader2,
  MessageCircle,
  SendHorizontal,
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
import { AgentMeetingCandidateSelections } from "@/features/agent/components/agent-meeting-candidate-selections";
import { AgentResourceLinks } from "@/features/agent/components/agent-resource-links";
import { AgentSqlErdSessionCandidates } from "@/features/agent/components/agent-sql-erd-session-candidates";
import { AgentCanvasArtifact } from "@/features/agent/components/agent-canvas-artifact";
import {
  getCanvasAgentDelegationAdapter,
  subscribeCanvasAgentDelegationAdapter,
} from "@/features/agent/canvas-delegation-context";
import { readAgentRequestContext } from "@/features/agent/request-context";
import {
  didAgentRunAcceptInput,
  getLatestAgentRunMessageSequence
} from "@/features/agent/run-input-recovery";
import {
  forgetAgentRunId,
  readRecoverableAgentRunId,
  rememberAgentRunId
} from "@/features/agent/thread-run-recovery";
import type { AgentRun, SubmitAgentRunInput } from "@/features/agent/types";
import { enqueueMeetingConnectionAction } from "@/features/meeting/stores/meeting-connection-action-store";
import { cn } from "@/lib/utils";

type AgentChatMessage = {
  id: string;
  content: string;
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
const AGENT_RUN_POLL_TIMEOUT_MS = 130_000;
const DEFAULT_AGENT_TIMEZONE = "Asia/Seoul";
const MAX_MEETING_CLIENT_ACTION_EXPIRY_SECONDS = 300;

const initialMessages: AgentChatMessage[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    content: "안녕하세요. 일정 생성과 회의록 확인을 도와드릴게요."
  },
  {
    id: "assistant-example",
    role: "assistant",
    content: "예: 내일 오후 3시에 디자인 리뷰 일정 만들어줘"
  }
];

const suggestionPrompts = [
  {
    icon: CalendarDays,
    label: "오늘 일정 보기",
    prompt: "오늘 일정 보여줘"
  }
];

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

function createAgentRunPollingTimeoutError() {
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
      return (
        run.errorMessage?.trim() ||
        run.message?.trim() ||
        "요청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요."
      );
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

export function AgentChatWidget() {
  const router = useRouter();
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
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
  const [draft, setDraft] = useState("");
  const [busyState, setBusyState] = useState<AgentChatBusyState>("idle");
  const [confirmationAction, setConfirmationAction] =
    useState<AgentConfirmationActionState | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const activeRunAbortControllerRef = useRef<AbortController | null>(null);
  const canvasDelegationAdapter = useSyncExternalStore(
    subscribeCanvasAgentDelegationAdapter,
    getCanvasAgentDelegationAdapter,
    () => null,
  );
  const [isCanvasToolHelpMode, setIsCanvasToolHelpMode] = useState(false);

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
  const waitingUserInputMessage = useMemo(
    () =>
      [...messages]
        .reverse()
        .find((message) => message.run?.status === "waiting_user_input") ??
      null,
    [messages]
  );

  useEffect(() => {
    return () => {
      activeRunAbortControllerRef.current?.abort();
    };
  }, []);

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

  const handleRunClientAction = useCallback(
    (run: AgentRun) => {
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
    const deadlineAt = Date.now() + AGENT_RUN_POLL_TIMEOUT_MS;
    rememberAgentRunId(window.sessionStorage, currentRun.workspaceId, currentRun.id);
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
      if (Date.now() >= deadlineAt) {
        forgetAgentRunId(window.sessionStorage, currentRun.workspaceId);
        throw createAgentRunPollingTimeoutError();
      }
      await waitForAgentRunPollInterval(signal);
      const runPayload = await agentApiClient.getRun(
        currentRun.workspaceId,
        currentRun.id,
        {
          signal
        }
      );
      currentRun = runPayload.run;
      rememberAgentRunId(window.sessionStorage, currentRun.workspaceId, currentRun.id);
      handleRunClientAction(currentRun);
      updateAssistantMessage(
        assistantMessageId,
        getAgentRunDisplayMessage(currentRun),
        currentRun
      );
    }

    return currentRun;
  }, [agentApiClient, handleRunClientAction, updateAssistantMessage]);

  useEffect(() => {
    if (!workspaceId || !accessToken?.trim() || activeRunAbortControllerRef.current) {
      return;
    }
    const runId = readRecoverableAgentRunId(window.sessionStorage, workspaceId);
    if (!runId) return;

    const abortController = new AbortController();
    activeRunAbortControllerRef.current = abortController;
    setBusyState("submitting");
    const assistantMessageId = `assistant-recovered-${runId}`;

    void (async () => {
      try {
        const payload = await agentApiClient.getRun(workspaceId, runId, {
          signal: abortController.signal
        });
        const run = payload.run;
        if (run.workspaceId !== workspaceId) {
          forgetAgentRunId(window.sessionStorage, workspaceId);
          return;
        }
        setMessages([
          ...initialMessages,
          {
            id: `user-recovered-${run.id}`,
            role: "user",
            content: run.prompt
          },
          {
            id: assistantMessageId,
            role: "assistant",
            content: getAgentRunDisplayMessage(run),
            run
          }
        ]);
        await pollAgentRunUntilStop(run, assistantMessageId, abortController.signal);
      } catch (error) {
        if (!isAbortError(error)) {
          forgetAgentRunId(window.sessionStorage, workspaceId);
          updateAssistantMessage(
            assistantMessageId,
            getAgentRequestErrorMessage(error),
            null
          );
        }
      } finally {
        if (activeRunAbortControllerRef.current === abortController) {
          activeRunAbortControllerRef.current = null;
          setBusyState("idle");
        }
      }
    })();

    return () => {
      abortController.abort();
      if (activeRunAbortControllerRef.current === abortController) {
        activeRunAbortControllerRef.current = null;
      }
    };
  }, [
    accessToken,
    agentApiClient,
    pollAgentRunUntilStop,
    updateAssistantMessage,
    workspaceId
  ]);

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
    const previousLatestMessageSequence = getLatestAgentRunMessageSequence(
      run.messages ?? []
    );
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
      const runPayload = await agentApiClient.submitRunInput(
        run.workspaceId,
        run.id,
        { ...input, message: displayMessage },
        { signal: abortController.signal }
      );
      await pollAgentRunUntilStop(
        runPayload.run,
        assistantMessageId,
        abortController.signal
      );
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      let refreshRun: AgentRun | null = null;
      try {
        const runPayload = await agentApiClient.getRun(
          run.workspaceId,
          run.id,
          {
            signal: abortController.signal
          }
        );
        refreshRun = runPayload.run;
      } catch (refreshError) {
        if (isAbortError(refreshError)) {
          return;
        }
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
        (inputWasAccepted || refreshRun.status !== "waiting_user_input")
      ) {
        try {
          await pollAgentRunUntilStop(
            refreshRun,
            assistantMessageId,
            abortController.signal
          );
        } catch (pollingError) {
          if (isAbortError(pollingError)) {
            return;
          }

          updateAssistantMessage(
            assistantMessageId,
            getAgentRequestErrorMessage(pollingError),
            null
          );
        }
        return;
      }

      updateAssistantMessage(
        assistantMessageId,
        getAgentRequestErrorMessage(error),
        null
      );
    } finally {
      if (activeRunAbortControllerRef.current === abortController) {
        activeRunAbortControllerRef.current = null;
      }
      setBusyState("idle");
    }
  }

  async function appendPrompt(prompt: string) {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || isBusy || activeRunAbortControllerRef.current) {
      return;
    }

    const userMessageId = createClientId("user");
    const assistantMessageId = createClientId("assistant");
    const clientRequestId = createClientId("agent-run");

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
      const createdRunPayload = await agentApiClient.createRun(
        workspaceId,
        {
          clientRequestId,
          prompt: trimmedPrompt,
          timezone: getBrowserTimezone(),
          requestContext
        },
        {
          signal: abortController.signal
        }
      );
      rememberAgentRunId(
        window.sessionStorage,
        createdRunPayload.run.workspaceId,
        createdRunPayload.run.id
      );
      await pollAgentRunUntilStop(
        createdRunPayload.run,
        assistantMessageId,
        abortController.signal
      );
    } catch (error) {
      if (!isAbortError(error)) {
        forgetAgentRunId(window.sessionStorage, workspaceId);
        updateAssistantMessage(
          assistantMessageId,
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

    void appendPrompt(draft);
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
        void appendPrompt(draft);
      }
    }
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
                aria-label="AI 채팅 닫기"
                onClick={() => setIsOpen(false)}
              >
                <X className="size-4" />
              </Button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-white px-4 py-4">
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
                        <AgentMeetingCandidateSelections
                          run={message.run}
                          disabled={
                            !accessToken?.trim() || hasActiveAgentRequest
                          }
                          onSelect={(input) =>
                            void appendRunInput(message, input)
                          }
                        />
                      ) : null}
                      {message.run ? (
                        <AgentSqlErdSessionCandidates
                          run={message.run}
                          disabled={
                            !accessToken?.trim() || hasActiveAgentRequest
                          }
                          onSelect={(input) =>
                            void appendRunInput(message, input)
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
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {suggestionPrompts.map((suggestion) => {
                  const SuggestionIcon = suggestion.icon;

                  return (
                    <button
                      key={suggestion.label}
                      type="button"
                      disabled={
                        hasActiveAgentRequest || Boolean(waitingUserInputMessage)
                      }
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                      onClick={() => {
                        if (waitingUserInputMessage) {
                          void appendRunInput(
                            waitingUserInputMessage,
                            { message: suggestion.prompt }
                          );
                        } else {
                          void appendPrompt(suggestion.prompt);
                        }
                      }}
                    >
                      <SuggestionIcon className="size-3.5" />
                      {suggestion.label}
                    </button>
                  );
                })}
              </div>

              {waitingUserInputMessage ? (
                <p className="mb-2 text-xs text-slate-500">
                  위 질문에 필요한 정보를 입력하면 같은 요청을 이어서 처리합니다.
                </p>
              ) : null}

              <form className="flex items-end gap-2" onSubmit={handleSubmit}>
                <textarea
                  value={draft}
                  rows={1}
                  aria-label="AI에게 보낼 메시지"
                  placeholder={
                    waitingUserInputMessage
                      ? "추가 정보를 입력하세요"
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
