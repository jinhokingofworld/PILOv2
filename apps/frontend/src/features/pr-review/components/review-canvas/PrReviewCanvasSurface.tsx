"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject
} from "react";
import {
  createShapeId,
  getIndexAbove,
  getIndicesAbove,
  useEditor,
  type Editor,
  type TLEventInfo,
  type TLShape,
  type TLShapeId,
  type TLShapePartial
} from "tldraw";
import { useValue } from "@tldraw/state-react";
import {
  ChevronDown,
  Filter,
  LayoutPanelTop,
  RotateCcw
} from "lucide-react";

import { TldrawSurface } from "@/shared/tldraw/TldrawSurface";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { PrReviewWorkspaceLocationAdapter } from "@/features/pr-review/pr-review-workspace-location-adapter";
import type {
  CanvasRealtimeConfig,
  CanvasRealtimeIdentity,
  CanvasShapeOperationPayload
} from "@/shared/canvas-realtime/canvas-realtime-types";
import type {
  PrReviewCanvas,
  PrReviewCanvasShape,
  PrReviewCanvasFlow,
  PrReviewConflictAnalysis,
  PrReviewDecisionUpdatedEvent,
  PrReviewFlowFile,
  PrReviewRoomCanvas
} from "@/features/pr-review/types";
import {
  PrReviewApiError,
  type createPrReviewApiClient
} from "@/features/pr-review/api/client";
import { PrReviewCanvasBackground } from "@/features/pr-review/components/review-canvas/PrReviewCanvasBackground";
import { PrReviewCanvasRealtimeBridge } from "@/features/pr-review/components/review-canvas/PrReviewCanvasRealtimeBridge";
import { usePrReviewCanvasPresence } from "@/features/pr-review/realtime/usePrReviewCanvasPresence";
import {
  PR_REVIEW_FILE_NODE_SHAPE_TYPE,
  PR_REVIEW_FLOW_EDGE_SHAPE_TYPE,
  PR_REVIEW_FLOW_LABEL_SHAPE_TYPE,
  PR_REVIEW_FLOW_MILESTONE_SHAPE_TYPE,
  PR_REVIEW_ROLE_LANE_SHAPE_TYPE,
  PR_REVIEW_RELATION_EDGE_SHAPE_TYPE,
  isPrReviewFileNodeShape,
  type PrReviewFileNodeShape,
  type PrReviewFlowEdgeShape,
  type PrReviewFlowLabelShape,
  type PrReviewFlowMilestoneShape,
  type PrReviewRelationEdgeShape,
  type PrReviewRoleLaneShape
} from "@/features/pr-review/components/review-canvas/PrReviewFileNodeShapeUtil";
import { prReviewShapeUtils } from "@/features/pr-review/components/review-canvas/pr-review-shape-utils";
import { resolvePrReviewCanvasShapeIndexes } from "@/features/pr-review/components/review-canvas/pr-review-canvas-index";
import {
  buildPrReviewFileColumnMap,
  buildPrReviewRoleLanes,
  sortPrReviewFlowFiles,
  type PrReviewRoleLane
} from "@/features/pr-review/components/review-canvas/pr-review-flow-layout";
import {
  PR_REVIEW_CANVAS_LOAD_QUERY,
  applyPrReviewFileShapeUpdate,
  buildPrReviewFileShapeUpdateInput,
  buildPrReviewRelationEdgeGeometry,
  getPrReviewFileShapeGeometryKey,
  isPrReviewCanvasFileShape,
  isPrReviewCanvasSystemShape,
  readPrReviewCanvasOperationShape,
  type PrReviewCanvasFileShapeSnapshot
} from "@/features/pr-review/components/review-canvas/pr-review-canvas-persistence";
import {
  registerPrReviewFileNodeActivationHandler
} from "@/features/pr-review/components/review-canvas/pr-review-node-activation";
import { shouldRemoveCreatedPrReviewSystemShape } from "@/features/pr-review/components/review-canvas/pr-review-system-shape-policy";
import {
  buildPrReviewGraphPresentation,
  createPrReviewFlowLayout,
  type PrReviewGraphFilter,
  type PrReviewGraphNode,
  type PrReviewGraphRelation
} from "@/features/pr-review/components/review-canvas/pr-review-graph-exploration";

type PrReviewApiClient = ReturnType<typeof createPrReviewApiClient>;

type PrReviewCanvasSurfaceProps = {
  apiClient: PrReviewApiClient;
  canvas: PrReviewCanvas;
  className?: string;
  conflictAnalysis?: PrReviewConflictAnalysis | null;
  onDecisionUpdated?: (event: PrReviewDecisionUpdatedEvent) => void;
  onFileSelect?: (reviewFileId: string | null) => void;
  onRealtimeRoomJoined?: () => void;
  preparedConflictFileIds?: Set<string>;
  readOnly?: boolean;
  realtimeIdentity: CanvasRealtimeIdentity;
  reviewRoomId: string;
  selectedReviewFileId?: string | null;
  workspaceId: string;
};

type NodePlacement = {
  flowId: string;
  reviewFileId: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type Connector = {
  id: string;
  flowId: string;
  fromId: string;
  toId: string;
  reason: string;
  kind: "review_order" | "semantic";
};

type FileConflictNodeMetadata = {
  conflictReason: string | null;
  conflictState: "none" | "unresolved" | "ready" | "unsupported";
};

const START_NODE_ID = "__start";
const END_NODE_ID = "__end";
const NODE_WIDTH = 272;
const NODE_HEIGHT = 116;
const MILESTONE_WIDTH = 164;
const MILESTONE_HEIGHT = 68;
const FLOW_LABEL_MIN_WIDTH = 720;
const FLOW_LABEL_HEIGHT = 112;
const CANVAS_PADDING_X = 72;
const CANVAS_PADDING_Y = 56;
const MILESTONE_GAP = 52;
const LANE_LABEL_WIDTH = 148;
const LANE_LABEL_GAP = 28;
const FILE_COLUMN_GAP = 72;
const END_MILESTONE_GAP = 56;
const ROLE_LANE_HEIGHT = 156;
const ROLE_LANE_GAP = 18;
const FLOW_HEADER_GAP = 28;
const FLOW_GAP = 112;
const FILE_SHAPE_SAVE_DEBOUNCE_MS = 500;
const OPERATION_SYNC_ERROR_MESSAGE =
  "실시간 노드 동기화가 지연되고 있습니다. 재접속하면 최신 위치를 다시 불러옵니다.";

const prReviewTldrawComponents = {
  Background: PrReviewCanvasBackground,
  ContextMenu: null
};

const prReviewShapeTypes = new Set<string>([
  PR_REVIEW_FILE_NODE_SHAPE_TYPE,
  PR_REVIEW_FLOW_EDGE_SHAPE_TYPE,
  PR_REVIEW_RELATION_EDGE_SHAPE_TYPE,
  PR_REVIEW_FLOW_LABEL_SHAPE_TYPE,
  PR_REVIEW_FLOW_MILESTONE_SHAPE_TYPE,
  PR_REVIEW_ROLE_LANE_SHAPE_TYPE
]);

function shapeIdSuffix(value: string) {
  const suffix = value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 92);

  return suffix || "item";
}

function sortFlows(flows: PrReviewCanvas["flows"]) {
  return [...flows].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
  );
}

function getPlacementKey(flowId: string, nodeId: string) {
  return `${flowId}:${nodeId}`;
}

function createFileNodeShape(
  file: PrReviewFlowFile,
  placement: NodePlacement,
  conflictMetadata: FileConflictNodeMetadata
): TLShapePartial<PrReviewFileNodeShape> {
  const fileNodeData = file.fileNodeData;

  return {
    id: createShapeId(
      `pr-review-file-${shapeIdSuffix(file.flowId)}-${shapeIdSuffix(
        file.reviewFileId
      )}`
    ),
    type: PR_REVIEW_FILE_NODE_SHAPE_TYPE,
    x: placement.x,
    y: placement.y,
    props: {
      w: placement.w,
      h: placement.h,
      reviewRoomId: null,
      roomFileId: null,
      currentReviewSessionId: null,
      reviewFileId: fileNodeData.reviewFileId,
      reviewSessionId: fileNodeData.reviewSessionId,
      reviewFlowFileId: fileNodeData.reviewFlowFileId,
      flowId: fileNodeData.flowId,
      workflowOrder: fileNodeData.workflowOrder,
      fileName: fileNodeData.fileName,
      filePath: fileNodeData.filePath,
      fileStatus: file.fileStatus,
      roleSummary: fileNodeData.roleSummary,
      roleType: fileNodeData.roleType,
      riskLevel: fileNodeData.riskLevel,
      reviewStatus: fileNodeData.reviewStatus,
      conflictState: conflictMetadata.conflictState,
      conflictReason: conflictMetadata.conflictReason,
      pinned: false
    }
  };
}

function createConflictMetadataResolver(
  analysis: PrReviewConflictAnalysis | null | undefined,
  preparedConflictFileIds: Set<string>
) {
  const contentConflictByFileId = new Map(
    (analysis?.files ?? []).map((file) => [file.reviewFileId, file])
  );
  const unsupportedConflictByFileId = new Map(
    (analysis?.unsupportedFiles ?? []).map((file) => [file.reviewFileId, file])
  );

  return (reviewFileId: string): FileConflictNodeMetadata => {
    const contentConflict = contentConflictByFileId.get(reviewFileId);
    if (contentConflict) {
      const ready = preparedConflictFileIds.has(reviewFileId);
      return {
        conflictReason: ready
          ? "해결안이 준비되어 전체 적용을 기다리고 있습니다."
          : "충돌 해결 전에는 일반 판단을 저장할 수 없습니다.",
        conflictState: ready ? "ready" : "unresolved"
      };
    }

    const unsupportedConflict = unsupportedConflictByFileId.get(reviewFileId);
    if (unsupportedConflict) {
      return {
        conflictReason: unsupportedConflict.reason,
        conflictState: "unsupported"
      };
    }

    return {
      conflictReason: null,
      conflictState: "none"
    };
  };
}

function createFlowLabelShape(
  flow: PrReviewCanvasFlow,
  y: number,
  width: number
): TLShapePartial<PrReviewFlowLabelShape> {
  return {
    id: createShapeId(`pr-review-flow-${shapeIdSuffix(flow.id)}`),
    type: PR_REVIEW_FLOW_LABEL_SHAPE_TYPE,
    x: CANVAS_PADDING_X,
    y,
    props: {
      w: width,
      h: FLOW_LABEL_HEIGHT,
      flowId: flow.id,
      title: flow.title,
      description: flow.description,
      sortOrder: flow.sortOrder,
      fileCount: flow.fileCount
    }
  };
}

function createRoleLaneShape(
  flowId: string,
  lane: PrReviewRoleLane,
  x: number,
  y: number,
  width: number
): TLShapePartial<PrReviewRoleLaneShape> {
  return {
    id: createShapeId(
      `pr-review-lane-${shapeIdSuffix(flowId)}-${lane.roleType}`
    ),
    type: PR_REVIEW_ROLE_LANE_SHAPE_TYPE,
    x,
    y,
    props: {
      w: width,
      h: ROLE_LANE_HEIGHT,
      flowId,
      roleType: lane.roleType,
      label: lane.label,
      description: lane.description,
      fileCount: lane.files.length,
      labelWidth: LANE_LABEL_WIDTH
    }
  };
}

function createMilestoneShape(
  flow: PrReviewCanvasFlow,
  placement: NodePlacement,
  kind: "start" | "end"
): TLShapePartial<PrReviewFlowMilestoneShape> {
  return {
    id: createShapeId(
      `pr-review-${kind}-${shapeIdSuffix(flow.id)}-${shapeIdSuffix(
        placement.reviewFileId
      )}`
    ),
    type: PR_REVIEW_FLOW_MILESTONE_SHAPE_TYPE,
    x: placement.x,
    y: placement.y,
    props: {
      w: placement.w,
      h: placement.h,
      flowId: flow.id,
      kind,
      label: kind === "start" ? "PR 시작" : "Review 제출",
      description: kind === "start" ? "리뷰 흐름 진입" : "최종 판단"
    }
  };
}

function getAnchors(from: NodePlacement, to: NodePlacement) {
  const fromCenterX = from.x + from.w / 2;
  const fromCenterY = from.y + from.h / 2;
  const toCenterX = to.x + to.w / 2;
  const toCenterY = to.y + to.h / 2;
  const dx = toCenterX - fromCenterX;
  const dy = toCenterY - fromCenterY;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      startX: dx >= 0 ? from.x + from.w : from.x,
      startY: fromCenterY,
      endX: dx >= 0 ? to.x : to.x + to.w,
      endY: toCenterY
    };
  }

  return {
    startX: fromCenterX,
    startY: dy >= 0 ? from.y + from.h : from.y,
    endX: toCenterX,
    endY: dy >= 0 ? to.y : to.y + to.h
  };
}

function createConnectorShape(
  connector: Connector,
  placementByKey: Map<string, NodePlacement>
): TLShapePartial<PrReviewFlowEdgeShape> | null {
  const from = placementByKey.get(
    getPlacementKey(connector.flowId, connector.fromId)
  );
  const to = placementByKey.get(getPlacementKey(connector.flowId, connector.toId));

  if (!from || !to) {
    return null;
  }

  const anchors = getAnchors(from, to);
  const x = Math.min(anchors.startX, anchors.endX);
  const y = Math.min(anchors.startY, anchors.endY);
  const w = Math.max(1, Math.abs(anchors.endX - anchors.startX));
  const h = Math.max(1, Math.abs(anchors.endY - anchors.startY));

  return {
    id: createShapeId(
      `pr-review-edge-${shapeIdSuffix(connector.flowId)}-${shapeIdSuffix(
        connector.id
      )}`
    ),
    type: PR_REVIEW_FLOW_EDGE_SHAPE_TYPE,
    x,
    y,
    props: {
      w,
      h,
      startX: anchors.startX - x,
      startY: anchors.startY - y,
      endX: anchors.endX - x,
      endY: anchors.endY - y,
      fromReviewFileId: connector.fromId,
      toReviewFileId: connector.toId,
      flowId: connector.flowId,
      reason: connector.reason,
      kind: connector.kind
    }
  };
}

function buildFlowConnectors(
  flow: PrReviewCanvasFlow,
  files: PrReviewFlowFile[],
  canvasEdges: PrReviewCanvas["edges"]
): Connector[] {
  if (files.length === 0) {
    return [
      {
        id: "start-end",
        flowId: flow.id,
        fromId: START_NODE_ID,
        toId: END_NODE_ID,
        reason: "리뷰 흐름",
        kind: "review_order"
      }
    ];
  }

  const connectors: Connector[] = [
    {
      id: `start-${files[0].reviewFileId}`,
      flowId: flow.id,
      fromId: START_NODE_ID,
      toId: files[0].reviewFileId,
      reason: "리뷰 시작",
      kind: "review_order"
    }
  ];

  for (let index = 0; index < files.length - 1; index += 1) {
    connectors.push({
      id: `order-${files[index].reviewFileId}-${files[index + 1].reviewFileId}`,
      flowId: flow.id,
      fromId: files[index].reviewFileId,
      toId: files[index + 1].reviewFileId,
      reason: "추천 리뷰 경로",
      kind: "review_order"
    });
  }

  connectors.push(
    ...canvasEdges
      .filter(
        (edge) =>
          edge.flowId === flow.id && edge.relationType !== "review_order"
      )
      .map((edge) => ({
        id: `semantic-${edge.id}`,
        flowId: flow.id,
        fromId: edge.fromReviewFileId,
        toId: edge.toReviewFileId,
        reason: edge.reason,
        kind: "semantic" as const
      }))
  );

  connectors.push({
    id: `${files[files.length - 1].reviewFileId}-end`,
    flowId: flow.id,
    fromId: files[files.length - 1].reviewFileId,
    toId: END_NODE_ID,
    reason: "최종 판단",
    kind: "review_order"
  });

  return connectors;
}

function buildPrReviewCanvasShapes(
  canvas: PrReviewCanvas,
  conflictAnalysis: PrReviewConflictAnalysis | null | undefined,
  preparedConflictFileIds: Set<string>
): TLShapePartial[] {
  const backgroundShapes: TLShapePartial[] = [];
  const foregroundShapes: TLShapePartial[] = [];
  const placementByKey = new Map<string, NodePlacement>();
  const getConflictMetadata = createConflictMetadataResolver(
    conflictAnalysis,
    preparedConflictFileIds
  );
  const connectors: Connector[] = [];
  let nextFlowY = CANVAS_PADDING_Y;

  for (const flow of sortFlows(canvas.flows)) {
    const files = sortPrReviewFlowFiles(flow.files);
    const lanes = buildPrReviewRoleLanes(files);
    const fileColumnById = buildPrReviewFileColumnMap(files);
    const contentHeight = Math.max(
      MILESTONE_HEIGHT,
      lanes.length * ROLE_LANE_HEIGHT +
        Math.max(0, lanes.length - 1) * ROLE_LANE_GAP
    );
    const contentTop = nextFlowY + FLOW_LABEL_HEIGHT + FLOW_HEADER_GAP;
    const contentCenterY = contentTop + contentHeight / 2;
    const laneX = CANVAS_PADDING_X + MILESTONE_WIDTH + MILESTONE_GAP;
    const firstFileX = laneX + LANE_LABEL_WIDTH + LANE_LABEL_GAP;
    const fileColumnStep = NODE_WIDTH + FILE_COLUMN_GAP;
    const endX =
      files.length > 0
        ? firstFileX + files.length * fileColumnStep + END_MILESTONE_GAP
        : laneX + LANE_LABEL_WIDTH + LANE_LABEL_GAP;
    const flowWidth = Math.max(
      FLOW_LABEL_MIN_WIDTH,
      endX + MILESTONE_WIDTH - CANVAS_PADDING_X
    );
    const laneWidth = endX + MILESTONE_WIDTH - laneX;

    foregroundShapes.push(createFlowLabelShape(flow, nextFlowY, flowWidth));
    const startPlacement: NodePlacement = {
      flowId: flow.id,
      reviewFileId: START_NODE_ID,
      x: CANVAS_PADDING_X,
      y: contentCenterY - MILESTONE_HEIGHT / 2,
      w: MILESTONE_WIDTH,
      h: MILESTONE_HEIGHT
    };

    placementByKey.set(getPlacementKey(flow.id, START_NODE_ID), startPlacement);
    foregroundShapes.push(createMilestoneShape(flow, startPlacement, "start"));

    lanes.forEach((lane, laneIndex) => {
      const laneY = contentTop + laneIndex * (ROLE_LANE_HEIGHT + ROLE_LANE_GAP);
      backgroundShapes.push(
        createRoleLaneShape(flow.id, lane, laneX, laneY, laneWidth)
      );

      lane.files.forEach((file) => {
        const columnIndex = fileColumnById.get(file.reviewFileId) ?? 0;
        const placement: NodePlacement = {
          flowId: flow.id,
          reviewFileId: file.reviewFileId,
          x: firstFileX + columnIndex * fileColumnStep,
          y: laneY + (ROLE_LANE_HEIGHT - NODE_HEIGHT) / 2,
          w: NODE_WIDTH,
          h: NODE_HEIGHT
        };

        placementByKey.set(
          getPlacementKey(flow.id, file.reviewFileId),
          placement
        );
        foregroundShapes.push(
          createFileNodeShape(
            file,
            placement,
            getConflictMetadata(file.reviewFileId)
          )
        );
      });
    });

    const endPlacement: NodePlacement = {
      flowId: flow.id,
      reviewFileId: END_NODE_ID,
      x: endX,
      y: contentCenterY - MILESTONE_HEIGHT / 2,
      w: MILESTONE_WIDTH,
      h: MILESTONE_HEIGHT
    };

    placementByKey.set(getPlacementKey(flow.id, END_NODE_ID), endPlacement);
    foregroundShapes.push(createMilestoneShape(flow, endPlacement, "end"));
    connectors.push(...buildFlowConnectors(flow, files, canvas.edges));

    nextFlowY +=
      FLOW_LABEL_HEIGHT + FLOW_HEADER_GAP + contentHeight + FLOW_GAP;
  }

  const edgeShapes = connectors
    .map((connector) => createConnectorShape(connector, placementByKey))
    .filter((shape): shape is TLShapePartial<PrReviewFlowEdgeShape> =>
      Boolean(shape)
    );

  return [...backgroundShapes, ...edgeShapes, ...foregroundShapes];
}

function buildStoredPrReviewCanvasShapes(
  storedShapes: PrReviewCanvasShape[],
  canvas: PrReviewCanvas
): TLShapePartial[] {
  const roleTypeByReviewFileId = new Map(
    canvas.flows.flatMap((flow) =>
      flow.files.map((file) => [file.reviewFileId, file.roleType] as const)
    )
  );
  const systemShapes = collapseStoredSemanticRelationShapes(
    storedShapes.filter(
      (shape) =>
        isPrReviewCanvasSystemShape(shape) && isRecord(shape.rawShape.props)
    )
  );
  const indexes = resolvePrReviewCanvasShapeIndexes(
    systemShapes.map((shape) => shape.rawShape.index),
    {
      createIndexes: (count) => getIndicesAbove(null, count),
      isValidIndex: isValidPrReviewCanvasIndex
    }
  );

  const persistedShapes = systemShapes.map((shape, shapeIndex) => {
    const props = { ...(shape.rawShape.props as Record<string, unknown>) };
    if (
      shape.shapeType === PR_REVIEW_FILE_NODE_SHAPE_TYPE &&
      typeof props.roleType !== "string"
    ) {
      props.roleType =
        typeof props.reviewFileId === "string"
          ? (roleTypeByReviewFileId.get(props.reviewFileId) ?? "unknown")
          : "unknown";
    }
    if (
      shape.shapeType === PR_REVIEW_FILE_NODE_SHAPE_TYPE &&
      typeof props.pinned !== "boolean"
    ) {
      props.pinned = false;
    }
    if (
      shape.shapeType === PR_REVIEW_RELATION_EDGE_SHAPE_TYPE &&
      !Array.isArray(props.routePoints)
    ) {
      props.routePoints = [];
    }
    const partial: TLShapePartial = {
      id: shape.id as TLShapeId,
      type: shape.shapeType,
      x: shape.x,
      y: shape.y,
      rotation: shape.rotation,
      index: indexes[shapeIndex] as TLShape["index"],
      props
    } as TLShapePartial;

    if (shape.parentShapeId?.startsWith("shape:")) {
      partial.parentId = shape.parentShapeId as TLShapeId;
    }

    return partial;
  });

  return [
    ...buildStoredFlowLabelShapes(canvas, systemShapes),
    ...persistedShapes
  ];
}

function buildStoredFlowLabelShapes(
  canvas: PrReviewCanvas,
  storedShapes: PrReviewCanvasShape[]
): TLShapePartial<PrReviewFlowLabelShape>[] {
  const fileShapeByReviewFileId = new Map(
    storedShapes.flatMap((shape) => {
      if (
        shape.shapeType !== PR_REVIEW_FILE_NODE_SHAPE_TYPE ||
        !isRecord(shape.rawShape.props) ||
        typeof shape.rawShape.props.reviewFileId !== "string"
      ) {
        return [];
      }
      return [[shape.rawShape.props.reviewFileId, shape] as const];
    })
  );

  return sortFlows(canvas.flows).flatMap((flow) => {
    const fileShapes = flow.files.flatMap((file) => {
      const shape = fileShapeByReviewFileId.get(file.reviewFileId);
      return shape ? [shape] : [];
    });
    if (!fileShapes.length) {
      return [];
    }

    const left = Math.min(...fileShapes.map((shape) => shape.x));
    const top = Math.min(...fileShapes.map((shape) => shape.y));
    const right = Math.max(
      ...fileShapes.map((shape) => shape.x + (shape.width ?? NODE_WIDTH))
    );
    return [
      createFlowLabelShape(
        flow,
        Math.max(CANVAS_PADDING_Y, top - FLOW_LABEL_HEIGHT - FLOW_HEADER_GAP),
        Math.max(FLOW_LABEL_MIN_WIDTH, right - left)
      )
    ].map((shape) => ({ ...shape, x: left }));
  });
}

function collapseStoredSemanticRelationShapes(
  systemShapes: PrReviewCanvasShape[]
): PrReviewCanvasShape[] {
  const groups = new Map<string, PrReviewCanvasShape[]>();

  for (const shape of systemShapes) {
    const props = shape.rawShape.props;
    if (
      shape.shapeType !== PR_REVIEW_RELATION_EDGE_SHAPE_TYPE ||
      !isRecord(props) ||
      props.kind !== "semantic" ||
      typeof props.flowId !== "string" ||
      typeof props.fromRoomFileId !== "string" ||
      typeof props.toRoomFileId !== "string"
    ) {
      continue;
    }

    const key = [props.flowId, props.fromRoomFileId, props.toRoomFileId].join(
      "\u0000"
    );
    const group = groups.get(key) ?? [];
    group.push(shape);
    groups.set(key, group);
  }

  const firstShapeIds = new Set(
    Array.from(groups.values()).map((group) => group[0]?.id).filter(Boolean)
  );

  return systemShapes.flatMap((shape) => {
    if (!firstShapeIds.has(shape.id)) {
      const props = shape.rawShape.props;
      if (
        shape.shapeType === PR_REVIEW_RELATION_EDGE_SHAPE_TYPE &&
        isRecord(props) &&
        props.kind === "semantic"
      ) {
        return [];
      }
      return [shape];
    }

    const props = shape.rawShape.props;
    if (!isRecord(props)) {
      return [shape];
    }
    const key = [props.flowId, props.fromRoomFileId, props.toRoomFileId].join(
      "\u0000"
    );
    const group = groups.get(key) ?? [shape];
    const details = group
      .map((candidate) => toStoredRelationDetail(candidate.rawShape.props))
      .filter((detail): detail is PrReviewRelationEdgeShape["props"]["relationDetails"][number] =>
        detail !== null
      )
      .sort((left, right) => right.confidence - left.confidence);
    const primary = details[0];

    if (!primary) {
      return [shape];
    }

    return [
      {
        ...shape,
        rawShape: {
          ...shape.rawShape,
          props: {
            ...props,
            relationType: primary.relationType,
            source: primary.source,
            confidence: primary.confidence,
            reason: primary.reason,
            relationCount: details.length,
            relationDetails: details
          }
        }
      }
    ];
  });
}

function toStoredRelationDetail(
  rawProps: unknown
): PrReviewRelationEdgeShape["props"]["relationDetails"][number] | null {
  if (!isRecord(rawProps)) {
    return null;
  }
  const { relationType, source, confidence, reason } = rawProps;
  if (
    !isPrReviewRelationType(relationType) ||
    !isPrReviewRelationSource(source) ||
    typeof confidence !== "number" ||
    typeof reason !== "string"
  ) {
    return null;
  }
  return { relationType, source, confidence, reason };
}

function isPrReviewRelationType(
  value: unknown
): value is PrReviewRelationEdgeShape["props"]["relationType"] {
  return (
    value === "review_order" ||
    value === "depends_on" ||
    value === "tests" ||
    value === "uses_api" ||
    value === "passes_data_to" ||
    value === "supports"
  );
}

function isPrReviewRelationSource(
  value: unknown
): value is PrReviewRelationEdgeShape["props"]["source"] {
  return (
    value === "rule" ||
    value === "ai" ||
    value === "hybrid" ||
    value === "fallback"
  );
}

function isValidPrReviewCanvasIndex(index: string): boolean {
  try {
    getIndexAbove(index as TLShape["index"]);
    return true;
  } catch {
    return false;
  }
}

function isPrReviewRelationEdgeShape(
  shape: TLShape | null | undefined
): shape is PrReviewRelationEdgeShape {
  return shape?.type === PR_REVIEW_RELATION_EDGE_SHAPE_TYPE;
}

function getRelationTypes(shape: PrReviewRelationEdgeShape): string[] {
  const details = shape.props.relationDetails;
  if (details.length) {
    return Array.from(new Set(details.map((detail) => detail.relationType)));
  }

  return [shape.props.relationType];
}

function getGraphNodes(editor: Editor): PrReviewGraphNode[] {
  return editor.getCurrentPageShapes().flatMap((shape) => {
    if (!isPrReviewFileNodeShape(shape)) {
      return [];
    }

    return [
      {
        id: shape.id,
        flowId: shape.props.flowId,
        roomFileId: shape.props.roomFileId,
        x: shape.x,
        y: shape.y,
        width: shape.props.w,
        height: shape.props.h,
        riskLevel: shape.props.riskLevel,
        reviewStatus: shape.props.reviewStatus,
        pinned: shape.props.pinned
      }
    ];
  });
}

function getGraphRelations(editor: Editor): PrReviewGraphRelation[] {
  return editor.getCurrentPageShapes().flatMap((shape) => {
    if (!isPrReviewRelationEdgeShape(shape)) {
      return [];
    }

    return [
      {
        id: shape.id,
        fromRoomFileId: shape.props.fromRoomFileId,
        toRoomFileId: shape.props.toRoomFileId,
        relationTypes: getRelationTypes(shape)
      }
    ];
  });
}

function toPrReviewFileShapeSnapshot(
  shape: PrReviewFileNodeShape
): PrReviewCanvasFileShapeSnapshot {
  return {
    id: shape.id,
    parentId: shape.parentId,
    x: shape.x,
    y: shape.y,
    index: shape.index,
    props: {
      w: shape.props.w,
      h: shape.props.h,
      pinned: shape.props.pinned
    }
  };
}

function syncPrReviewFileNodeMetadata(
  editor: Editor,
  canvas: PrReviewCanvas,
  conflictAnalysis: PrReviewConflictAnalysis | null | undefined,
  preparedConflictFileIds: Set<string>,
  internalShapeUpdateRef: MutableRefObject<boolean>
) {
  const fileByReviewFileId = new Map(
    canvas.flows.flatMap((flow) =>
      flow.files.map((file) => [file.reviewFileId, file] as const)
    )
  );
  const fileByPath = new Map(
    canvas.flows.flatMap((flow) =>
      flow.files.map((file) => [file.filePath, file] as const)
    )
  );
  const getConflictMetadata = createConflictMetadataResolver(
    conflictAnalysis,
    preparedConflictFileIds
  );
  const updates = editor.getCurrentPageShapes().flatMap((shape) => {
    if (!isPrReviewFileNodeShape(shape)) {
      return [];
    }

    const file =
      fileByReviewFileId.get(shape.props.reviewFileId) ??
      (shape.props.filePath
        ? fileByPath.get(shape.props.filePath)
        : undefined);
    if (!file) {
      return [];
    }

    const conflictMetadata = getConflictMetadata(file.reviewFileId);
    return [
      {
        id: shape.id,
        type: PR_REVIEW_FILE_NODE_SHAPE_TYPE,
        props: {
          ...shape.props,
          reviewFileId: file.fileNodeData.reviewFileId,
          reviewSessionId: file.fileNodeData.reviewSessionId,
          reviewFlowFileId: file.fileNodeData.reviewFlowFileId,
          flowId: file.fileNodeData.flowId,
          workflowOrder: file.fileNodeData.workflowOrder,
          fileName: file.fileNodeData.fileName,
          filePath: file.fileNodeData.filePath,
          fileStatus: file.fileStatus,
          roleSummary: file.fileNodeData.roleSummary,
          roleType: file.fileNodeData.roleType,
          riskLevel: file.fileNodeData.riskLevel,
          reviewStatus: file.fileNodeData.reviewStatus,
          conflictState: conflictMetadata.conflictState,
          conflictReason: conflictMetadata.conflictReason,
          pinned: shape.props.pinned
        }
      } satisfies TLShapePartial<PrReviewFileNodeShape>
    ];
  });

  if (!updates.length) {
    return;
  }

  internalShapeUpdateRef.current = true;
  try {
    editor.updateShapes(updates);
  } finally {
    internalShapeUpdateRef.current = false;
  }
}

function updatePrReviewRelationGeometry(
  editor: Editor,
  internalShapeUpdateRef: MutableRefObject<boolean>,
  preserveStoredRoutes = false
) {
  const fileByRoomFileId = new Map(
    editor
      .getCurrentPageShapes()
      .filter(isPrReviewFileNodeShape)
      .flatMap((shape) =>
        shape.props.roomFileId ? [[shape.props.roomFileId, shape] as const] : []
      )
  );
  const updates = editor.getCurrentPageShapes().flatMap((shape) => {
    if (!isPrReviewRelationEdgeShape(shape)) {
      return [];
    }

    const from = fileByRoomFileId.get(shape.props.fromRoomFileId);
    const to = fileByRoomFileId.get(shape.props.toRoomFileId);
    if (!from || !to) {
      return [];
    }

    const geometry = buildPrReviewRelationEdgeGeometry(
      {
        x: from.x,
        y: from.y,
        width: from.props.w,
        height: from.props.h
      },
      {
        x: to.x,
        y: to.y,
        width: to.props.w,
        height: to.props.h
      }
    );

    if (
      preserveStoredRoutes &&
      hasPrReviewRelationAnchors(shape, geometry)
    ) {
      return [];
    }

    return [
      {
        id: shape.id,
        type: PR_REVIEW_RELATION_EDGE_SHAPE_TYPE,
        x: geometry.x,
        y: geometry.y,
        props: {
          ...shape.props,
          w: geometry.width,
          h: geometry.height,
          startX: geometry.startX,
          startY: geometry.startY,
          endX: geometry.endX,
          endY: geometry.endY,
          routePoints: geometry.routePoints
        }
      } satisfies TLShapePartial<PrReviewRelationEdgeShape>
    ];
  });

  if (!updates.length) {
    return;
  }

  internalShapeUpdateRef.current = true;
  try {
    editor.updateShapes(updates);
  } finally {
    internalShapeUpdateRef.current = false;
  }
}

function hasPrReviewRelationAnchors(
  shape: PrReviewRelationEdgeShape,
  geometry: ReturnType<typeof buildPrReviewRelationEdgeGeometry>
) {
  const routePoints = shape.props.routePoints;
  if (routePoints.length < 2) {
    return false;
  }

  const first = routePoints[0];
  const last = routePoints[routePoints.length - 1];
  if (!first || !last) {
    return false;
  }

  return (
    Math.abs(shape.x + first.x - (geometry.x + geometry.startX)) < 1 &&
    Math.abs(shape.y + first.y - (geometry.y + geometry.startY)) < 1 &&
    Math.abs(shape.x + last.x - (geometry.x + geometry.endX)) < 1 &&
    Math.abs(shape.y + last.y - (geometry.y + geometry.endY)) < 1
  );
}

function initializeSyncedFileGeometry(
  editor: Editor,
  lastSyncedGeometryRef: MutableRefObject<Map<string, string>>
) {
  lastSyncedGeometryRef.current = new Map(
    editor
      .getCurrentPageShapes()
      .filter(isPrReviewFileNodeShape)
      .map((shape) => [
        shape.id,
        getPrReviewFileShapeGeometryKey(toPrReviewFileShapeSnapshot(shape))
      ])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStoredFileNodePinned(shape: PrReviewCanvasShape): boolean {
  return isRecord(shape.rawShape.props) && shape.rawShape.props.pinned === true;
}

function selectReviewFileNode(
  editor: Editor,
  reviewFileId: string | null | undefined
) {
  if (!reviewFileId) {
    editor.selectNone();
    return;
  }

  const fileNode = editor
    .getCurrentPageShapes()
    .find(
      (shape) =>
        isPrReviewFileNodeShape(shape) &&
        shape.props.reviewFileId === reviewFileId
    );

  if (fileNode) {
    editor.select(fileNode.id);
    return;
  }

  editor.selectNone();
}

function resetPrReviewCanvas(
  editor: Editor,
  shapes: TLShapePartial[],
  selectedReviewFileId: string | null | undefined,
  hydratingRef: MutableRefObject<boolean>,
  internalShapeUpdateRef: MutableRefObject<boolean>,
  lastSyncedGeometryRef: MutableRefObject<Map<string, string>>
) {
  hydratingRef.current = true;
  try {
    const existingShapeIds = editor
      .getCurrentPageShapes()
      .map((shape) => shape.id as TLShapeId);

    if (existingShapeIds.length) {
      editor.deleteShapes(existingShapeIds);
    }

    if (!shapes.length) {
      editor.selectNone();
      lastSyncedGeometryRef.current.clear();
      return;
    }

    editor.createShapes(shapes);
    updatePrReviewRelationGeometry(editor, internalShapeUpdateRef, true);
    selectReviewFileNode(editor, selectedReviewFileId);
    initializeSyncedFileGeometry(editor, lastSyncedGeometryRef);
  } finally {
    hydratingRef.current = false;
  }

  window.requestAnimationFrame(() => {
    const viewportBounds = editor.getViewportScreenBounds();
    if (viewportBounds.width >= 640) {
      editor.zoomToFit({ animation: { duration: 160 } });
      return;
    }

    editor.zoomToFit();

    const pageBounds = editor.getCurrentPageBounds();
    const minimumReadableZoom = 0.45;

    if (
      !pageBounds ||
      editor.getZoomLevel() >= minimumReadableZoom
    ) {
      return;
    }

    const viewportInset = 24;
    editor.setCamera({
      x: viewportInset / minimumReadableZoom - pageBounds.x,
      y: viewportInset / minimumReadableZoom - pageBounds.y,
      z: minimumReadableZoom
    });
  });
}

function registerReviewShapePolicy(
  editor: Editor,
  allowFileGeometryRef: MutableRefObject<boolean>,
  hydratingRef: MutableRefObject<boolean>,
  internalShapeUpdateRef: MutableRefObject<boolean>
) {
  editor.sideEffects.registerAfterCreateHandler(
    "shape",
    (shape, source) => {
      if (
        !shouldRemoveCreatedPrReviewSystemShape({
          hydrating: hydratingRef.current,
          internalShapeUpdate: internalShapeUpdateRef.current,
          isSystemShape: prReviewShapeTypes.has(shape.type),
          source
        })
      ) {
        return;
      }

      hydratingRef.current = true;
      try {
        editor.deleteShape(shape.id);
      } finally {
        hydratingRef.current = false;
      }
    }
  );

  editor.sideEffects.registerBeforeChangeHandler("shape", (prev, next) => {
    if (hydratingRef.current || internalShapeUpdateRef.current) {
      return next;
    }

    if (isPrReviewFileNodeShape(next)) {
      if (!allowFileGeometryRef.current || !isPrReviewFileNodeShape(prev)) {
        return prev;
      }

      return {
        ...next,
        rotation: prev.rotation,
        props: prev.props
      };
    }

    if (prReviewShapeTypes.has(next.type)) {
      return prev;
    }

    return next;
  });

  editor.sideEffects.registerBeforeDeleteHandler("shape", (shape) => {
    if (!hydratingRef.current && prReviewShapeTypes.has(shape.type)) {
      return false;
    }
  });
}

function PrReviewFileNodeActivationBridge({
  onFileSelect
}: {
  onFileSelect?: (reviewFileId: string | null) => void;
}) {
  const editor = useEditor();

  useEffect(() => {
    const unregisterActivationHandler =
      registerPrReviewFileNodeActivationHandler(editor, (reviewFileId) => {
        onFileSelect?.(reviewFileId);
      });
    const handleEditorEvent = (event: TLEventInfo) => {
      if (
        event.type === "pointer" &&
        event.name === "pointer_down" &&
        event.target === "canvas"
      ) {
        onFileSelect?.(null);
      }
    };

    editor.on("event", handleEditorEvent);
    return () => {
      editor.off("event", handleEditorEvent);
      unregisterActivationHandler();
    };
  }, [editor, onFileSelect]);

  return null;
}

type PrReviewCanvasPersistenceNotice = {
  message: string;
  tone: "info" | "error";
} | null;

type PrReviewFlowLayoutPreview = {
  next: Map<string, { x: number; y: number }>;
  previous: Map<string, { x: number; y: number }>;
};

const relationTypeLabels: Record<
  PrReviewRelationEdgeShape["props"]["relationType"],
  string
> = {
  review_order: "추천 리뷰 경로",
  depends_on: "의존 관계",
  tests: "테스트 관계",
  uses_api: "API 사용",
  passes_data_to: "데이터 전달",
  supports: "지원 변경"
};

const relationSourceLabels: Record<
  PrReviewRelationEdgeShape["props"]["source"],
  string
> = {
  rule: "규칙 기반",
  ai: "AI 보강",
  hybrid: "규칙·AI 보강",
  fallback: "기본 경로"
};

function getRelationConfidenceLabel(confidence: number) {
  if (confidence >= 85) return "근거 강함";
  if (confidence >= 70) return "근거 보통";
  return "근거 제한적";
}

function PrReviewRelationInspector({ editor }: { editor: Editor | null }) {
  const selectedRelation = useValue(
    "pr-review-relation-inspector-selection",
    () => {
      if (!editor) return null;
      const selected = editor.getOnlySelectedShape();
      return isPrReviewRelationEdgeShape(selected) ? selected : null;
    },
    [editor]
  );

  if (!editor || !selectedRelation) {
    return null;
  }

  const relationDetails =
    selectedRelation.props.relationDetails.length > 0
      ? selectedRelation.props.relationDetails
      : [
          {
            relationType: selectedRelation.props.relationType,
            source: selectedRelation.props.source,
            confidence: selectedRelation.props.confidence,
            reason: selectedRelation.props.reason
          }
        ];

  return (
    <aside
      aria-label="선택한 파일 관계"
      className="absolute bottom-5 left-5 z-20 w-[min(28rem,calc(100%-2.5rem))] rounded-md border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-700">
        <span>
          {relationDetails.length > 1
            ? `관계 ${relationDetails.length}개`
            : relationTypeLabels[relationDetails[0].relationType]}
        </span>
        {relationDetails.length === 1 ? (
          <>
            <span className="text-slate-400">·</span>
            <span>{relationSourceLabels[relationDetails[0].source]}</span>
            <span className="text-slate-400">·</span>
            <span>{getRelationConfidenceLabel(relationDetails[0].confidence)}</span>
          </>
        ) : null}
      </div>
      <ul className="mt-2 space-y-3">
        {relationDetails.map((detail, index) => (
          <li
            className="border-l-2 border-slate-200 pl-3 text-sm leading-6 text-slate-700"
            key={`${detail.relationType}-${detail.source}-${detail.reason}-${index}`}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-600">
              <span>{relationTypeLabels[detail.relationType]}</span>
              <span className="text-slate-400">·</span>
              <span>{relationSourceLabels[detail.source]}</span>
              <span className="text-slate-400">·</span>
              <span>{getRelationConfidenceLabel(detail.confidence)}</span>
            </div>
            <p className="mt-1 break-words">{detail.reason}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}

type PrReviewGraphControlsProps = {
  activeFlowId: string | null;
  collapsedFlowIds: Set<string>;
  focusedFlowId: string | null;
  isReadOnly: boolean;
  mode: PrReviewGraphFilter["mode"];
  onArrangeFlow: () => void;
  onApplyLayoutPreview: () => void;
  onCancelLayoutPreview: () => void;
  onClearFocusedFlow: () => void;
  onFocusFlow: (flowId: string | null) => void;
  onUnpinSelected: () => void;
  onToggleCollapsedFlow: (flowId: string) => void;
  onToggleMode: (mode: PrReviewGraphFilter["mode"]) => void;
  relationTypes: Set<string>;
  riskLevels: Set<PrReviewGraphNode["riskLevel"]>;
  reviewStatuses: Set<PrReviewGraphNode["reviewStatus"]>;
  setRelationTypes: (value: Set<string>) => void;
  setRiskLevels: (value: Set<PrReviewGraphNode["riskLevel"]>) => void;
  setReviewStatuses: (
    value: Set<PrReviewGraphNode["reviewStatus"]>
  ) => void;
  selectedPinned: boolean;
  layoutPreviewActive: boolean;
  flows: PrReviewCanvasFlow[];
};

const relationFilterLabels = {
  review_order: "추천 경로",
  depends_on: "의존",
  tests: "테스트",
  uses_api: "API",
  passes_data_to: "데이터",
  supports: "지원"
} as const;

function toggleFilterValue<T>(values: Set<T>, value: T) {
  const next = new Set(values);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

function PrReviewGraphControls({
  activeFlowId,
  collapsedFlowIds,
  focusedFlowId,
  flows,
  isReadOnly,
  mode,
  onArrangeFlow,
  onApplyLayoutPreview,
  onCancelLayoutPreview,
  onClearFocusedFlow,
  onFocusFlow,
  onUnpinSelected,
  onToggleCollapsedFlow,
  onToggleMode,
  relationTypes,
  riskLevels,
  reviewStatuses,
  setRelationTypes,
  setRiskLevels,
  setReviewStatuses,
  selectedPinned,
  layoutPreviewActive
}: PrReviewGraphControlsProps) {
  return (
    <div className="absolute right-5 top-5 z-20 flex items-center gap-2">
      <Popover>
        <PopoverTrigger
          render={
            <Button aria-label="그래프 탐색 설정" size="icon" variant="outline">
              <Filter className="size-4" />
            </Button>
          }
        />
        <PopoverContent align="end" className="w-80 space-y-4 p-4">
          <section>
            <p className="text-sm font-semibold">관계 보기</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(
                [
                  ["all", "전체"],
                  ["related", "선택 관계"],
                  ["review_path", "추천 경로"]
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  onClick={() => onToggleMode(value)}
                  size="sm"
                  variant={mode === value ? "default" : "outline"}
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>
          <section>
            <p className="text-sm font-semibold">관계 종류</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(relationFilterLabels).map(([value, label]) => (
                <Button
                  key={value}
                  onClick={() =>
                    setRelationTypes(toggleFilterValue(relationTypes, value))
                  }
                  size="sm"
                  variant={relationTypes.has(value) ? "default" : "outline"}
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>
          <section>
            <p className="text-sm font-semibold">파일 상태</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ["high", "위험 높음"],
                  ["medium", "위험 중간"],
                  ["low", "위험 낮음"],
                  ["not_reviewed", "미판단"],
                  ["discussion_needed", "논의 필요"]
                ] as const
              ).map(([value, label]) => {
                const selected =
                  value === "high" || value === "medium" || value === "low"
                    ? riskLevels.has(value)
                    : reviewStatuses.has(value);
                return (
                  <Button
                    key={value}
                    onClick={() => {
                      if (value === "high" || value === "medium" || value === "low") {
                        setRiskLevels(toggleFilterValue(riskLevels, value));
                      } else {
                        setReviewStatuses(toggleFilterValue(reviewStatuses, value));
                      }
                    }}
                    size="sm"
                    variant={selected ? "default" : "outline"}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </section>
          <section>
            <p className="text-sm font-semibold">Flow</p>
            <div className="mt-2 space-y-1">
              <Button
                className="w-full justify-start"
                onClick={onClearFocusedFlow}
                size="sm"
                variant={focusedFlowId === null ? "default" : "outline"}
              >
                모든 Flow 보기
              </Button>
              {flows.map((flow) => (
                <div className="flex gap-1" key={flow.id}>
                  <Button
                    className="min-w-0 flex-1 justify-start truncate"
                    onClick={() => onFocusFlow(flow.id)}
                    size="sm"
                    variant={focusedFlowId === flow.id ? "default" : "outline"}
                  >
                    {flow.title}
                  </Button>
                  <Button
                    aria-label={`${flow.title} ${collapsedFlowIds.has(flow.id) ? "펼치기" : "접기"}`}
                    onClick={() => onToggleCollapsedFlow(flow.id)}
                    size="icon-sm"
                    variant="outline"
                  >
                    <ChevronDown
                      className={`size-4 transition-transform ${
                        collapsedFlowIds.has(flow.id) ? "-rotate-90" : ""
                      }`}
                    />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="현재 Flow 자동 정렬"
              disabled={!activeFlowId || isReadOnly || layoutPreviewActive}
              onClick={onArrangeFlow}
              size="icon"
              variant="outline"
            >
              <LayoutPanelTop className="size-4" />
            </Button>
          }
        />
        <TooltipContent>현재 Flow 자동 정렬</TooltipContent>
      </Tooltip>
      {layoutPreviewActive ? (
        <div className="flex items-center gap-1 rounded-md border bg-white p-1 shadow-sm">
          <Button onClick={onCancelLayoutPreview} size="sm" variant="ghost">
            되돌리기
          </Button>
          <Button onClick={onApplyLayoutPreview} size="sm">
            배치 적용
          </Button>
        </div>
      ) : null}
      {selectedPinned ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="선택 파일 고정 해제"
                disabled={isReadOnly}
                onClick={onUnpinSelected}
                size="icon"
                variant="outline"
              >
                <RotateCcw className="size-4" />
              </Button>
            }
          />
          <TooltipContent>선택 파일 고정 해제</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

function PrReviewCanvasPersistenceBridge({
  apiClient,
  enabled,
  hydratingRef,
  internalShapeUpdateRef,
  lastSyncedGeometryRef,
  onNotice,
  storedShapeByIdRef,
  storedShapes,
  workspaceId
}: {
  apiClient: PrReviewApiClient;
  enabled: boolean;
  hydratingRef: MutableRefObject<boolean>;
  internalShapeUpdateRef: MutableRefObject<boolean>;
  lastSyncedGeometryRef: MutableRefObject<Map<string, string>>;
  onNotice: (notice: PrReviewCanvasPersistenceNotice) => void;
  storedShapeByIdRef: MutableRefObject<Map<string, PrReviewCanvasShape>>;
  storedShapes: PrReviewCanvasShape[];
  workspaceId: string;
}) {
  const editor = useEditor();
  const operationSequenceRef = useRef(0);

  useEffect(() => {
    for (const shape of storedShapes) {
      const current = storedShapeByIdRef.current.get(shape.id);
      if (!current || current.revision <= shape.revision) {
        storedShapeByIdRef.current.set(shape.id, shape);
      }
    }
  }, [storedShapes]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const pendingShapes = new Map<string, PrReviewCanvasFileShapeSnapshot>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let flushing = false;
    let disposed = false;

    async function applyLatestShape(shapeId: string) {
      const latest = await apiClient.getReviewCanvasShape(workspaceId, shapeId);
      storedShapeByIdRef.current.set(shapeId, latest);

      const current = editor.getShape(shapeId as TLShapeId);
      if (!isPrReviewFileNodeShape(current)) {
        return;
      }

      hydratingRef.current = true;
      try {
        editor.updateShape({
          id: current.id,
          type: PR_REVIEW_FILE_NODE_SHAPE_TYPE,
          index:
            typeof latest.rawShape.index === "string"
              ? (latest.rawShape.index as TLShape["index"])
              : current.index,
          parentId: latest.parentShapeId?.startsWith("shape:")
            ? (latest.parentShapeId as TLShapeId)
            : editor.getCurrentPageId(),
          x: latest.x,
          y: latest.y,
          props: {
            ...current.props,
            w: latest.width ?? current.props.w,
            h: latest.height ?? current.props.h,
            pinned: getStoredFileNodePinned(latest)
          }
        });
      } finally {
        hydratingRef.current = false;
      }

      const updated = editor.getShape(shapeId as TLShapeId);
      if (isPrReviewFileNodeShape(updated)) {
        lastSyncedGeometryRef.current.set(
          shapeId,
          getPrReviewFileShapeGeometryKey(
            toPrReviewFileShapeSnapshot(updated)
          )
        );
      }
      updatePrReviewRelationGeometry(editor, internalShapeUpdateRef);
    }

    async function flushPendingShapes() {
      if (flushing || pendingShapes.size === 0) {
        return;
      }

      flushing = true;
      const entries = [...pendingShapes.entries()];
      pendingShapes.clear();

      try {
        for (const [shapeId, snapshot] of entries) {
          const storedShape = storedShapeByIdRef.current.get(shapeId);
          if (!storedShape || !isPrReviewCanvasFileShape(storedShape)) {
            continue;
          }

          operationSequenceRef.current += 1;
          const input = buildPrReviewFileShapeUpdateInput(
            storedShape,
            snapshot,
            `pr-review-canvas-${Date.now()}-${operationSequenceRef.current}`
          );

          try {
            const updated = await apiClient.updateReviewCanvasFileShape(
              workspaceId,
              shapeId,
              input
            );
            storedShapeByIdRef.current.set(
              shapeId,
              applyPrReviewFileShapeUpdate(
                storedShape,
                input,
                updated.revision
              )
            );
            lastSyncedGeometryRef.current.set(
              shapeId,
              getPrReviewFileShapeGeometryKey(snapshot)
            );
            if (!disposed) {
              onNotice(null);
            }
          } catch (error) {
            if (error instanceof PrReviewApiError && error.status === 409) {
              try {
                await applyLatestShape(shapeId);
                if (!disposed) {
                  onNotice({
                    message: "다른 사용자의 최신 노드 위치를 반영했습니다.",
                    tone: "info"
                  });
                }
                continue;
              } catch {
                // Fall through to the regular persistence error state.
              }
            }

            if (!disposed) {
              onNotice({
                message: "노드 위치를 저장하지 못했습니다. 다시 이동해 주세요.",
                tone: "error"
              });
            }
          }
        }
      } finally {
        flushing = false;
        if (pendingShapes.size > 0) {
          if (disposed) {
            void flushPendingShapes();
          } else {
            scheduleFlush();
          }
        }
      }
    }

    function scheduleFlush() {
      if (flushTimer) {
        clearTimeout(flushTimer);
      }

      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushPendingShapes();
      }, FILE_SHAPE_SAVE_DEBOUNCE_MS);
    }

    const removeListener = editor.store.listen(
      () => {
        if (hydratingRef.current || internalShapeUpdateRef.current) {
          return;
        }

        let hasChangedFile = false;
        const pinUpdates: TLShapePartial<PrReviewFileNodeShape>[] = [];
        for (const shape of editor.getCurrentPageShapes()) {
          if (!isPrReviewFileNodeShape(shape)) {
            continue;
          }

          let snapshot = toPrReviewFileShapeSnapshot(shape);
          const geometryKey = getPrReviewFileShapeGeometryKey(snapshot);
          if (lastSyncedGeometryRef.current.get(shape.id) === geometryKey) {
            continue;
          }

          if (!shape.props.pinned) {
            pinUpdates.push({
              id: shape.id,
              type: PR_REVIEW_FILE_NODE_SHAPE_TYPE,
              props: {
                ...shape.props,
                pinned: true
              }
            });
          }

          pendingShapes.set(shape.id, snapshot);
          hasChangedFile = true;
        }

        if (!hasChangedFile) {
          return;
        }

        if (pinUpdates.length) {
          internalShapeUpdateRef.current = true;
          try {
            editor.updateShapes(pinUpdates);
            for (const update of pinUpdates) {
              const pinnedShape = editor.getShape(update.id);
              if (isPrReviewFileNodeShape(pinnedShape)) {
                pendingShapes.set(
                  pinnedShape.id,
                  toPrReviewFileShapeSnapshot(pinnedShape)
                );
              }
            }
          } finally {
            internalShapeUpdateRef.current = false;
          }
        }

        updatePrReviewRelationGeometry(editor, internalShapeUpdateRef);
        scheduleFlush();
      },
      { scope: "document", source: "user" }
    );

    return () => {
      removeListener();
      if (flushTimer) {
        clearTimeout(flushTimer);
      }
      void flushPendingShapes();
      disposed = true;
    };
  }, [
    apiClient,
    editor,
    enabled,
    hydratingRef,
    internalShapeUpdateRef,
    lastSyncedGeometryRef,
    onNotice,
    workspaceId
  ]);

  return null;
}

export function PrReviewCanvasSurface({
  apiClient,
  canvas,
  className,
  conflictAnalysis,
  onDecisionUpdated,
  onFileSelect,
  onRealtimeRoomJoined,
  preparedConflictFileIds = new Set<string>(),
  readOnly: isReviewVersionStale = false,
  realtimeIdentity,
  reviewRoomId,
  selectedReviewFileId,
  workspaceId
}: PrReviewCanvasSurfaceProps) {
  const editorRef = useRef<Editor | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const allowFileGeometryRef = useRef(false);
  const hydratingRef = useRef(false);
  const internalShapeUpdateRef = useRef(false);
  const lastSyncedGeometryRef = useRef(new Map<string, string>());
  const storedShapeByIdRef = useRef(new Map<string, PrReviewCanvasShape>());
  const pendingRemoteOperationsRef = useRef<CanvasShapeOperationPayload[]>([]);
  const selectedReviewFileIdRef = useRef<string | null>(
    selectedReviewFileId ?? null
  );
  const [storedShapes, setStoredShapes] = useState<
    PrReviewCanvasShape[] | null
  >(null);
  const [reviewRoom, setReviewRoom] = useState<PrReviewRoomCanvas | null>(null);
  const [persistenceNotice, setPersistenceNotice] =
    useState<PrReviewCanvasPersistenceNotice>(null);
  const [graphMode, setGraphMode] = useState<PrReviewGraphFilter["mode"]>(
    "all"
  );
  const [focusedFlowId, setFocusedFlowId] = useState<string | null>(null);
  const [collapsedFlowIds, setCollapsedFlowIds] = useState<Set<string>>(
    () => new Set()
  );
  const [relationTypes, setRelationTypes] = useState<Set<string>>(
    () => new Set()
  );
  const [riskLevels, setRiskLevels] = useState<
    Set<PrReviewGraphNode["riskLevel"]>
  >(() => new Set());
  const [reviewStatuses, setReviewStatuses] = useState<
    Set<PrReviewGraphNode["reviewStatus"]>
  >(() => new Set());
  const [layoutPreview, setLayoutPreview] =
    useState<PrReviewFlowLayoutPreview | null>(null);
  const persistedFileShapeEnabled = Boolean(
    storedShapes?.some(isPrReviewCanvasFileShape)
  );
  const selectedGraphFile = useValue(
    "pr-review-graph-selected-file",
    () => {
      if (!editor) return null;
      const selected = editor.getOnlySelectedShape();
      return isPrReviewFileNodeShape(selected) ? selected : null;
    },
    [editor]
  );
  const fallbackShapes = useMemo(
    () =>
      buildPrReviewCanvasShapes(
        canvas,
        conflictAnalysis,
        preparedConflictFileIds
    ),
    [canvas, conflictAnalysis, preparedConflictFileIds]
  );
  const persistedShapes = useMemo(
    () => buildStoredPrReviewCanvasShapes(storedShapes ?? [], canvas),
    [canvas, storedShapes]
  );
  const shapes = persistedFileShapeEnabled
    ? persistedShapes
    : storedShapes === null
      ? []
      : fallbackShapes;
  const realtimeConfig = useMemo<CanvasRealtimeConfig>(
    () => ({
      ...realtimeIdentity,
      canvasId: reviewRoom?.canvasId ?? "",
      enabled: Boolean(
        reviewRoom &&
          realtimeIdentity.authToken &&
          realtimeIdentity.currentUser?.userId &&
          workspaceId
      ),
      workspaceId
    }),
    [realtimeIdentity, reviewRoom?.canvasId, workspaceId]
  );
  const catchUpCanvasOperations = useCallback(
    (afterSeq: number, signal: AbortSignal) => {
      if (!reviewRoom) {
        return Promise.resolve({ latestOpSeq: afterSeq, operations: [] });
      }

      return apiClient.listReviewCanvasOperations(
        workspaceId,
        reviewRoom.canvasId,
        afterSeq,
        { signal }
      );
    },
    [apiClient, reviewRoom, workspaceId]
  );
  const applyRemoteCanvasOperations = useCallback(
    (operations: CanvasShapeOperationPayload[]) => {
      const editor = editorRef.current;
      if (!editor) {
        pendingRemoteOperationsRef.current = [
          ...pendingRemoteOperationsRef.current,
          ...operations
        ];
        return;
      }

      const operationsToApply = [
        ...pendingRemoteOperationsRef.current,
        ...operations
      ].sort((left, right) => left.opSeq - right.opSeq);
      pendingRemoteOperationsRef.current = [];
      let geometryChanged = false;

      for (const operation of operationsToApply) {
        if (operation.actorUserId === realtimeIdentity.currentUser?.userId) {
          continue;
        }

        const latest = readPrReviewCanvasOperationShape(operation);
        if (!latest) {
          continue;
        }

        const stored = storedShapeByIdRef.current.get(latest.id);
        if (stored && stored.revision >= latest.revision) {
          continue;
        }
        storedShapeByIdRef.current.set(latest.id, latest);

        const current = editor.getShape(latest.id as TLShapeId);
        if (!isPrReviewFileNodeShape(current)) {
          continue;
        }

        const remoteIndex =
          typeof latest.rawShape.index === "string" &&
          isValidPrReviewCanvasIndex(latest.rawShape.index)
            ? (latest.rawShape.index as TLShape["index"])
            : current.index;

        hydratingRef.current = true;
        try {
          editor.updateShape({
            id: current.id,
            type: PR_REVIEW_FILE_NODE_SHAPE_TYPE,
            index: remoteIndex,
            parentId: latest.parentShapeId?.startsWith("shape:")
              ? (latest.parentShapeId as TLShapeId)
              : editor.getCurrentPageId(),
            x: latest.x,
            y: latest.y,
            props: {
              ...current.props,
              w: latest.width ?? current.props.w,
              h: latest.height ?? current.props.h,
              pinned: getStoredFileNodePinned(latest)
            }
          });
        } finally {
          hydratingRef.current = false;
        }

        const updated = editor.getShape(latest.id as TLShapeId);
        if (isPrReviewFileNodeShape(updated)) {
          lastSyncedGeometryRef.current.set(
            latest.id,
            getPrReviewFileShapeGeometryKey(
              toPrReviewFileShapeSnapshot(updated)
            )
          );
        }
        geometryChanged = true;
      }

      if (geometryChanged) {
        updatePrReviewRelationGeometry(editor, internalShapeUpdateRef);
      }
    },
    [realtimeIdentity.currentUser?.userId]
  );
  const canvasPresence = usePrReviewCanvasPresence(realtimeConfig, {
    applyOperations: applyRemoteCanvasOperations,
    catchUpOperations: catchUpCanvasOperations,
    onDecisionUpdated,
    onRoomJoined: onRealtimeRoomJoined
  });
  const readOnly =
    isReviewVersionStale || reviewRoom?.status === "completed" || canvasPresence.readOnly;
  const selectedRoomFileId = selectedGraphFile?.props.roomFileId ?? null;
  const activeFlowId = focusedFlowId ?? selectedGraphFile?.props.flowId ?? null;
  const graphFilter = useMemo<PrReviewGraphFilter>(
    () => ({
      collapsedFlowIds,
      focusedFlowId,
      mode: graphMode,
      relationTypes,
      riskLevels,
      reviewStatuses,
      selectedRoomFileId
    }),
    [
      collapsedFlowIds,
      focusedFlowId,
      graphMode,
      relationTypes,
      reviewStatuses,
      riskLevels,
      selectedRoomFileId
    ]
  );
  const handlePersistenceNotice = useCallback(
    (notice: PrReviewCanvasPersistenceNotice) => {
      setPersistenceNotice(notice);
    },
    []
  );

  allowFileGeometryRef.current = persistedFileShapeEnabled;

  useEffect(() => {
    if (!editor) {
      return;
    }

    const presentation = buildPrReviewGraphPresentation(
      getGraphNodes(editor),
      getGraphRelations(editor),
      graphFilter
    );
    const updates: TLShapePartial[] = editor.getCurrentPageShapes().flatMap((shape) => {
      if (isPrReviewFileNodeShape(shape)) {
        const opacity = presentation.nodeOpacityById.get(shape.id) ?? 1;
        return shape.opacity === opacity
          ? []
          : [{ id: shape.id, type: shape.type, opacity } as TLShapePartial];
      }
      if (isPrReviewRelationEdgeShape(shape)) {
        const opacity = presentation.edgeOpacityById.get(shape.id) ?? 1;
        return shape.opacity === opacity
          ? []
          : [{ id: shape.id, type: shape.type, opacity } as TLShapePartial];
      }
      return [];
    });

    if (!updates.length) {
      return;
    }

    internalShapeUpdateRef.current = true;
    try {
      editor.updateShapes(updates);
    } finally {
      internalShapeUpdateRef.current = false;
    }
  }, [editor, graphFilter, persistedShapes]);

  useEffect(() => {
    const abortController = new AbortController();
    setStoredShapes(null);
    setReviewRoom(null);
    setPersistenceNotice(null);
    storedShapeByIdRef.current.clear();
    pendingRemoteOperationsRef.current = [];

    void apiClient
      .getReviewRoom(workspaceId, reviewRoomId, {
        signal: abortController.signal
      })
      .then(async (room) => ({
        loadedShapes: await apiClient.listReviewCanvasShapes(
          workspaceId,
          room.canvasId,
          PR_REVIEW_CANVAS_LOAD_QUERY,
          { signal: abortController.signal }
        ),
        room
      }))
      .then(({ loadedShapes, room }) => {
        if (abortController.signal.aborted) {
          return;
        }

        const systemShapes = loadedShapes.filter(isPrReviewCanvasSystemShape);
        storedShapeByIdRef.current = new Map(
          systemShapes.map((shape) => [shape.id, shape])
        );
        setReviewRoom(room);
        setStoredShapes(systemShapes);
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        setReviewRoom(null);
        setStoredShapes([]);
        setPersistenceNotice({
          message: "저장된 노드 배치를 불러오지 못해 기본 배치를 표시합니다.",
          tone: "error"
        });
      });

    return () => abortController.abort();
  }, [apiClient, canvas.reviewSessionId, reviewRoomId, workspaceId]);

  useEffect(() => {
    setPersistenceNotice((currentNotice) => {
      if (canvasPresence.operationSyncError) {
        return {
          message: OPERATION_SYNC_ERROR_MESSAGE,
          tone: "error"
        };
      }

      return currentNotice?.message === OPERATION_SYNC_ERROR_MESSAGE
        ? null
        : currentNotice;
    });
  }, [canvasPresence.operationSyncError]);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      setEditor(editor);
      editor.setCurrentTool("select.idle");
      registerReviewShapePolicy(
        editor,
        allowFileGeometryRef,
        hydratingRef,
        internalShapeUpdateRef
      );
      resetPrReviewCanvas(
        editor,
        shapes,
        selectedReviewFileIdRef.current,
        hydratingRef,
        internalShapeUpdateRef,
        lastSyncedGeometryRef
      );
      if (pendingRemoteOperationsRef.current.length) {
        applyRemoteCanvasOperations([]);
      }
      if (persistedFileShapeEnabled) {
        syncPrReviewFileNodeMetadata(
          editor,
          canvas,
          conflictAnalysis,
          preparedConflictFileIds,
          internalShapeUpdateRef
        );
      }
    },
    [
      applyRemoteCanvasOperations,
      canvas,
      conflictAnalysis,
      persistedFileShapeEnabled,
      preparedConflictFileIds,
      shapes
    ]
  );

  useEffect(() => {
    selectedReviewFileIdRef.current = selectedReviewFileId ?? null;
  }, [selectedReviewFileId]);

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }

    resetPrReviewCanvas(
      editorRef.current,
      shapes,
      selectedReviewFileIdRef.current,
      hydratingRef,
      internalShapeUpdateRef,
      lastSyncedGeometryRef
    );
    if (persistedFileShapeEnabled) {
      syncPrReviewFileNodeMetadata(
        editorRef.current,
        canvas,
        conflictAnalysis,
        preparedConflictFileIds,
        internalShapeUpdateRef
      );
    }
  }, [persistedFileShapeEnabled, shapes]);

  useEffect(() => {
    if (!editorRef.current || !persistedFileShapeEnabled) {
      return;
    }

    syncPrReviewFileNodeMetadata(
      editorRef.current,
      canvas,
      conflictAnalysis,
      preparedConflictFileIds,
      internalShapeUpdateRef
    );
  }, [
    canvas,
    conflictAnalysis,
    persistedFileShapeEnabled,
    preparedConflictFileIds
  ]);

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }

    selectReviewFileNode(editorRef.current, selectedReviewFileId);
  }, [selectedReviewFileId]);

  const handleArrangeActiveFlow = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor || !activeFlowId || readOnly) {
      return;
    }

    const positions = createPrReviewFlowLayout(
      getGraphNodes(currentEditor),
      getGraphRelations(currentEditor),
      activeFlowId
    );
    if (!positions.size) {
      setPersistenceNotice({
        message: "고정되지 않은 파일이 없어 현재 Flow를 다시 정렬할 수 없습니다.",
        tone: "info"
      });
      return;
    }

    const previous = new Map(
      getGraphNodes(currentEditor)
        .filter((node) => positions.has(node.id))
        .map((node) => [node.id, { x: node.x, y: node.y }] as const)
    );
    const updates = Array.from(
      positions,
      ([id, position]) =>
        ({
          id: id as TLShapeId,
          type: PR_REVIEW_FILE_NODE_SHAPE_TYPE,
          x: position.x,
          y: position.y
        }) satisfies TLShapePartial<PrReviewFileNodeShape>
    );
    internalShapeUpdateRef.current = true;
    try {
      currentEditor.updateShapes(updates);
      updatePrReviewRelationGeometry(currentEditor, internalShapeUpdateRef);
    } finally {
      internalShapeUpdateRef.current = false;
    }
    setLayoutPreview({ next: positions, previous });
    setPersistenceNotice({
      message: "고정된 파일은 유지한 배치 미리보기입니다. 적용하면 함께 저장됩니다.",
      tone: "info"
    });
  }, [activeFlowId, readOnly]);

  const handleCancelLayoutPreview = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor || !layoutPreview) {
      return;
    }

    internalShapeUpdateRef.current = true;
    try {
      currentEditor.updateShapes(
        Array.from(
          layoutPreview.previous,
          ([id, position]) =>
            ({
              id: id as TLShapeId,
              type: PR_REVIEW_FILE_NODE_SHAPE_TYPE,
              x: position.x,
              y: position.y
            }) satisfies TLShapePartial<PrReviewFileNodeShape>
        )
      );
      updatePrReviewRelationGeometry(currentEditor, internalShapeUpdateRef);
    } finally {
      internalShapeUpdateRef.current = false;
    }
    setLayoutPreview(null);
    setPersistenceNotice(null);
  }, [layoutPreview]);

  const handleApplyLayoutPreview = useCallback(async () => {
    const currentEditor = editorRef.current;
    if (!currentEditor || !layoutPreview || readOnly) {
      return;
    }

    try {
      for (const shapeId of layoutPreview.next.keys()) {
        const shape = currentEditor.getShape(shapeId as TLShapeId);
        const stored = storedShapeByIdRef.current.get(shapeId);
        if (!isPrReviewFileNodeShape(shape) || !stored || !isPrReviewCanvasFileShape(stored)) {
          continue;
        }
        const snapshot = toPrReviewFileShapeSnapshot(shape);
        const input = buildPrReviewFileShapeUpdateInput(
          stored,
          snapshot,
          `pr-review-canvas-layout-${Date.now()}-${shapeId}`
        );
        const updated = await apiClient.updateReviewCanvasFileShape(
          workspaceId,
          shapeId,
          input
        );
        storedShapeByIdRef.current.set(
          shapeId,
          applyPrReviewFileShapeUpdate(stored, input, updated.revision)
        );
        lastSyncedGeometryRef.current.set(
          shapeId,
          getPrReviewFileShapeGeometryKey(snapshot)
        );
      }
      setLayoutPreview(null);
      setPersistenceNotice({
        message: "현재 Flow 배치를 저장했습니다.",
        tone: "info"
      });
    } catch {
      setPersistenceNotice({
        message: "배치를 저장하지 못했습니다. 미리보기 상태에서 다시 시도해주세요.",
        tone: "error"
      });
    }
  }, [apiClient, layoutPreview, readOnly, workspaceId]);

  const handleUnpinSelected = useCallback(async () => {
    const currentEditor = editorRef.current;
    if (!currentEditor || !selectedGraphFile || readOnly) {
      return;
    }

    const stored = storedShapeByIdRef.current.get(selectedGraphFile.id);
    if (!stored || !isPrReviewCanvasFileShape(stored)) {
      return;
    }

    const snapshot = {
      ...toPrReviewFileShapeSnapshot(selectedGraphFile),
      props: {
        ...toPrReviewFileShapeSnapshot(selectedGraphFile).props,
        pinned: false
      }
    };
    const input = buildPrReviewFileShapeUpdateInput(
      stored,
      snapshot,
      `pr-review-canvas-unpin-${Date.now()}`
    );

    try {
      const updated = await apiClient.updateReviewCanvasFileShape(
        workspaceId,
        selectedGraphFile.id,
        input
      );
      storedShapeByIdRef.current.set(
        selectedGraphFile.id,
        applyPrReviewFileShapeUpdate(stored, input, updated.revision)
      );
      hydratingRef.current = true;
      try {
        currentEditor.updateShape({
          id: selectedGraphFile.id,
          type: PR_REVIEW_FILE_NODE_SHAPE_TYPE,
          props: { ...selectedGraphFile.props, pinned: false }
        });
      } finally {
        hydratingRef.current = false;
      }
      lastSyncedGeometryRef.current.set(
        selectedGraphFile.id,
        getPrReviewFileShapeGeometryKey(snapshot)
      );
      setPersistenceNotice({ message: "선택 파일의 고정을 해제했습니다.", tone: "info" });
    } catch {
      setPersistenceNotice({
        message: "파일 고정을 해제하지 못했습니다. 다시 시도해주세요.",
        tone: "error"
      });
    }
  }, [apiClient, readOnly, selectedGraphFile, workspaceId]);

  const handleToggleCollapsedFlow = useCallback((flowId: string) => {
    setCollapsedFlowIds((current) => {
      const next = new Set(current);
      if (next.has(flowId)) {
        next.delete(flowId);
      } else {
        next.add(flowId);
      }
      return next;
    });
  }, []);

  return (
    <div className={`relative ${className ?? ""}`}>
      {persistenceNotice ? (
        <div
          className={`absolute left-5 top-5 z-10 max-w-md rounded-md border px-4 py-3 text-sm font-medium shadow-sm ${
            persistenceNotice.tone === "error"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : "border-blue-200 bg-blue-50 text-blue-700"
          }`}
          role="status"
        >
          {persistenceNotice.message}
        </div>
      ) : null}
      <TldrawSurface
        className="h-full w-full"
        components={prReviewTldrawComponents}
        hideUi
        onMount={handleMount}
        shapeUtils={prReviewShapeUtils}
      >
        <PrReviewWorkspaceLocationAdapter
          reviewSessionId={canvas.reviewSessionId}
        />
        <PrReviewCanvasRealtimeBridge
          presence={canvasPresence}
          readOnly={readOnly}
        />
        <PrReviewFileNodeActivationBridge onFileSelect={onFileSelect} />
        <PrReviewCanvasPersistenceBridge
          apiClient={apiClient}
          enabled={persistedFileShapeEnabled && !readOnly}
          hydratingRef={hydratingRef}
          internalShapeUpdateRef={internalShapeUpdateRef}
          lastSyncedGeometryRef={lastSyncedGeometryRef}
          onNotice={handlePersistenceNotice}
          storedShapeByIdRef={storedShapeByIdRef}
          storedShapes={storedShapes ?? []}
          workspaceId={workspaceId}
        />
      </TldrawSurface>
      <PrReviewGraphControls
        activeFlowId={activeFlowId}
        collapsedFlowIds={collapsedFlowIds}
        flows={canvas.flows}
        focusedFlowId={focusedFlowId}
        isReadOnly={readOnly}
        mode={graphMode}
        onArrangeFlow={handleArrangeActiveFlow}
        onApplyLayoutPreview={() => void handleApplyLayoutPreview()}
        onCancelLayoutPreview={handleCancelLayoutPreview}
        onClearFocusedFlow={() => setFocusedFlowId(null)}
        onFocusFlow={setFocusedFlowId}
        onUnpinSelected={() => void handleUnpinSelected()}
        onToggleCollapsedFlow={handleToggleCollapsedFlow}
        onToggleMode={setGraphMode}
        relationTypes={relationTypes}
        reviewStatuses={reviewStatuses}
        riskLevels={riskLevels}
        setRelationTypes={setRelationTypes}
        setReviewStatuses={setReviewStatuses}
        setRiskLevels={setRiskLevels}
        layoutPreviewActive={layoutPreview !== null}
        selectedPinned={selectedGraphFile?.props.pinned === true}
      />
      <PrReviewRelationInspector editor={editor} />
    </div>
  );
}
