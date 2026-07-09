"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Bot,
  CalendarPlus,
  CheckCircle2,
  Loader2,
  MessageCircle,
  SendHorizontal,
  Sparkles,
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
import type { AgentRun } from "@/features/agent/types";
import { cn } from "@/lib/utils";

type AgentChatMessage = {
  id: string;
  content: string;
  role: "assistant" | "user";
};

type AgentChatBusyState = "idle" | "polling" | "submitting";

const AGENT_RUN_POLL_INTERVAL_MS = 1800;
const DEFAULT_AGENT_TIMEZONE = "Asia/Seoul";

const initialMessages: AgentChatMessage[] = [
  {
    id: "assistant-welcome",
    role: "assistant",
    content:
      "안녕하세요. 일정 생성, 회의록 확인, Board 이슈 검색 같은 워크스페이스 작업을 도와드릴게요."
  },
  {
    id: "assistant-example",
    role: "assistant",
    content: "예: 내일 오후 3시에 디자인 리뷰 일정 만들어줘"
  }
];

const suggestionPrompts = [
  {
    icon: "calendar",
    label: "일정 생성",
    prompt: "내일 오후 3시에 디자인 리뷰 일정 만들어줘"
  },
  {
    icon: "meeting",
    label: "회의록 확인",
    prompt: "지난 회의 결정사항 찾아줘"
  },
  {
    icon: "board",
    label: "Board 이슈",
    prompt: "진행 중인 Board 이슈 보여줘"
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
      const confirmationSummary = run.confirmation?.plan?.summary?.trim();
      const summaryLine = confirmationSummary ? `\n${confirmationSummary}` : "";
      return `승인이 필요한 작업입니다.${summaryLine}\n승인/거절 UI는 다음 단계에서 연결됩니다.`;
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
  const activeRunAbortControllerRef = useRef<AbortController | null>(null);

  const isBusy = busyState !== "idle";
  const canSend = draft.trim().length > 0 && !isBusy;
  const panelTitleId = useMemo(() => "agent-chat-title", []);

  useEffect(() => {
    return () => {
      activeRunAbortControllerRef.current?.abort();
    };
  }, []);

  const updateAssistantMessage = useCallback((messageId: string, content: string) => {
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content
            }
          : message
      )
    );
  }, []);

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
      const createdRunPayload = await agentApiClient.createRun(
        workspaceId,
        {
          clientRequestId,
          prompt: trimmedPrompt,
          timezone: getBrowserTimezone()
        },
        {
          signal: abortController.signal
        }
      );
      let currentRun = createdRunPayload.run;
      updateAssistantMessage(
        assistantMessageId,
        getAgentRunDisplayMessage(currentRun)
      );

      if (!shouldStopPolling(currentRun)) {
        setBusyState("polling");
      }

      while (!shouldStopPolling(currentRun)) {
        await waitForAgentRunPollInterval(abortController.signal);
        const runPayload = await agentApiClient.getRun(
          workspaceId,
          currentRun.id,
          {
            signal: abortController.signal
          }
        );
        currentRun = runPayload.run;
        updateAssistantMessage(
          assistantMessageId,
          getAgentRunDisplayMessage(currentRun)
        );
      }
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSend) {
      return;
    }

    void appendPrompt(draft);
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-end px-4 sm:bottom-6 sm:px-6">
      <div className="pointer-events-auto flex w-full max-w-[400px] flex-col items-end gap-3">
        {isOpen ? (
          <section
            aria-labelledby={panelTitleId}
            className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl shadow-slate-950/12"
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
                        isBusy ? "bg-amber-500" : "bg-emerald-500"
                      )}
                    />
                    {isBusy ? "처리 중" : "API 연결"}
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

            <div className="max-h-[min(520px,calc(100vh-220px))] space-y-3 overflow-y-auto bg-white px-4 py-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[82%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-6",
                      message.role === "user"
                        ? "bg-slate-900 text-white"
                        : "border border-slate-200 bg-slate-50 text-slate-800"
                    )}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-200 bg-white px-4 py-3">
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {suggestionPrompts.map((suggestion) => (
                  <button
                    key={suggestion.label}
                    type="button"
                    disabled={isBusy}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                    onClick={() => void appendPrompt(suggestion.prompt)}
                  >
                    {suggestion.icon === "calendar" ? (
                      <CalendarPlus className="size-3.5" />
                    ) : suggestion.icon === "meeting" ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <Sparkles className="size-3.5" />
                    )}
                    {suggestion.label}
                  </button>
                ))}
              </div>

              <form className="flex items-end gap-2" onSubmit={handleSubmit}>
                <textarea
                  value={draft}
                  rows={1}
                  aria-label="AI에게 보낼 메시지"
                  placeholder="메시지를 입력하세요"
                  className="min-h-9 flex-1 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-5 text-slate-900 outline-none transition placeholder:text-slate-400 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-200"
                  onChange={(event) => setDraft(event.target.value)}
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
                className="size-14 rounded-full border border-slate-800 bg-slate-950 text-white shadow-xl shadow-slate-950/20 hover:bg-slate-800"
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
      </div>
    </div>
  );
}
