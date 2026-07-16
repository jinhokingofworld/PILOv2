"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Bot,
  CalendarDays,
  Loader2,
  MessageCircle,
  SendHorizontal,
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
import type { AgentRun } from "@/features/agent/types";
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
const DEFAULT_AGENT_TIMEZONE = "Asia/Seoul";
const SQL_ERD_SESSION_PATH = "/sql-erd/session";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export function readAgentRequestContext(pathname: string, search: string) {
  if (pathname !== SQL_ERD_SESSION_PATH) {
    return null;
  }

  const sessionId = new URLSearchParams(search).get("sessionId")?.trim();
  if (!sessionId || !UUID_PATTERN.test(sessionId)) {
    return null;
  }

  return {
    surface: "sql_erd" as const,
    sessionId
  };
}

function createAbortError() {
  const error = new Error("Agent run polling was aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
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
    run.status === "waiting_confirmation" ||
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "cancelled"
  );
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
    case "waiting_confirmation": {
      return run.message?.trim() || "승인이 필요한 작업입니다.";
    }
    case "running":
      return run.message?.trim() || "요청한 작업을 실행하고 있습니다.";
    case "planning":
      return run.message?.trim() || "요청을 분석하고 있습니다.";
  }
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

  useEffect(() => {
    return () => {
      activeRunAbortControllerRef.current?.abort();
    };
  }, []);

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

  async function pollAgentRunUntilStop(
    initialRun: AgentRun,
    assistantMessageId: string,
    signal: AbortSignal
  ) {
    let currentRun = initialRun;
    updateAssistantMessage(
      assistantMessageId,
      getAgentRunDisplayMessage(currentRun),
      currentRun
    );

    if (!shouldStopPolling(currentRun)) {
      setBusyState("polling");
    }

    while (!shouldStopPolling(currentRun)) {
      await waitForAgentRunPollInterval(signal);
      const runPayload = await agentApiClient.getRun(
        workspaceId,
        currentRun.id,
        {
          signal
        }
      );
      currentRun = runPayload.run;
      updateAssistantMessage(
        assistantMessageId,
        getAgentRunDisplayMessage(currentRun),
        currentRun
      );
    }

    return currentRun;
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
      const requestContext = readAgentRequestContext(
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
      await pollAgentRunUntilStop(
        createdRunPayload.run,
        assistantMessageId,
        abortController.signal
      );
    } catch (error) {
      if (!isAbortError(error)) {
        updateAssistantMessage(
          assistantMessageId,
          getAgentRequestErrorMessage(error)
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

    if (!workspaceId || !accessToken?.trim()) {
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
              workspaceId,
              run.id,
              confirmation.id,
              choiceId ? { choiceId } : undefined,
              {
                signal: abortController.signal
              }
            )
          : await agentApiClient.rejectConfirmation(
              workspaceId,
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

      const runPayload = await agentApiClient.getRun(workspaceId, run.id, {
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
          .getRun(workspaceId, run.id, {
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
      void appendPrompt(draft);
    }
  }

  return (
    <>
      {isOpen ? (
        <section
          aria-labelledby={panelTitleId}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-slate-200 bg-white shadow-2xl shadow-slate-950/15"
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
                      {confirmation ? (
                        <AgentConfirmationCard
                          confirmation={confirmation}
                          disabled={
                            !workspaceId ||
                            !accessToken?.trim() ||
                            hasActiveAgentRequest
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
                      disabled={hasActiveAgentRequest}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                      onClick={() => void appendPrompt(suggestion.prompt)}
                    >
                      <SuggestionIcon className="size-3.5" />
                      {suggestion.label}
                    </button>
                  );
                })}
              </div>

              <form className="flex items-end gap-2" onSubmit={handleSubmit}>
                <textarea
                  value={draft}
                  rows={1}
                  aria-label="AI에게 보낼 메시지"
                  placeholder="메시지를 입력하세요"
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
                "fixed bottom-4 right-4 z-40 size-14 rounded-full border border-slate-800 bg-slate-950 text-white shadow-xl shadow-slate-950/20 hover:bg-slate-800 sm:bottom-6 sm:right-6",
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
