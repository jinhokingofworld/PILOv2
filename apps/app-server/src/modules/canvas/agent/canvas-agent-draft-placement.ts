import type {
  CanvasAgentDraftNode,
  CanvasAgentRequestContext,
  CanvasAgentShapeRow
} from "./canvas-agent.types";

export type CanvasAgentDraftRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export function placeCanvasAgentDraftNodes(input: {
  nodes: CanvasAgentDraftNode[];
  occupiedShapes: CanvasAgentShapeRow[];
  viewport: CanvasAgentRequestContext["viewport"];
}): CanvasAgentDraftNode[] {
  const bounds = getCanvasAgentDraftBounds(input.nodes);
  if (!bounds) return input.nodes;

  const target = findPlacementOrigin(bounds, input.viewport, input.occupiedShapes);
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

function findPlacementOrigin(
  draftBounds: CanvasAgentDraftRect,
  viewport: CanvasAgentRequestContext["viewport"],
  occupiedShapes: CanvasAgentShapeRow[]
): { x: number; y: number } {
  const fallback = {
    x: viewport ? viewport.x + 80 : 80,
    y: viewport ? viewport.y + 80 : 80
  };
  const view = viewport ?? {
    x: 0,
    y: 0,
    width: Math.max(1200, draftBounds.width + 240),
    height: Math.max(800, draftBounds.height + 240)
  };
  const occupiedRects = occupiedShapes
    .map(shapeBounds)
    .filter((rect): rect is CanvasAgentDraftRect => rect !== null);
  const candidates = placementCandidates(view, draftBounds, fallback);
  const padding = 56;

  for (const candidate of candidates) {
    const candidateRect = {
      x: candidate.x - padding,
      y: candidate.y - padding,
      width: draftBounds.width + padding * 2,
      height: draftBounds.height + padding * 2
    };
    if (!occupiedRects.some((rect) => rectsIntersect(candidateRect, rect))) {
      return candidate;
    }
  }

  return fallback;
}

function placementCandidates(
  viewport: NonNullable<CanvasAgentRequestContext["viewport"]>,
  draftBounds: CanvasAgentDraftRect,
  fallback: { x: number; y: number }
): Array<{ x: number; y: number }> {
  const gap = 96;
  const insideRight = viewport.x + viewport.width - draftBounds.width - 80;
  const insideBottom = viewport.y + viewport.height - draftBounds.height - 80;
  const baseCandidates = [
    fallback,
    {
      x: viewport.x + Math.max(80, (viewport.width - draftBounds.width) / 2),
      y: viewport.y + Math.max(80, (viewport.height - draftBounds.height) / 2)
    },
    { x: insideRight, y: viewport.y + 80 },
    { x: viewport.x + 80, y: insideBottom },
    { x: viewport.x + viewport.width + gap, y: viewport.y + 80 },
    { x: viewport.x + 80, y: viewport.y + viewport.height + gap },
    { x: viewport.x + viewport.width + gap, y: viewport.y + viewport.height + gap },
    { x: viewport.x - draftBounds.width - gap, y: viewport.y + 80 },
    { x: viewport.x + 80, y: viewport.y - draftBounds.height - gap }
  ];
  const candidates: Array<{ x: number; y: number }> = [];
  const seen = new Set<string>();

  for (const candidate of baseCandidates) {
    pushPlacementCandidate(candidates, seen, candidate);
  }

  const stepX = draftBounds.width + gap;
  const stepY = draftBounds.height + gap;
  for (let radius = 1; radius <= 3; radius += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) continue;
        pushPlacementCandidate(candidates, seen, {
          x: fallback.x + offsetX * stepX,
          y: fallback.y + offsetY * stepY
        });
      }
    }
  }

  return candidates;
}

function pushPlacementCandidate(
  candidates: Array<{ x: number; y: number }>,
  seen: Set<string>,
  candidate: { x: number; y: number }
): void {
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return;
  const normalized = {
    x: Math.round(candidate.x),
    y: Math.round(candidate.y)
  };
  const key = `${normalized.x}:${normalized.y}`;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push(normalized);
}

function shapeBounds(shape: CanvasAgentShapeRow): CanvasAgentDraftRect | null {
  const x = Number(shape.x);
  const y = Number(shape.y);
  const width = Number(shape.width ?? 180);
  const height = Number(shape.height ?? 100);
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null;
  return {
    x,
    y,
    width: Math.max(1, width),
    height: Math.max(1, height)
  };
}

function rectsIntersect(left: CanvasAgentDraftRect, right: CanvasAgentDraftRect): boolean {
  return (
    left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
  );
}
