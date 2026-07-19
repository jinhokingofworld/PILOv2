import ELK, {
  type ElkNode
} from "elkjs";

export type PrReviewCanvasRoutePoint = {
  x: number;
  y: number;
};

export type PrReviewCanvasLayoutFile = {
  roomFileId: string;
  flowId: string | null;
  width: number;
  height: number;
  flowSortOrder: number;
  workflowOrder: number;
  filePath: string;
  roleType:
    | "entry"
    | "core_logic"
    | "api_contract"
    | "ui_state"
    | "verification"
    | "support"
    | "unknown";
};

export type PrReviewCanvasLayoutRelation = {
  id: string;
  fromRoomFileId: string;
  toRoomFileId: string;
  isReviewOrder: boolean;
};

export type PrReviewCanvasGraphLayout = {
  nodeGeometryByRoomFileId: Map<string, { x: number; y: number }>;
  routePointsByRelationId: Map<string, PrReviewCanvasRoutePoint[]>;
};

type NodeGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  flowKey: string;
  columnIndex: number;
};

type RouteLane = {
  lastEndX: number;
  y: number;
};

const CANVAS_START_X = 160;
const CANVAS_START_Y = 160;
const FLOW_NODE_GAP_X = 184;
const FLOW_LANE_GAP_Y = 320;
const FLOW_LAYOUT_GAP_Y = 360;
const SAME_FLOW_ROUTE_OFFSET = 72;
const SAME_FLOW_ROUTE_GAP = 32;
const MAX_SAME_FLOW_ROUTE_LANES = 8;
const CROSS_FLOW_ROUTE_OFFSET = 52;
const CROSS_FLOW_GUTTER_OFFSET = 112;
const CROSS_FLOW_GUTTER_GAP = 40;

export async function buildPrReviewCanvasGraphLayout(input: {
  files: PrReviewCanvasLayoutFile[];
  relations: PrReviewCanvasLayoutRelation[];
}): Promise<PrReviewCanvasGraphLayout | null> {
  if (input.files.length === 0) {
    return null;
  }

  const files = [...input.files].sort(compareFiles);
  const { geometryByRoomFileId, routePointsByRelationId: flowRoutePoints } =
    await buildFlowGeometry(files, input.relations);
  const routePointsByRelationId = buildOrthogonalRoutes(
    files,
    input.relations,
    geometryByRoomFileId,
    flowRoutePoints
  );

  return {
    nodeGeometryByRoomFileId: new Map(
      [...geometryByRoomFileId].map(([roomFileId, geometry]) => [roomFileId, geometry])
    ),
    routePointsByRelationId
  };
}

async function buildFlowGeometry(
  files: PrReviewCanvasLayoutFile[],
  relations: PrReviewCanvasLayoutRelation[]
) {
  const filesByFlowKey = new Map<string, PrReviewCanvasLayoutFile[]>();
  for (const file of files) {
    const flowKey = getFlowKey(file);
    const members = filesByFlowKey.get(flowKey) ?? [];
    members.push(file);
    filesByFlowKey.set(flowKey, members);
  }

  const flows = [...filesByFlowKey.entries()].sort(([leftKey, leftFiles], [rightKey, rightFiles]) => {
    const left = leftFiles[0];
    const right = rightFiles[0];
    return (
      left.flowSortOrder - right.flowSortOrder ||
      left.filePath.localeCompare(right.filePath) ||
      leftKey.localeCompare(rightKey)
    );
  });
  const geometryByRoomFileId = new Map<string, NodeGeometry>();
  const routePointsByRelationId = new Map<string, PrReviewCanvasRoutePoint[]>();
  let nextFlowY = CANVAS_START_Y;

  for (const [flowKey, members] of flows) {
    const sortedMembers = [...members].sort(compareFilesInFlow);
    const memberIds = new Set(members.map((member) => member.roomFileId));
    const flowRelations = relations.filter(
      (relation) =>
        memberIds.has(relation.fromRoomFileId) &&
        memberIds.has(relation.toRoomFileId)
    );
    const layout = await buildElkFlowLayout(sortedMembers);
    const layoutChildren = layout.children ?? [];
    const layoutHeight = Math.max(
      ...layoutChildren.map((child) => (child.y ?? 0) + (child.height ?? 0)),
      ...sortedMembers.map((file) => file.height)
    );

    for (const [columnIndex, file] of sortedMembers.entries()) {
      const node = layoutChildren.find((child) => child.id === file.roomFileId);
      geometryByRoomFileId.set(file.roomFileId, {
        x: CANVAS_START_X + (node?.x ?? columnIndex * (file.width + FLOW_NODE_GAP_X)),
        y: nextFlowY + (node?.y ?? 0),
        width: file.width,
        height: file.height,
        flowKey,
        columnIndex
      });
    }

    const flowGeometryByRoomFileId = new Map(
      sortedMembers.map((member) => [
        member.roomFileId,
        geometryByRoomFileId.get(member.roomFileId)
      ]).filter((entry): entry is [string, NodeGeometry] => Boolean(entry[1]))
    );
    const { maxRouteY, routePointsByRelationId: sameFlowRoutes } =
      buildSameFlowRoutes(flowRelations, flowGeometryByRoomFileId);
    for (const [relationId, points] of sameFlowRoutes) {
      routePointsByRelationId.set(relationId, points);
    }

    nextFlowY = Math.max(nextFlowY + layoutHeight, maxRouteY) + FLOW_LAYOUT_GAP_Y;
  }

  return { geometryByRoomFileId, routePointsByRelationId };
}

async function buildElkFlowLayout(
  files: PrReviewCanvasLayoutFile[]
) {
  const elk = new ELK();
  const graph: ElkNode = {
    id: `flow:${getFlowKey(files[0])}`,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "72",
      "elk.layered.spacing.nodeNodeBetweenLayers": "184",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP"
    },
    children: files.map((file) => ({
      id: file.roomFileId,
      width: file.width,
      height: file.height
    })),
    edges: buildReviewOrderSpine(files)
  };

  return elk.layout(graph);
}

function buildReviewOrderSpine(files: readonly PrReviewCanvasLayoutFile[]) {
  return files.slice(1).map((file, index) => ({
    id: `layout-spine:${files[index].roomFileId}->${file.roomFileId}`,
    sources: [files[index].roomFileId],
    targets: [file.roomFileId]
  }));
}

function buildSameFlowRoutes(
  relations: PrReviewCanvasLayoutRelation[],
  geometryByRoomFileId: Map<string, NodeGeometry>
) {
  const flowGeometry = [...geometryByRoomFileId.values()];
  const flowBottom = Math.max(
    ...flowGeometry.map((geometry) => geometry.y + geometry.height)
  );
  const lanes: RouteLane[] = [];
  const routePointsByRelationId = new Map<string, PrReviewCanvasRoutePoint[]>();
  const relationsToRoute = relations
    .filter((relation) => {
      const from = geometryByRoomFileId.get(relation.fromRoomFileId);
      const to = geometryByRoomFileId.get(relation.toRoomFileId);
      if (!from || !to) {
        return false;
      }
      return !isAdjacentReviewOrder(relation, from, to);
    })
    .sort((left, right) =>
      compareSameFlowRouteRelations(left, right, geometryByRoomFileId)
    );

  for (const relation of relationsToRoute) {
    const from = geometryByRoomFileId.get(relation.fromRoomFileId);
    const to = geometryByRoomFileId.get(relation.toRoomFileId);
    if (!from || !to) {
      continue;
    }

    const startX = Math.min(getCenterX(from), getCenterX(to));
    const endX = Math.max(getCenterX(from), getCenterX(to));
    const laneY = assignBottomLane(startX, endX, flowBottom, lanes);
    routePointsByRelationId.set(
      relation.id,
      buildSameFlowRoute(from, to, laneY)
    );
  }

  return {
    maxRouteY: Math.max(flowBottom, ...lanes.map((lane) => lane.y)),
    routePointsByRelationId
  };
}

function assignBottomLane(
  startX: number,
  endX: number,
  flowBottom: number,
  lanes: RouteLane[]
) {
  const lane = lanes.find((candidate) => candidate.lastEndX < startX);
  if (lane) {
    lane.lastEndX = endX;
    return lane.y;
  }
  if (lanes.length >= MAX_SAME_FLOW_ROUTE_LANES) {
    const reused = [...lanes].sort(
      (left, right) => left.lastEndX - right.lastEndX || left.y - right.y
    )[0];
    reused.lastEndX = Math.max(reused.lastEndX, endX);
    return reused.y;
  }
  const y = flowBottom + SAME_FLOW_ROUTE_OFFSET + lanes.length * SAME_FLOW_ROUTE_GAP;
  lanes.push({ lastEndX: endX, y });
  return y;
}

function compareSameFlowRouteRelations(
  left: PrReviewCanvasLayoutRelation,
  right: PrReviewCanvasLayoutRelation,
  geometryByRoomFileId: Map<string, NodeGeometry>
) {
  const leftFrom = geometryByRoomFileId.get(left.fromRoomFileId);
  const leftTo = geometryByRoomFileId.get(left.toRoomFileId);
  const rightFrom = geometryByRoomFileId.get(right.fromRoomFileId);
  const rightTo = geometryByRoomFileId.get(right.toRoomFileId);
  if (!leftFrom || !leftTo || !rightFrom || !rightTo) {
    return compareRelations(left, right);
  }
  const leftStartX = Math.min(getCenterX(leftFrom), getCenterX(leftTo));
  const rightStartX = Math.min(getCenterX(rightFrom), getCenterX(rightTo));
  const leftEndX = Math.max(getCenterX(leftFrom), getCenterX(leftTo));
  const rightEndX = Math.max(getCenterX(rightFrom), getCenterX(rightTo));
  return (
    leftStartX - rightStartX ||
    leftEndX - rightEndX ||
    compareRelations(left, right)
  );
}

function buildOrthogonalRoutes(
  files: PrReviewCanvasLayoutFile[],
  relations: PrReviewCanvasLayoutRelation[],
  geometryByRoomFileId: Map<string, NodeGeometry>,
  flowRoutePoints: Map<string, PrReviewCanvasRoutePoint[]>
) {
  const fileIds = new Set(files.map((file) => file.roomFileId));
  const validRelations = relations
    .filter(
      (relation) =>
        relation.fromRoomFileId !== relation.toRoomFileId &&
        fileIds.has(relation.fromRoomFileId) &&
        fileIds.has(relation.toRoomFileId)
    )
    .sort(compareRelations);
  const routePointsByRelationId = new Map<string, PrReviewCanvasRoutePoint[]>();
  const maxNodeRight = Math.max(
    ...[...geometryByRoomFileId.values()].map((geometry) => geometry.x + geometry.width)
  );
  const minNodeLeft = Math.min(
    ...[...geometryByRoomFileId.values()].map((geometry) => geometry.x)
  );
  let crossFlowTrack = 0;

  for (const relation of validRelations) {
    const from = geometryByRoomFileId.get(relation.fromRoomFileId);
    const to = geometryByRoomFileId.get(relation.toRoomFileId);
    if (!from || !to) {
      continue;
    }

    const flowRoutePointsForRelation = flowRoutePoints.get(relation.id);
    if (flowRoutePointsForRelation) {
      routePointsByRelationId.set(relation.id, flowRoutePointsForRelation);
      continue;
    }

    if (isAdjacentReviewOrder(relation, from, to)) {
      routePointsByRelationId.set(relation.id, [
        { x: from.x + from.width, y: getCenterY(from) },
        { x: to.x, y: getCenterY(to) }
      ]);
      continue;
    }

    if (from.flowKey === to.flowKey) {
      routePointsByRelationId.set(
        relation.id,
        buildSameFlowRoute(
          from,
          to,
          Math.max(from.y + from.height, to.y + to.height) + SAME_FLOW_ROUTE_OFFSET
        )
      );
      continue;
    }

    routePointsByRelationId.set(
      relation.id,
      buildCrossFlowRoute(from, to, crossFlowTrack, minNodeLeft, maxNodeRight)
    );
    crossFlowTrack += 1;
  }

  return routePointsByRelationId;
}

function buildSameFlowRoute(from: NodeGeometry, to: NodeGeometry, trackY: number) {
  return deduplicateRoutePoints([
    { x: getCenterX(from), y: from.y + from.height },
    { x: getCenterX(from), y: trackY },
    { x: getCenterX(to), y: trackY },
    { x: getCenterX(to), y: to.y + to.height }
  ]);
}

function buildCrossFlowRoute(
  from: NodeGeometry,
  to: NodeGeometry,
  track: number,
  minNodeLeft: number,
  maxNodeRight: number
) {
  const movesDown = to.y > from.y;
  const sourceExitY = movesDown
    ? from.y + from.height + CROSS_FLOW_ROUTE_OFFSET
    : from.y - CROSS_FLOW_ROUTE_OFFSET;
  const targetEntryY = movesDown
    ? to.y - CROSS_FLOW_ROUTE_OFFSET
    : to.y + to.height + CROSS_FLOW_ROUTE_OFFSET;
  const useRightGutter = track % 2 === 0;
  const gutterOffset =
    CROSS_FLOW_GUTTER_OFFSET + Math.floor(track / 2) * CROSS_FLOW_GUTTER_GAP;
  const gutterX = useRightGutter
    ? maxNodeRight + gutterOffset
    : minNodeLeft - gutterOffset;
  const sourceY = movesDown ? from.y + from.height : from.y;
  const targetY = movesDown ? to.y : to.y + to.height;

  return deduplicateRoutePoints([
    { x: getCenterX(from), y: sourceY },
    { x: getCenterX(from), y: sourceExitY },
    { x: gutterX, y: sourceExitY },
    { x: gutterX, y: targetEntryY },
    { x: getCenterX(to), y: targetEntryY },
    { x: getCenterX(to), y: targetY }
  ]);
}

function isAdjacentReviewOrder(
  relation: PrReviewCanvasLayoutRelation,
  from: NodeGeometry,
  to: NodeGeometry
) {
  return (
    relation.isReviewOrder &&
    from.flowKey === to.flowKey &&
    to.columnIndex === from.columnIndex + 1
  );
}

function getFlowKey(file: PrReviewCanvasLayoutFile) {
  return file.flowId ?? `unassigned:${file.flowSortOrder}`;
}

function getFlowKeyByRoomFileId(
  files: PrReviewCanvasLayoutFile[],
  roomFileId: string
) {
  const file = files.find((candidate) => candidate.roomFileId === roomFileId);
  return file ? getFlowKey(file) : null;
}

function getCenterX(geometry: NodeGeometry) {
  return geometry.x + geometry.width / 2;
}

function getCenterY(geometry: NodeGeometry) {
  return geometry.y + geometry.height / 2;
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

function compareFilesInFlow(left: PrReviewCanvasLayoutFile, right: PrReviewCanvasLayoutFile) {
  return (
    left.workflowOrder - right.workflowOrder ||
    left.filePath.localeCompare(right.filePath) ||
    left.roomFileId.localeCompare(right.roomFileId)
  );
}

function compareRelations(
  left: PrReviewCanvasLayoutRelation,
  right: PrReviewCanvasLayoutRelation
) {
  return (
    Number(right.isReviewOrder) - Number(left.isReviewOrder) ||
    left.fromRoomFileId.localeCompare(right.fromRoomFileId) ||
    left.toRoomFileId.localeCompare(right.toRoomFileId) ||
    left.id.localeCompare(right.id)
  );
}
