"use client";

import { useValue } from "@tldraw/state-react";
import type { Editor, TLShapeId } from "tldraw";
import { Bot } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { dispatchCanvasAgentToolTarget } from "@/features/canvas/agent/canvas-agent-tool-targets";
import type {
  CanvasAgentDraft,
  CanvasAgentProgress,
} from "@/features/canvas/api/canvas-agent-types";
import {
  getCanvasAgentDraftNodePagePosition,
  getCanvasAgentDraftStepMessage,
  getCanvasAgentDraftStepPointerScreenPoint,
  useCanvasAgentToolStepPlayback,
} from "./canvas-agent-tool-step-playback";

export function CanvasAgentVisualOverlay({
  draft,
  editor,
  progress,
}: {
  draft: CanvasAgentDraft | null;
  editor: Editor | null;
  progress: CanvasAgentProgress | null;
}) {
  const camera = useValue(
    "canvas-agent-overlay-camera",
    () => editor?.getCamera() ?? { x: 0, y: 0, z: 1 },
    [editor],
  );
  const playback = useCanvasAgentToolStepPlayback(draft);
  const activeToolTarget = playback.activeStep
    ? playback.activeStep.kind === "tool"
      ? playback.activeStep.toolTarget ?? null
      : null
    : progress?.toolTarget ?? null;
  const activeToolTargetLabel = playback.activeStep
    ? playback.activeStep.kind === "tool"
      ? playback.activeStep.toolTargetLabel ?? null
      : null
    : progress?.toolTargetLabel ?? null;
  const toolRect = useToolTargetRect(activeToolTarget);

  useEffect(() => {
    if (playback.activeStep?.kind === "tool" && playback.activeStep.toolTarget) {
      dispatchCanvasAgentToolTarget(playback.activeStep.toolTarget);
    }
  }, [playback.activeStep]);

  const nodeMap = new Map(draft?.spec.nodes.map((node) => [node.id, node]) ?? []);
  const targetPointer = editor
    ? getCanvasAgentDraftStepPointerScreenPoint(editor, playback.activeStep, nodeMap, toolRect)
      ?? getPointerScreenPoint(editor, progress, toolRect)
    : null;
  const pointer = useAnimatedPointerPoint(targetPointer);
  const visibleNodeIds = playback.visibleNodeIds;
  const message = getCanvasAgentDraftStepMessage(playback.activeStep) ?? progress?.message ?? null;

  if (!editor) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[65] overflow-hidden">
      {draft
        ? draft.spec.nodes.filter((node) => !visibleNodeIds || visibleNodeIds.has(node.id)).map((node) => {
            const pagePosition = getCanvasAgentDraftNodePagePosition(node, nodeMap);
            const pageX = pagePosition.x;
            const pageY = pagePosition.y;
            const screen = editor.pageToScreen({ x: pageX, y: pageY });
            const width = node.width * camera.z;
            const height = node.height * camera.z;
            const isFrame = node.kind === "frame";
            const isCircle = node.kind === "circle";
            const isTriangle = node.kind === "triangle";

            return (
              <div
                className={
                  isFrame
                    ? "absolute rounded-xl border-2 border-dashed border-cyan-500/80 bg-cyan-100/15"
                    : "absolute overflow-hidden border border-cyan-400/80 bg-cyan-50/90 px-3 py-2 text-slate-800 shadow-lg shadow-cyan-950/10"
                }
                key={node.id}
                style={{
                  left: screen.x,
                  top: screen.y,
                  width,
                  height,
                  borderRadius: isCircle ? "9999px" : isTriangle ? "0.75rem" : "0.75rem",
                  clipPath: isTriangle ? "polygon(50% 0%, 100% 100%, 0% 100%)" : undefined,
                }}
              >
                {isFrame ? (
                  <span className="absolute -top-7 left-0 rounded-full bg-cyan-600 px-2 py-0.5 text-xs font-semibold text-white">
                    AI 초안 · {node.title}
                  </span>
                ) : node.kind === "text" ? (
                  <span className="block text-sm font-semibold leading-snug">{node.text ?? node.title}</span>
                ) : (
                  <>
                    <strong className="block truncate text-sm">{node.title}</strong>
                    {node.kind === "code" ? (
                      <pre className="mt-1 max-h-32 overflow-hidden whitespace-pre-wrap text-[11px] leading-4 text-slate-600">
                        {node.code}
                      </pre>
                    ) : node.text && !isTriangle ? (
                      <span className="mt-1 block line-clamp-3 text-xs text-slate-600">{node.text}</span>
                    ) : null}
                  </>
                )}
              </div>
            );
          })
        : null}
      {toolRect ? (
        <div
          className="absolute rounded-2xl border-2 border-cyan-300 bg-cyan-200/15 shadow-[0_0_0_6px_rgba(34,211,238,0.18),0_18px_45px_rgba(15,23,42,0.2)]"
          style={{
            height: toolRect.height + 14,
            left: toolRect.left - 7,
            top: toolRect.top - 7,
            width: toolRect.width + 14,
          }}
        >
          {activeToolTargetLabel ? (
            <span className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-cyan-600 px-2 py-0.5 text-xs font-semibold text-white">
              {activeToolTargetLabel}
            </span>
          ) : null}
        </div>
      ) : null}
      {pointer ? (
        <div
          className="absolute grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-slate-950 text-cyan-200 shadow-lg transition-[left,top,transform] duration-500 ease-out"
          style={{ left: pointer.x, top: pointer.y }}
        >
          <Bot className="size-4" />
        </div>
      ) : null}
      {message ? (
        <div className="absolute left-1/2 top-5 -translate-x-1/2 rounded-full bg-slate-950/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
          {message}
        </div>
      ) : null}
    </div>
  );
}

function useAnimatedPointerPoint(targetPoint: { x: number; y: number } | null) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const pointRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    pointRef.current = point;
  }, [point]);

  useEffect(() => {
    if (!targetPoint) {
      setPoint(null);
      return undefined;
    }

    const current = pointRef.current;
    setPoint(current ?? getPointerLaunchPoint());
    const animationFrame = window.requestAnimationFrame(() => {
      setPoint(targetPoint);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [targetPoint?.x, targetPoint?.y]);

  return point;
}

function useToolTargetRect(toolTarget: string | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!toolTarget) {
      setRect(null);
      return undefined;
    }

    let animationFrame = 0;
    const startedAt = performance.now();

    const updateRect = () => {
      const element = findToolTargetElement(toolTarget);
      setRect(element?.getBoundingClientRect() ?? null);
      if (performance.now() - startedAt < 800) {
        animationFrame = window.requestAnimationFrame(updateRect);
      }
    };

    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [toolTarget]);

  return rect;
}

function findToolTargetElement(toolTarget: string) {
  let currentTarget: string | null = toolTarget;
  while (currentTarget) {
    const element = document.querySelector<HTMLElement>(
      `[data-canvas-agent-target="${escapeAttributeValue(currentTarget)}"]`,
    );
    if (element) return element;
    const lastSeparator = currentTarget.lastIndexOf(".");
    currentTarget = lastSeparator > 0 ? currentTarget.slice(0, lastSeparator) : null;
  }
  return null;
}

function getPointerScreenPoint(
  editor: Editor,
  progress: CanvasAgentProgress | null,
  toolRect: DOMRect | null,
) {
  if (!progress) return null;
  if (toolRect) {
    return {
      x: toolRect.left + toolRect.width / 2,
      y: toolRect.top + toolRect.height / 2,
    };
  }
  if (progress.targetViewport) {
    return editor.pageToScreen({
      x: progress.targetViewport.x + progress.targetViewport.width / 2,
      y: progress.targetViewport.y + progress.targetViewport.height / 2,
    });
  }
  const shapeId = progress.highlightedShapeIds[0];
  if (!shapeId) return null;
  const bounds = editor.getShapePageBounds(shapeId as TLShapeId);
  if (!bounds) return null;
  return editor.pageToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
}

function escapeAttributeValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function getPointerLaunchPoint() {
  const element = document.querySelector<HTMLElement>(
    '[data-canvas-agent-target="toolbar.canvas_ai"]',
  );
  const rect = element?.getBoundingClientRect();
  if (rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  return { x: window.innerWidth / 2, y: Math.max(72, window.innerHeight * 0.18) };
}
