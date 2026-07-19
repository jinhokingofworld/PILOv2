import * as dagre from "@dagrejs/dagre";

export type PrReviewGraphNode = {
  flowId: string;
  height: number;
  id: string;
  pinned: boolean;
  riskLevel: "high" | "medium" | "low" | "unknown";
  reviewStatus: "not_reviewed" | "approved" | "discussion_needed" | "unknown";
  roomFileId: string | null;
  width: number;
  workflowOrder: number;
  x: number;
  y: number;
};

export type PrReviewGraphRelation = {
  fromRoomFileId: string;
  id: string;
  relationTypes: string[];
  toRoomFileId: string;
};

export type PrReviewGraphFilter = {
  collapsedFlowIds: Set<string>;
  focusedFlowId: string | null;
  mode: "all" | "related" | "review_path";
  relationTypes: Set<string>;
  riskLevels: Set<PrReviewGraphNode["riskLevel"]>;
  reviewStatuses: Set<PrReviewGraphNode["reviewStatus"]>;
  selectedRoomFileId: string | null;
};

export type PrReviewGraphPresentation = {
  edgeOpacityById: Map<string, number>;
  nodeOpacityById: Map<string, number>;
};

export type PrReviewOrderFlow = {
  id: string;
  files: Array<{
    reviewFileId: string;
    workflowOrder: number;
  }>;
};

export type PrReviewStoredRelation = {
  flowId: string;
  fromReviewFileId: string;
  toReviewFileId: string;
  relationTypes: string[];
};

const DIMMED_OPACITY = 0.14;
const HIDDEN_OPACITY = 0;
const DEFAULT_NODE_GAP = 84;
const DEFAULT_RANK_GAP = 176;

export function buildPrReviewGraphPresentation(
  nodes: PrReviewGraphNode[],
  relations: PrReviewGraphRelation[],
  filter: PrReviewGraphFilter
): PrReviewGraphPresentation {
  const nodeByRoomFileId = new Map(
    nodes.flatMap((node) => (node.roomFileId ? [[node.roomFileId, node]] : []))
  );
  const relatedRoomFileIds = new Set<string>();

  if (filter.selectedRoomFileId) {
    relatedRoomFileIds.add(filter.selectedRoomFileId);
    for (const relation of relations) {
      if (relation.fromRoomFileId === filter.selectedRoomFileId) {
        relatedRoomFileIds.add(relation.toRoomFileId);
      }
      if (relation.toRoomFileId === filter.selectedRoomFileId) {
        relatedRoomFileIds.add(relation.fromRoomFileId);
      }
    }
  }

  const isNodeMatched = (node: PrReviewGraphNode) => {
    if (filter.collapsedFlowIds.has(node.flowId)) return false;
    if (filter.focusedFlowId && node.flowId !== filter.focusedFlowId) return false;
    if (
      filter.riskLevels.size > 0 &&
      !filter.riskLevels.has(node.riskLevel)
    ) {
      return false;
    }
    if (
      filter.reviewStatuses.size > 0 &&
      !filter.reviewStatuses.has(node.reviewStatus)
    ) {
      return false;
    }
    return true;
  };

  const nodeOpacityById = new Map<string, number>();
  for (const node of nodes) {
    if (!isNodeMatched(node)) {
      nodeOpacityById.set(
        node.id,
        filter.collapsedFlowIds.has(node.flowId)
          ? HIDDEN_OPACITY
          : DIMMED_OPACITY
      );
      continue;
    }

    if (
      filter.mode === "related" &&
      filter.selectedRoomFileId &&
      (!node.roomFileId || !relatedRoomFileIds.has(node.roomFileId))
    ) {
      nodeOpacityById.set(node.id, DIMMED_OPACITY);
      continue;
    }

    nodeOpacityById.set(node.id, 1);
  }

  const edgeOpacityById = new Map<string, number>();
  for (const relation of relations) {
    const from = nodeByRoomFileId.get(relation.fromRoomFileId);
    const to = nodeByRoomFileId.get(relation.toRoomFileId);
    const relationTypeMatched =
      filter.relationTypes.size === 0 ||
      relation.relationTypes.some((type) => filter.relationTypes.has(type));
    const endpointsVisible =
      from &&
      to &&
      nodeOpacityById.get(from.id) === 1 &&
      nodeOpacityById.get(to.id) === 1;
    const isSelectedRelation =
      filter.selectedRoomFileId &&
      (relation.fromRoomFileId === filter.selectedRoomFileId ||
        relation.toRoomFileId === filter.selectedRoomFileId);
    const isReviewPath = relation.relationTypes.includes("review_order");

    if (!relationTypeMatched || !endpointsVisible) {
      edgeOpacityById.set(relation.id, HIDDEN_OPACITY);
    } else if (
      filter.mode === "related" &&
      filter.selectedRoomFileId &&
      !isSelectedRelation
    ) {
      edgeOpacityById.set(relation.id, DIMMED_OPACITY);
    } else if (filter.mode === "review_path" && !isReviewPath) {
      edgeOpacityById.set(relation.id, DIMMED_OPACITY);
    } else {
      edgeOpacityById.set(relation.id, 1);
    }
  }

  return { edgeOpacityById, nodeOpacityById };
}

export function findMissingPrReviewOrderEdges(
  flows: PrReviewOrderFlow[],
  storedRelations: PrReviewStoredRelation[]
): Array<{
  flowId: string;
  fromReviewFileId: string;
  toReviewFileId: string;
}> {
  const storedReviewOrderKeys = new Set(
    storedRelations
      .filter((relation) => relation.relationTypes.includes("review_order"))
      .map((relation) =>
        [
          relation.flowId,
          relation.fromReviewFileId,
          relation.toReviewFileId
        ].join("\u0000")
      )
  );

  return flows.flatMap((flow) => {
    const files = [...flow.files].sort(
      (left, right) =>
        left.workflowOrder - right.workflowOrder ||
        left.reviewFileId.localeCompare(right.reviewFileId)
    );
    const missing = [] as Array<{
      flowId: string;
      fromReviewFileId: string;
      toReviewFileId: string;
    }>;

    for (let index = 1; index < files.length; index += 1) {
      const fromReviewFileId = files[index - 1].reviewFileId;
      const toReviewFileId = files[index].reviewFileId;
      const key = [flow.id, fromReviewFileId, toReviewFileId].join("\u0000");
      if (storedReviewOrderKeys.has(key)) {
        continue;
      }

      missing.push({
        flowId: flow.id,
        fromReviewFileId,
        toReviewFileId
      });
    }

    return missing;
  });
}

export function createPrReviewFlowLayout(
  nodes: PrReviewGraphNode[],
  relations: PrReviewGraphRelation[],
  flowId: string
): Map<string, { x: number; y: number }> {
  const flowNodes = nodes.filter((node) => node.flowId === flowId);
  const movableNodes = flowNodes.filter((node) => !node.pinned);
  if (!movableNodes.length) {
    return new Map();
  }

  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    marginx: 0,
    marginy: 0,
    nodesep: DEFAULT_NODE_GAP,
    rankdir: "LR",
    ranksep: DEFAULT_RANK_GAP,
    ranker: "network-simplex"
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of movableNodes) {
    graph.setNode(node.id, { height: node.height, width: node.width });
  }

  const orderedMovableNodes = [...movableNodes].sort(
    compareLayoutNodes
  );
  const layoutEdges = buildRelationDrivenDagreEdges(
    orderedMovableNodes,
    relations
  );
  for (const [index, edge] of layoutEdges.entries()) {
    graph.setEdge({
      name: `layout:${index}:${edge.from}->${edge.to}`,
      v: edge.from,
      w: edge.to
    });
  }

  dagre.layout(graph);

  const pinnedNodes = flowNodes.filter((node) => node.pinned);
  const originX = pinnedNodes.length
    ? Math.max(...pinnedNodes.map((node) => node.x + node.width)) + DEFAULT_RANK_GAP
    : Math.min(...flowNodes.map((node) => node.x));
  const originY = Math.min(...flowNodes.map((node) => node.y));
  const positioned = new Map<string, { x: number; y: number }>();

  for (const node of movableNodes) {
    const layoutNode = graph.node(node.id);
    positioned.set(node.id, {
      x: Math.round(originX + layoutNode.x - node.width / 2),
      y: Math.round(originY + layoutNode.y - node.height / 2)
    });
  }

  return positioned;
}

type DagreLayoutEdge = {
  from: string;
  to: string;
};

function compareLayoutNodes(
  left: PrReviewGraphNode,
  right: PrReviewGraphNode
) {
  return (
    left.workflowOrder - right.workflowOrder || left.id.localeCompare(right.id)
  );
}

function buildRelationDrivenDagreEdges(
  nodes: readonly PrReviewGraphNode[],
  relations: readonly PrReviewGraphRelation[]
): DagreLayoutEdge[] {
  const nodeByRoomFileId = new Map<string, PrReviewGraphNode>();
  for (const node of nodes) {
    if (node.roomFileId) {
      nodeByRoomFileId.set(node.roomFileId, node);
    }
  }
  const semanticPairs = new Map<string, DagreLayoutEdge>();

  for (const relation of relations) {
    if (!relation.relationTypes.some((type) => type !== "review_order")) {
      continue;
    }
    const left = nodeByRoomFileId.get(relation.fromRoomFileId);
    const right = nodeByRoomFileId.get(relation.toRoomFileId);
    if (!left || !right || left.id === right.id) {
      continue;
    }
    const [from, to] = compareLayoutNodes(left, right) <= 0
      ? [left, right]
      : [right, left];
    semanticPairs.set(`${from.id}\u0000${to.id}`, {
      from: from.id,
      to: to.id
    });
  }

  if (!semanticPairs.size) {
    return nodes.slice(1).map((node, index) => ({
      from: nodes[index].id,
      to: node.id
    }));
  }

  const edges = [...semanticPairs.values()];
  const incoming = new Set(edges.map((edge) => edge.to));
  const start = nodes[0].id;
  for (const node of nodes) {
    if (node.id === start || incoming.has(node.id)) {
      continue;
    }
    edges.push({ from: start, to: node.id });
  }

  return edges;
}
