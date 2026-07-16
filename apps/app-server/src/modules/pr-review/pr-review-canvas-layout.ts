import ELK, {
  type ElkExtendedEdge,
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

const CANVAS_START_X = 160;
const CANVAS_START_Y = 160;
const FLOW_NODE_GAP_X = 184;
const FLOW_LANE_GAP_Y = 320;
const FLOW_LAYOUT_GAP_Y = 360;
const SAME_FLOW_ROUTE_OFFSET = 72;
const SAME_FLOW_ROUTE_GAP = 32;
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
    const flowRelationIds = new Set(
      relations
        .filter(
          (relation) =>
            getFlowKeyByRoomFileId(members, relation.fromRoomFileId) === flowKey &&
            getFlowKeyByRoomFileId(members, relation.toRoomFileId) === flowKey
        )
        .map((relation) => relation.id)
    );
    const flowRelations = relations.filter((relation) => flowRelationIds.has(relation.id));
    const layout = await buildElkFlowLayout(sortedMembers, flowRelations);
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

    for (const edge of layout.edges ?? []) {
      const points = toRoutePoints(edge, CANVAS_START_X, nextFlowY);
      if (points.length >= 2) {
        routePointsByRelationId.set(edge.id, points);
      }
    }

    nextFlowY += layoutHeight + FLOW_LAYOUT_GAP_Y;
  }

  return { geometryByRoomFileId, routePointsByRelationId };
}

async function buildElkFlowLayout(
  files: PrReviewCanvasLayoutFile[],
  relations: PrReviewCanvasLayoutRelation[]
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
      height: file.height,
      layoutOptions: getRoleLayoutOptions(file)
    })),
    edges: relations.map((relation) => ({
      id: relation.id,
      sources: [relation.fromRoomFileId],
      targets: [relation.toRoomFileId]
    }))
  };

  return elk.layout(graph);
}

function getRoleLayoutOptions(file: PrReviewCanvasLayoutFile) {
  if (file.roleType === "entry") {
    return { "elk.layered.layering.layerConstraint": "FIRST" };
  }
  if (file.roleType === "verification") {
    return { "elk.layered.layering.layerConstraint": "LAST" };
  }
  return undefined;
}

function toRoutePoints(edge: ElkExtendedEdge, offsetX: number, offsetY: number) {
  const section = edge.sections?.[0];
  if (!section) {
    return [];
  }

  return deduplicateRoutePoints([
    { x: offsetX + section.startPoint.x, y: offsetY + section.startPoint.y },
    ...(section.bendPoints ?? []).map((point) => ({
      x: offsetX + point.x,
      y: offsetY + point.y
    })),
    { x: offsetX + section.endPoint.x, y: offsetY + section.endPoint.y }
  ]);
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
  const sameFlowTrackByFlowKey = new Map<string, number>();
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
      const track = sameFlowTrackByFlowKey.get(from.flowKey) ?? 0;
      sameFlowTrackByFlowKey.set(from.flowKey, track + 1);
      routePointsByRelationId.set(
        relation.id,
        buildSameFlowRoute(from, to, track)
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

function buildSameFlowRoute(from: NodeGeometry, to: NodeGeometry, track: number) {
  const trackY = Math.min(from.y, to.y) - SAME_FLOW_ROUTE_OFFSET - track * SAME_FLOW_ROUTE_GAP;
  return deduplicateRoutePoints([
    { x: getCenterX(from), y: from.y },
    { x: getCenterX(from), y: trackY },
    { x: getCenterX(to), y: trackY },
    { x: getCenterX(to), y: to.y }
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
    getRolePriority(left.roleType) - getRolePriority(right.roleType) ||
    left.workflowOrder - right.workflowOrder ||
    left.filePath.localeCompare(right.filePath) ||
    left.roomFileId.localeCompare(right.roomFileId)
  );
}

function getRolePriority(roleType: PrReviewCanvasLayoutFile["roleType"]) {
  switch (roleType) {
    case "entry":
      return 0;
    case "core_logic":
      return 1;
    case "ui_state":
      return 2;
    case "api_contract":
      return 3;
    case "support":
      return 4;
    case "verification":
      return 5;
    case "unknown":
      return 6;
  }
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
