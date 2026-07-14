import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";

export type PrReviewCanvasRoutePoint = {
  x: number;
  y: number;
};

export type PrReviewCanvasLayoutFile = {
  roomFileId: string;
  width: number;
  height: number;
  flowSortOrder: number;
  workflowOrder: number;
  filePath: string;
};

export type PrReviewCanvasLayoutRelation = {
  id: string;
  fromRoomFileId: string;
  toRoomFileId: string;
};

export type PrReviewCanvasGraphLayout = {
  nodeGeometryByRoomFileId: Map<string, { x: number; y: number }>;
  routePointsByRelationId: Map<string, PrReviewCanvasRoutePoint[]>;
};

const LAYOUT_TIMEOUT_MS = 1_500;

export async function buildPrReviewCanvasGraphLayout(input: {
  files: PrReviewCanvasLayoutFile[];
  relations: PrReviewCanvasLayoutRelation[];
}): Promise<PrReviewCanvasGraphLayout | null> {
  if (input.files.length < 2 || input.relations.length === 0) {
    return null;
  }

  const files = [...input.files].sort(compareFiles);
  const roomFileIds = new Set(files.map((file) => file.roomFileId));
  const relations = input.relations.filter(
    (relation) =>
      relation.fromRoomFileId !== relation.toRoomFileId &&
      roomFileIds.has(relation.fromRoomFileId) &&
      roomFileIds.has(relation.toRoomFileId)
  );
  if (relations.length === 0) {
    return null;
  }

  const elk = new ELK();
  const graph: ElkNode = {
    id: "pr-review-canvas",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.spacing.nodeNode": "112",
      "elk.layered.spacing.nodeNodeBetweenLayers": "160",
      "elk.padding": "[top=120,left=120,bottom=120,right=120]"
    },
    children: files.map((file) => ({
      id: file.roomFileId,
      width: file.width,
      height: file.height
    })),
    edges: relations.map((relation) => ({
      id: relation.id,
      sources: [relation.fromRoomFileId],
      targets: [relation.toRoomFileId]
    }))
  };
  const layout = await withTimeout(
    elk.layout(graph),
    LAYOUT_TIMEOUT_MS
  );

  const nodeGeometryByRoomFileId = new Map<string, { x: number; y: number }>();
  for (const node of layout.children ?? []) {
    if (
      !node.id ||
      !roomFileIds.has(node.id) ||
      !isFiniteNumber(node.x) ||
      !isFiniteNumber(node.y)
    ) {
      return null;
    }

    nodeGeometryByRoomFileId.set(node.id, { x: node.x, y: node.y });
  }
  if (nodeGeometryByRoomFileId.size !== files.length) {
    return null;
  }

  const routePointsByRelationId = new Map<string, PrReviewCanvasRoutePoint[]>();
  for (const edge of layout.edges ?? []) {
    if (!edge.id || !edge.sections?.length) {
      continue;
    }

    const section = edge.sections[0];
    const points = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint
    ];
    if (points.some((point) => !isFiniteNumber(point.x) || !isFiniteNumber(point.y))) {
      continue;
    }

    routePointsByRelationId.set(edge.id, deduplicateRoutePoints(points));
  }

  return { nodeGeometryByRoomFileId, routePointsByRelationId };
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("PR Review Canvas layout timed out"));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function deduplicateRoutePoints(
  points: readonly PrReviewCanvasRoutePoint[]
): PrReviewCanvasRoutePoint[] {
  return points.reduce<PrReviewCanvasRoutePoint[]>((result, point) => {
    const previous = result[result.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) {
      result.push({ x: point.x, y: point.y });
    }
    return result;
  }, []);
}

function compareFiles(left: PrReviewCanvasLayoutFile, right: PrReviewCanvasLayoutFile) {
  return (
    left.flowSortOrder - right.flowSortOrder ||
    left.workflowOrder - right.workflowOrder ||
    left.filePath.localeCompare(right.filePath) ||
    left.roomFileId.localeCompare(right.roomFileId)
  );
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
