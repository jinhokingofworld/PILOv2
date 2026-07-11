import type {
  CanvasAgentDraftNode,
  CanvasAgentDraftNodeKind,
  CanvasAgentDraftToolStep,
  CanvasDraftSpec
} from "./canvas-agent.types";
import { getCanvasAgentDraftNodeAbsolutePosition } from "./canvas-agent-draft-placement";

export function createCanvasAgentDraftToolSteps(
  nodes: CanvasAgentDraftNode[],
  connections: CanvasDraftSpec["connections"]
): CanvasAgentDraftToolStep[] {
  const steps: CanvasAgentDraftToolStep[] = [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  nodes.forEach((node) => {
    const position = getCanvasAgentDraftNodeAbsolutePosition(node, nodeMap, new Set());
    steps.push({
      kind: "tool",
      toolTarget: toolTargetForNode(node.kind),
      toolTargetLabel: toolLabelForNode(node.kind),
      nodeId: node.id
    });
    steps.push({
      kind: "place",
      nodeId: node.id,
      x: position.x + node.width / 2,
      y: position.y + node.height / 2
    });
  });

  connections.forEach((connection) => {
    steps.push({
      kind: "tool",
      toolTarget: connection.kind === "line" ? "toolbar.line.line" : "toolbar.line.arrow",
      toolTargetLabel: connection.kind === "line" ? "선" : "화살표",
      connectionId: connection.id
    });
    steps.push({
      kind: "connect",
      connectionId: connection.id,
      from: connection.from,
      to: connection.to
    });
  });

  return steps.slice(0, 80);
}

function toolTargetForNode(kind: CanvasAgentDraftNodeKind): string {
  if (kind === "frame") return "toolbar.frame";
  if (kind === "note") return "toolbar.memo";
  if (kind === "text") return "toolbar.text";
  if (kind === "rectangle") return "toolbar.draw.rectangle";
  if (kind === "circle") return "toolbar.draw.circle";
  if (kind === "triangle") return "toolbar.draw.triangle";
  return "toolbar.code";
}

function toolLabelForNode(kind: CanvasAgentDraftNodeKind): string {
  if (kind === "frame") return "프레임";
  if (kind === "note") return "메모";
  if (kind === "text") return "텍스트";
  if (kind === "rectangle") return "사각형";
  if (kind === "circle") return "원";
  if (kind === "triangle") return "삼각형";
  return "코드 블록";
}
