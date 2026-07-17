"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { Bot, Check, Copy, Eye, SendHorizontal, X } from "lucide-react";
import { canvasAgentToolTargets } from "@/features/canvas/agent/canvas-agent-tool-targets";
import type {
  CanvasAgentConversationMessage,
  CanvasAgentDraft,
  CanvasAgentHtmlArtifact,
} from "@/features/canvas/api/canvas-agent-types";
import type { CanvasAiChatAnchor } from "../canvas-editor-contracts";

type CanvasAiChatOverlayProps = {
  anchor: CanvasAiChatAnchor | null;
  artifact: CanvasAgentHtmlArtifact | null;
  draft: CanvasAgentDraft | null;
  error: string | null;
  holdProgress: (CanvasAiChatAnchor & { progress: number }) | null;
  isRunning: boolean;
  onApplyDraft: () => void;
  onClose: () => void;
  onDiscardDraft: () => void;
  onSubmit: (
    message: string,
    options?: {
      conversationContext?: { messages: CanvasAgentConversationMessage[] };
      toolHelpMode?: boolean;
    },
  ) => void;
  statusMessage: string | null;
};

type CanvasAiMessage = {
  content: string;
  role: "assistant" | "user";
};

const defaultAssistantIntroMessage =
  "캔버스에 관한 작업을 도와드릴게요. 저는 C를 누르면 캔버스 어디서든 부를 수 있어요.";

const toolHelpAssistantIntroMessage = `기능 설명 모드예요. 지금 설명할 수 있는 기능은 아래와 같아요.
${canvasAgentToolTargets
  .map((tool, index) => `${index + 1}. ${tool.label}`)
  .join("\n")}
궁금한 기능 이름이나 위치를 물어봐 주세요.`;

function replaceIntroMessage(
  messages: CanvasAiMessage[],
  nextIntroMessage: string,
) {
  const [firstMessage, ...restMessages] = messages;
  if (firstMessage?.role !== "assistant") {
    return [{ content: nextIntroMessage, role: "assistant" as const }, ...messages];
  }

  return [
    {
      ...firstMessage,
      content: nextIntroMessage,
    },
    ...restMessages,
  ];
}

function toConversationMessages(messages: CanvasAiMessage[]): CanvasAgentConversationMessage[] {
  return messages
    .filter((message, index) => {
      if (index !== 0 || message.role !== "assistant") return true;
      return message.content !== defaultAssistantIntroMessage
        && message.content !== toolHelpAssistantIntroMessage;
    })
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))
    .slice(-10);
}

function buildSandboxedPreviewDocument(html: string) {
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:";
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`);
  }
  return /<html(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<html(?:\s[^>]*)?>/i, (root) => `${root}<head>${meta}</head>`)
    : `<html><head>${meta}</head><body>${html}</body></html>`;
}

export function CanvasAiChatOverlay({
  anchor,
  artifact,
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
  const [isArtifactPreviewVisible, setIsArtifactPreviewVisible] = useState(false);
  const [isArtifactCopied, setIsArtifactCopied] = useState(false);
  const [isToolHelpMode, setIsToolHelpMode] = useState(false);
  const [messages, setMessages] = useState<CanvasAiMessage[]>([
    {
      content: defaultAssistantIntroMessage,
      role: "assistant",
    },
  ]);
  const lastAssistantFeedbackRef = useRef<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageListEndRef = useRef<HTMLDivElement>(null);
  const assistantFeedback = (error ?? statusMessage)?.trim() || null;

  useEffect(() => {
    setIsArtifactPreviewVisible(false);
    setIsArtifactCopied(false);
  }, [artifact?.html]);

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
    if (!anchor) return;

    const messageList = messageListRef.current;
    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight;
    }
    messageListEndRef.current?.scrollIntoView({ block: "end" });
  }, [anchor, draft, messages]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || isRunning) return;

    setMessages((currentMessages) => [
      ...currentMessages,
      { content: message, role: "user" },
    ]);
    lastAssistantFeedbackRef.current = null;
    onSubmit(message, {
      conversationContext: { messages: toConversationMessages(messages) },
      toolHelpMode: isToolHelpMode,
    });
    setInput("");
  }

  function toggleToolHelpMode() {
    setIsToolHelpMode((currentMode) => {
      const nextMode = !currentMode;
      setMessages((currentMessages) =>
        replaceIntroMessage(
          currentMessages,
          nextMode ? toolHelpAssistantIntroMessage : defaultAssistantIntroMessage,
        )
      );
      return nextMode;
    });
  }

  async function copyArtifact() {
    if (!artifact) return;
    try {
      await navigator.clipboard.writeText(artifact.html);
      setIsArtifactCopied(true);
      window.setTimeout(() => setIsArtifactCopied(false), 1800);
    } catch {
      setIsArtifactCopied(false);
    }
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
                onClick={toggleToolHelpMode}
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

          <div
            ref={messageListRef}
            className="max-h-64 space-y-2 overflow-y-auto bg-white px-4 py-4 text-sm leading-6 text-slate-700 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {messages.map((message, index) => (
              <p
                key={`${message.role}-${index}`}
                className={
                  message.role === "assistant"
                    ? "w-fit max-w-[90%] whitespace-pre-line rounded-xl rounded-tl-sm bg-slate-100 px-3 py-2"
                    : "ml-auto w-fit max-w-[90%] rounded-xl rounded-tr-sm bg-cyan-600 px-3 py-2 text-white"
                }
              >
                {message.content}
              </p>
            ))}
            {artifact ? (
              <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs text-slate-700">
                <strong className="block text-sm text-slate-950">{artifact.title}</strong>
                <span className="mt-1 block text-slate-500">
                  정적 HTML/CSS 초안 · {artifact.sourceShapeIds.length}개 도형
                </span>
                <div className="mt-3 flex gap-2">
                  <button
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-950 px-3 py-1.5 font-medium text-white"
                    onClick={() => void copyArtifact()}
                    type="button"
                  >
                    {isArtifactCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {isArtifactCopied ? "복사됨" : "HTML 복사"}
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700"
                    onClick={() => setIsArtifactPreviewVisible((visible) => !visible)}
                    type="button"
                  >
                    <Eye className="size-3.5" />
                    {isArtifactPreviewVisible ? "미리보기 닫기" : "미리보기"}
                  </button>
                </div>
                {isArtifactPreviewVisible ? (
                  <iframe
                    className="mt-3 h-52 w-full rounded-lg border border-slate-200 bg-white"
                    sandbox=""
                    srcDoc={buildSandboxedPreviewDocument(artifact.html)}
                    title={`${artifact.title} 미리보기`}
                  />
                ) : null}
              </div>
            ) : null}
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
