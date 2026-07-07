"use client";

import { type FormEvent, useMemo, useState } from "react";
import {
  Bot,
  CalendarPlus,
  CheckCircle2,
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
import { cn } from "@/lib/utils";

type AgentChatMessage = {
  id: string;
  content: string;
  role: "assistant" | "user";
};

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

function createMockAssistantReply(prompt: string) {
  if (prompt.includes("일정") || prompt.includes("캘린더")) {
    return "일정 생성 요청으로 이해했어요. 실제 연결 후에는 제목, 날짜, 시간, 참석자를 확인하고 승인 요청을 띄울 예정입니다.";
  }

  if (prompt.includes("회의") || prompt.includes("회의록")) {
    return "회의록 조회 요청으로 이해했어요. 실제 연결 후에는 최근 MeetingReport를 찾아 요약과 결정사항을 보여줄 예정입니다.";
  }

  if (
    prompt.toLowerCase().includes("board") ||
    prompt.includes("이슈") ||
    prompt.includes("칸반")
  ) {
    return "Board 이슈 검색 요청으로 이해했어요. 실제 연결 후에는 조건에 맞는 이슈와 현재 컬럼을 찾아 보여줄 예정입니다.";
  }

  return "요청을 받았어요. 실제 Agent API가 연결되면 필요한 워크스페이스 tool을 선택해 실행하거나 승인 요청을 만들 예정입니다.";
}

export function AgentChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AgentChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");

  const canSend = draft.trim().length > 0;
  const panelTitleId = useMemo(() => "agent-chat-title", []);

  function appendPrompt(prompt: string) {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      return;
    }

    const timestamp = Date.now();
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: `user-${timestamp}`,
        role: "user",
        content: trimmedPrompt
      },
      {
        id: `assistant-${timestamp}`,
        role: "assistant",
        content: createMockAssistantReply(trimmedPrompt)
      }
    ]);
    setDraft("");
    setIsOpen(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSend) {
      return;
    }

    appendPrompt(draft);
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
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    Mockup
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
                      "max-w-[82%] rounded-lg px-3 py-2 text-sm leading-6",
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
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                    onClick={() => appendPrompt(suggestion.prompt)}
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
                />
                <Button
                  type="submit"
                  size="icon-lg"
                  aria-label="AI에게 메시지 보내기"
                  disabled={!canSend}
                >
                  <SendHorizontal className="size-4" />
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
