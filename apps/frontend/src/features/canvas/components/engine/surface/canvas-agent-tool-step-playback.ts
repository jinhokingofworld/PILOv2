import { useEffect, useState } from "react";
import type { Editor } from "tldraw";
import type { CanvasAgentDraft } from "@/features/canvas/api/canvas-agent-types";

type CanvasAgentDraftNode = CanvasAgentDraft["spec"]["nodes"][number];
type CanvasAgentToolStep = NonNullable<CanvasAgentDraft["spec"]["toolSteps"]>[number];

export function useCanvasAgentToolStepPlayback(draft: CanvasAgentDraft | null) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const draftKey = draft ? `${draft.id}:${draft.status}:${draft.spec.toolSteps?.length ?? 0}` : null;
  const steps = draft?.spec.toolSteps ?? [];

  useEffect(() => {
    if (!draftKey || !steps.length) {
      setActiveIndex(null);
      return undefined;
    }

    let cancelled = false;
    let timer: number | null = null;
    setActiveIndex(0);

    const schedule = (nextIndex: number) => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        if (nextIndex >= steps.length) {
          setActiveIndex(null);
          return;
        }
        setActiveIndex(nextIndex);
        schedule(nextIndex + 1);
      }, toolStepDuration(steps[nextIndex - 1]));
    };

    schedule(1);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [draftKey, steps]);

  const visibleNodeIds = activeIndex === null
    ? null
    : new Set(
        steps
          .slice(0, activeIndex + 1)
          .filter((step) => step.kind === "place" && step.nodeId)
          .map((step) => step.nodeId as string),
      );

  return {
    activeStep: activeIndex === null ? null : steps[activeIndex] ?? null,
    visibleNodeIds,
  };
}

export function getCanvasAgentDraftNodePagePosition(
  node: CanvasAgentDraftNode,
  nodeMap: Map<string, CanvasAgentDraftNode>,
): { x: number; y: number } {
  if (!node.parentId) return { x: node.x, y: node.y };
  const parent = nodeMap.get(node.parentId);
  if (!parent) return { x: node.x, y: node.y };
  const parentPosition = getCanvasAgentDraftNodePagePosition(parent, nodeMap);
  return { x: parentPosition.x + node.x, y: parentPosition.y + node.y };
}

export function getCanvasAgentDraftStepPointerScreenPoint(
  editor: Editor,
  step: CanvasAgentToolStep | null,
  nodeMap: Map<string, CanvasAgentDraftNode>,
  toolRect: DOMRect | null,
) {
  if (!step) return null;
  if (step.kind === "tool" && toolRect) {
    return {
      x: toolRect.left + toolRect.width / 2,
      y: toolRect.top + toolRect.height / 2,
    };
  }
  if (step.kind === "place") {
    if (typeof step.x === "number" && typeof step.y === "number") {
      return editor.pageToScreen({ x: step.x, y: step.y });
    }
    const node = step.nodeId ? nodeMap.get(step.nodeId) : null;
    return node ? editor.pageToScreen(getCanvasAgentDraftNodeCenter(node, nodeMap)) : null;
  }
  if (step.kind === "connect") {
    const fromNode = step.from ? nodeMap.get(step.from) : null;
    const toNode = step.to ? nodeMap.get(step.to) : null;
    if (!fromNode || !toNode) return null;
    const from = getCanvasAgentDraftNodeCenter(fromNode, nodeMap);
    const to = getCanvasAgentDraftNodeCenter(toNode, nodeMap);
    return editor.pageToScreen({
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
    });
  }
  return null;
}

export function getCanvasAgentDraftStepMessage(step: CanvasAgentToolStep | null) {
  if (!step) return null;
  if (step.kind === "tool") {
    return `${step.toolTargetLabel ?? "도구"} 도구로 이동할게요.`;
  }
  if (step.kind === "place") {
    return "여기에 하나씩 배치할게요.";
  }
  return "이제 관계를 연결할게요.";
}

function getCanvasAgentDraftNodeCenter(
  node: CanvasAgentDraftNode,
  nodeMap: Map<string, CanvasAgentDraftNode>,
) {
  const position = getCanvasAgentDraftNodePagePosition(node, nodeMap);
  return {
    x: position.x + node.width / 2,
    y: position.y + node.height / 2,
  };
}

function toolStepDuration(step: CanvasAgentToolStep | undefined) {
  if (!step) return 700;
  if (step.kind === "tool") return 650;
  if (step.kind === "connect") return 800;
  return 750;
}
