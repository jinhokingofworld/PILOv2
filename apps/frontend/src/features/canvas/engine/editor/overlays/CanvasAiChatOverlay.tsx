"use client";

import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Bot, SendHorizontal, X } from "lucide-react";
import { CanvasHtmlArtifactPreview } from "@/components/canvas-html-artifact-preview";
import { canvasAgentToolTargets } from "@/features/canvas/agent/canvas-agent-tool-targets";
import type {
  CanvasAgentConversationMessage,
  CanvasAgentDraft,
  CanvasAgentHtmlArtifact,
} from "@/features/canvas/api/canvas-agent-types";
import type { CanvasAiChatAnchor } from "../canvas-editor-contracts";
import {
  clampCanvasAiChatLayout,
  createCanvasAiChatLayout,
  moveCanvasAiChatLayout,
  parseCanvasAiChatLayout,
  resizeCanvasAiChatLayout,
  type CanvasAiChatLayout,
  type CanvasAiChatResizeDirection,
} from "./canvas-ai-chat-layout";

type CanvasAiChatOverlayProps = {
  anchor: CanvasAiChatAnchor | null;
  artifact: CanvasAgentHtmlArtifact | null;
  draft: CanvasAgentDraft | null;
  error: string | null;
  holdProgress: (CanvasAiChatAnchor & { progress: number }) | null;
  isRunning: boolean;
  layoutStorageKey: string;
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

type CanvasAiChatLayoutInteraction = {
  captureTarget: HTMLElement;
  direction?: CanvasAiChatResizeDirection;
  initialLayout: CanvasAiChatLayout;
  kind: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
};

const resizeHandles = [
  { className: "left-3 right-3 top-0 h-2 cursor-n-resize", direction: "n" },
  { className: "right-0 top-0 size-4 cursor-ne-resize", direction: "ne" },
  { className: "bottom-3 right-0 top-3 w-2 cursor-e-resize", direction: "e" },
  { className: "bottom-0 right-0 size-4 cursor-se-resize", direction: "se" },
  { className: "bottom-0 left-3 right-3 h-2 cursor-s-resize", direction: "s" },
  { className: "bottom-0 left-0 size-4 cursor-sw-resize", direction: "sw" },
  { className: "bottom-3 left-0 top-3 w-2 cursor-w-resize", direction: "w" },
  { className: "left-0 top-0 size-4 cursor-nw-resize", direction: "nw" },
] satisfies Array<{ className: string; direction: CanvasAiChatResizeDirection }>;

function getViewportSize() {
  return {
    height: window.innerHeight,
    width: window.innerWidth,
  };
}

function readStoredLayout(storageKey: string) {
  try {
    return parseCanvasAiChatLayout(window.localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

function storeLayout(storageKey: string, layout: CanvasAiChatLayout) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    // The panel remains usable when browser storage is unavailable.
  }
}

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

export function CanvasAiChatOverlay({
  anchor,
  artifact,
  draft,
  error,
  holdProgress,
  isRunning,
  layoutStorageKey,
  onApplyDraft,
  onClose,
  onDiscardDraft,
  onSubmit,
  statusMessage,
}: CanvasAiChatOverlayProps) {
  const [input, setInput] = useState("");
  const [isToolHelpMode, setIsToolHelpMode] = useState(false);
  const [layout, setLayout] = useState<CanvasAiChatLayout | null>(null);
  const [messages, setMessages] = useState<CanvasAiMessage[]>([
    {
      content: defaultAssistantIntroMessage,
      role: "assistant",
    },
  ]);
  const lastAssistantFeedbackRef = useRef<string | null>(null);
  const layoutInteractionRef = useRef<CanvasAiChatLayoutInteraction | null>(null);
  const loadedLayoutStorageKeyRef = useRef<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageListEndRef = useRef<HTMLDivElement>(null);
  const assistantFeedback = (error ?? statusMessage)?.trim() || null;

  useEffect(() => {
    if (!anchor) return;

    setLayout((currentLayout) => {
      if (
        loadedLayoutStorageKeyRef.current === layoutStorageKey
        && currentLayout
      ) {
        return clampCanvasAiChatLayout(currentLayout, getViewportSize());
      }

      loadedLayoutStorageKeyRef.current = layoutStorageKey;
      const storedLayout = readStoredLayout(layoutStorageKey);
      return storedLayout
        ? clampCanvasAiChatLayout(storedLayout, getViewportSize())
        : createCanvasAiChatLayout(anchor, getViewportSize());
    });
  }, [anchor, layoutStorageKey]);

  useEffect(() => {
    if (!layout || loadedLayoutStorageKeyRef.current !== layoutStorageKey) return;

    const persistenceTimer = window.setTimeout(() => {
      storeLayout(layoutStorageKey, layout);
    }, 120);

    return () => window.clearTimeout(persistenceTimer);
  }, [layout, layoutStorageKey]);

  useEffect(() => {
    if (!anchor) return;

    function keepLayoutInViewport() {
      setLayout((currentLayout) => currentLayout
        ? clampCanvasAiChatLayout(currentLayout, getViewportSize())
        : currentLayout);
    }

    window.addEventListener("resize", keepLayoutInViewport);
    return () => window.removeEventListener("resize", keepLayoutInViewport);
  }, [anchor]);

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

  function beginLayoutInteraction(
    event: ReactPointerEvent<HTMLElement>,
    kind: "move" | "resize",
    direction?: CanvasAiChatResizeDirection,
  ) {
    if (event.button !== 0 || !layout) return;
    if (
      kind === "move"
      && event.target instanceof Element
      && event.target.closest("button, input, textarea, select, a")
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    layoutInteractionRef.current = {
      captureTarget: event.currentTarget,
      direction,
      initialLayout: layout,
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function updateLayoutInteraction(event: ReactPointerEvent<HTMLElement>) {
    const interaction = layoutInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    const delta = {
      x: event.clientX - interaction.startX,
      y: event.clientY - interaction.startY,
    };
    setLayout(
      interaction.kind === "move"
        ? moveCanvasAiChatLayout(interaction.initialLayout, delta, getViewportSize())
        : resizeCanvasAiChatLayout(
            interaction.initialLayout,
            interaction.direction ?? "se",
            delta,
            getViewportSize(),
          ),
    );
  }

  function endLayoutInteraction(event: ReactPointerEvent<HTMLElement>) {
    const interaction = layoutInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();
    if (interaction.captureTarget.hasPointerCapture(event.pointerId)) {
      interaction.captureTarget.releasePointerCapture(event.pointerId);
    }
    layoutInteractionRef.current = null;
  }

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

      {anchor && layout ? (
        <section
          aria-label="Canvas AI 채팅"
          className="canvas-ai-chat fixed z-[70] flex flex-col overflow-hidden rounded-2xl border border-cyan-200 bg-white shadow-2xl shadow-slate-950/20"
          onPointerCancel={endLayoutInteraction}
          onPointerMove={updateLayoutInteraction}
          onPointerUp={endLayoutInteraction}
          style={{
            height: layout.height,
            left: layout.x,
            top: layout.y,
            width: layout.width,
          }}
        >
          <header
            className="flex shrink-0 touch-none cursor-move select-none items-center justify-between border-b border-cyan-100 bg-cyan-50 px-4 py-3"
            onPointerDown={(event) => beginLayoutInteraction(event, "move")}
          >
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
            className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-white px-4 py-4 text-sm leading-6 text-slate-700 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {messages.map((message, index) => (
              <p
                key={`${message.role}-${index}`}
                className={
                  message.role === "assistant"
                    ? "w-fit max-w-[min(88%,42rem)] whitespace-pre-line rounded-xl rounded-tl-sm bg-slate-100 px-3 py-2"
                    : "ml-auto w-fit max-w-[min(88%,42rem)] rounded-xl rounded-tr-sm bg-cyan-600 px-3 py-2 text-white"
                }
              >
                {message.content}
              </p>
            ))}
            {artifact ? (
              <CanvasHtmlArtifactPreview artifact={artifact} />
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

          <form className="flex shrink-0 gap-2 border-t border-slate-100 p-3" onSubmit={handleSubmit}>
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
          {resizeHandles.map((handle) => (
            <span
              aria-hidden="true"
              className={`absolute z-20 touch-none ${handle.className}`}
              key={handle.direction}
              onPointerDown={(event) =>
                beginLayoutInteraction(event, "resize", handle.direction)}
            />
          ))}
        </section>
      ) : null}
    </>
  );
}
