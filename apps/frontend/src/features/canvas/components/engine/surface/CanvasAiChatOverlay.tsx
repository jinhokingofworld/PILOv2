"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Bot, SendHorizontal, X } from "lucide-react";
import type { CanvasAgentDraft } from "@/features/canvas/api/canvas-agent-types";

export type CanvasAiChatAnchor = {
  x: number;
  y: number;
};

type CanvasAiChatOverlayProps = {
  anchor: CanvasAiChatAnchor | null;
  draft: CanvasAgentDraft | null;
  error: string | null;
  holdProgress: (CanvasAiChatAnchor & { progress: number }) | null;
  isRunning: boolean;
  onApplyDraft: () => void;
  onClose: () => void;
  onDiscardDraft: () => void;
  onSubmit: (message: string, options?: { toolHelpMode?: boolean }) => void;
  statusMessage: string | null;
};

type CanvasAiMessage = {
  content: string;
  role: "assistant" | "user";
};

export function CanvasAiChatOverlay({
  anchor,
  draft,
  error,
  holdProgress,
  isRunning,
  onApplyDraft,
  onClose,
  onDiscardDraft,
  onSubmit,
  statusMessage,
}: CanvasAiChatOverlayProps) {
  const [input, setInput] = useState("");
  const [isToolHelpMode, setIsToolHelpMode] = useState(false);
  const [messages, setMessages] = useState<CanvasAiMessage[]>([
    {
      content:
        "캔버스에 관한 작업을 도와드릴게요. 저는 C를 누르면 캔버스 어디서든 부를 수 있어요.",
      role: "assistant",
    },
  ]);
  const lastAssistantFeedbackRef = useRef<string | null>(null);
  const messageListEndRef = useRef<HTMLDivElement>(null);
  const assistantFeedback = (error ?? statusMessage)?.trim() || null;

  useEffect(() => {
    if (!assistantFeedback || lastAssistantFeedbackRef.current === assistantFeedback) {
      return;
    }

    lastAssistantFeedbackRef.current = assistantFeedback;
    setMessages((currentMessages) => {
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (
        lastMessage?.role === "assistant"
        && lastMessage.content === assistantFeedback
      ) {
        return currentMessages;
      }
      return [
        ...currentMessages,
        { content: assistantFeedback, role: "assistant" },
      ];
    });
  }, [assistantFeedback]);

  useEffect(() => {
    messageListEndRef.current?.scrollIntoView({ block: "end" });
  }, [draft, messages]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || isRunning) return;

    setMessages((currentMessages) => [
      ...currentMessages,
      { content: message, role: "user" },
    ]);
    lastAssistantFeedbackRef.current = null;
    onSubmit(message, { toolHelpMode: isToolHelpMode });
    setInput("");
  }

  const panelStyle = anchor
    ? {
        left: Math.max(12, Math.min(anchor.x + 20, window.innerWidth - 372)),
        top: Math.max(12, Math.min(anchor.y + 20, window.innerHeight - 420)),
      }
    : undefined;

  return (
    <>
      {holdProgress ? (
        <div
          aria-label="Canvas AI 열기 진행 중"
          className="pointer-events-none fixed z-[70] grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-lg"
          style={{
            left: holdProgress.x,
            top: holdProgress.y,
            background: `conic-gradient(#22d3ee ${holdProgress.progress * 360}deg, rgba(15, 23, 42, 0.9) 0deg)`,
          }}
        >
          <span className="grid size-9 place-items-center rounded-full bg-slate-950 text-cyan-200">
            <Bot className="size-4" />
          </span>
        </div>
      ) : null}

      {anchor ? (
        <section
          aria-label="Canvas AI 채팅"
          className="canvas-ai-chat fixed z-[70] w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-cyan-200 bg-white shadow-2xl shadow-slate-950/20"
          style={panelStyle}
        >
          <header className="flex items-center justify-between border-b border-cyan-100 bg-cyan-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <span className="grid size-8 place-items-center rounded-full bg-slate-950 text-cyan-200">
                <Bot className="size-4" />
              </span>
              Canvas AI
            </div>
            <div className="flex items-center gap-2">
              <button
                aria-pressed={isToolHelpMode}
                className={
                  isToolHelpMode
                    ? "rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold text-cyan-100 shadow-sm"
                    : "rounded-full border border-cyan-200 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-white hover:text-slate-950"
                }
                onClick={() => setIsToolHelpMode((current) => !current)}
                type="button"
              >
                기능 설명
              </button>
              <button
                aria-label="Canvas AI 채팅 닫기"
                className="grid size-8 place-items-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-950"
                onClick={onClose}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
          </header>

          <div className="max-h-64 space-y-2 overflow-y-auto bg-white px-4 py-4 text-sm leading-6 text-slate-700 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {messages.map((message, index) => (
              <p
                key={`${message.role}-${index}`}
                className={
                  message.role === "assistant"
                    ? "w-fit max-w-[90%] rounded-xl rounded-tl-sm bg-slate-100 px-3 py-2"
                    : "ml-auto w-fit max-w-[90%] rounded-xl rounded-tr-sm bg-cyan-600 px-3 py-2 text-white"
                }
              >
                {message.content}
              </p>
            ))}
            {draft ? (
              <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs text-slate-700">
                <strong className="block text-sm text-slate-950">{draft.spec.title}</strong>
                <span className="mt-1 block">{draft.summary}</span>
                <span className="mt-1 block text-slate-500">
                  {draft.spec.nodes.filter((node) => node.kind !== "frame").length}개 도형 초안
                </span>
                <div className="mt-3 flex gap-2">
                  <button
                    className="rounded-lg bg-slate-950 px-3 py-1.5 font-medium text-white"
                    onClick={onApplyDraft}
                    type="button"
                  >
                    적용
                  </button>
                  <button
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700"
                    onClick={onDiscardDraft}
                    type="button"
                  >
                    폐기
                  </button>
                </div>
              </div>
            ) : null}
            <div ref={messageListEndRef} />
          </div>

          <form className="flex gap-2 border-t border-slate-100 p-3" onSubmit={handleSubmit}>
            <input
              aria-label="Canvas AI 메시지"
              className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none placeholder:text-slate-400 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
              onChange={(event) => setInput(event.target.value)}
              placeholder={isToolHelpMode ? "기능 이름이나 위치를 물어보세요" : "Canvas AI에게 물어보세요"}
              value={input}
            />
            <button
              aria-label="Canvas AI 메시지 보내기"
              className="grid size-10 place-items-center rounded-xl bg-slate-950 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={!input.trim() || isRunning}
              type="submit"
            >
              <SendHorizontal className="size-4" />
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
