import type {
  CanvasAgentDraftNode,
  CanvasAgentRequestContext
} from "./canvas-agent.types";

export type CanvasAgentDraftRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export function placeCanvasAgentDraftNodes(input: {
  nodes: CanvasAgentDraftNode[];
  viewport: CanvasAgentRequestContext["viewport"];
}): CanvasAgentDraftNode[] {
  const bounds = getCanvasAgentDraftBounds(input.nodes);
  if (!bounds) return input.nodes;

  const target = fixedViewportPlacementOrigin(input.viewport);
  const dx = target.x - bounds.x;
  const dy = target.y - bounds.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return input.nodes;

  return input.nodes.map((node) => (
    node.parentId
      ? node
      : {
          ...node,
          x: node.x + dx,
          y: node.y + dy
        }
  ));
}

export function getCanvasAgentDraftBounds(
  nodes: CanvasAgentDraftNode[]
): CanvasAgentDraftRect | null {
  if (!nodes.length) return null;
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const rects = nodes.map((node) => {
    const position = getCanvasAgentDraftNodeAbsolutePosition(node, nodeMap, new Set());
    return {
      x: position.x,
      y: position.y,
      width: node.width,
      height: node.height
    };
  });
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function getCanvasAgentDraftNodeAbsolutePosition(
  node: CanvasAgentDraftNode,
  nodeMap: Map<string, CanvasAgentDraftNode>,
  visited: Set<string>
): { x: number; y: number } {
  if (!node.parentId || visited.has(node.id)) return { x: node.x, y: node.y };
  const parent = nodeMap.get(node.parentId);
  if (!parent) return { x: node.x, y: node.y };
  visited.add(node.id);
  const parentPosition = getCanvasAgentDraftNodeAbsolutePosition(parent, nodeMap, visited);
  visited.delete(node.id);
  return { x: parentPosition.x + node.x, y: parentPosition.y + node.y };
}

function fixedViewportPlacementOrigin(
  viewport: CanvasAgentRequestContext["viewport"]
): { x: number; y: number } {
  return {
    x: Math.round(viewport ? viewport.x + 80 : 80),
    y: Math.round(viewport ? viewport.y + 80 : 80)
  };
}
