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
  useEditor,
  type Editor,
  type TLEventInfo,
  type TLShape,
  type TLShapeId,
  type TLShapePartial
} from "tldraw";

import { TldrawSurface } from "@/shared/tldraw/TldrawSurface";
import type {
  PrReviewCanvas,
  PrReviewCanvasShape,
  PrReviewCanvasFlow,
  PrReviewConflictAnalysis,
  PrReviewFlowFile
} from "@/features/pr-review/types";
import {
  PrReviewApiError,
  type createPrReviewApiClient
} from "@/features/pr-review/api/client";
import { PrReviewCanvasBackground } from "@/features/pr-review/components/review-canvas/PrReviewCanvasBackground";
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
  type PrReviewCanvasFileShapeSnapshot
} from "@/features/pr-review/components/review-canvas/pr-review-canvas-persistence";
import {
  createPrReviewFileNodeActivationGesture,
  shouldActivatePrReviewFileNode,
  updatePrReviewFileNodeActivationGesture,
  type PrReviewFileNodeActivationGesture
} from "@/features/pr-review/components/review-canvas/pr-review-node-activation";

type PrReviewApiClient = ReturnType<typeof createPrReviewApiClient>;

type PrReviewCanvasSurfaceProps = {
  apiClient: PrReviewApiClient;
  canvas: PrReviewCanvas;
  className?: string;
  conflictAnalysis?: PrReviewConflictAnalysis | null;
  onFileSelect?: (reviewFileId: string | null) => void;
  preparedConflictFileIds?: Set<string>;
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

const prReviewTldrawComponents = {
  Background: PrReviewCanvasBackground
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
      riskLevel: fileNodeData.riskLevel,
      reviewStatus: fileNodeData.reviewStatus,
      conflictState: conflictMetadata.conflictState,
      conflictReason: conflictMetadata.conflictReason
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
  storedShapes: PrReviewCanvasShape[]
): TLShapePartial[] {
  return storedShapes.flatMap((shape) => {
    if (!isPrReviewCanvasSystemShape(shape) || !isRecord(shape.rawShape.props)) {
      return [];
    }

    const partial: TLShapePartial = {
      id: shape.id as TLShapeId,
      type: shape.shapeType,
      x: shape.x,
      y: shape.y,
      rotation: shape.rotation,
      props: { ...shape.rawShape.props }
    } as TLShapePartial;

    if (typeof shape.rawShape.index === "string") {
      partial.index = shape.rawShape.index as TLShape["index"];
    }

    if (shape.parentShapeId?.startsWith("shape:")) {
      partial.parentId = shape.parentShapeId as TLShapeId;
    }

    return [partial];
  });
}

function isPrReviewRelationEdgeShape(
  shape: TLShape | null | undefined
): shape is PrReviewRelationEdgeShape {
  return shape?.type === PR_REVIEW_RELATION_EDGE_SHAPE_TYPE;
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
      h: shape.props.h
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
  const getConflictMetadata = createConflictMetadataResolver(
    conflictAnalysis,
    preparedConflictFileIds
  );
  const updates = editor.getCurrentPageShapes().flatMap((shape) => {
    if (!isPrReviewFileNodeShape(shape)) {
      return [];
    }

    const file = fileByReviewFileId.get(shape.props.reviewFileId);
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
          riskLevel: file.fileNodeData.riskLevel,
          reviewStatus: file.fileNodeData.reviewStatus,
          conflictState: conflictMetadata.conflictState,
          conflictReason: conflictMetadata.conflictReason
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
  internalShapeUpdateRef: MutableRefObject<boolean>
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
          endY: geometry.endY
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
  const gestureRef = useRef<PrReviewFileNodeActivationGesture | null>(null);

  useEffect(() => {
    const handleEditorEvent = (event: TLEventInfo) => {
      if (event.name === "cancel" || event.name === "interrupt") {
        gestureRef.current = null;
        return;
      }

      if (event.type !== "pointer") {
        return;
      }

      if (event.name === "pointer_down") {
        if (event.target === "shape" && isPrReviewFileNodeShape(event.shape)) {
          gestureRef.current = createPrReviewFileNodeActivationGesture({
            pointer: event.point,
            reviewFileId: event.shape.props.reviewFileId,
            shapeId: event.shape.id,
            shapePosition: event.shape
          });
          return;
        }

        gestureRef.current = null;
        onFileSelect?.(null);
        return;
      }

      const gesture = gestureRef.current;
      if (!gesture) {
        return;
      }

      if (event.name === "pointer_move") {
        gestureRef.current = updatePrReviewFileNodeActivationGesture(
          gesture,
          event.point
        );
        return;
      }

      if (event.name !== "pointer_up") {
        return;
      }

      const completedGesture = updatePrReviewFileNodeActivationGesture(
        gesture,
        event.point
      );
      const currentShape = editor.getShape(completedGesture.shapeId as TLShapeId);
      gestureRef.current = null;

      if (
        isPrReviewFileNodeShape(currentShape) &&
        shouldActivatePrReviewFileNode(completedGesture, currentShape)
      ) {
        onFileSelect?.(completedGesture.reviewFileId);
      }
    };

    editor.on("event", handleEditorEvent);
    return () => {
      editor.off("event", handleEditorEvent);
    };
  }, [editor, onFileSelect]);

  return null;
}

type PrReviewCanvasPersistenceNotice = {
  message: string;
  tone: "info" | "error";
} | null;

function PrReviewCanvasPersistenceBridge({
  apiClient,
  enabled,
  hydratingRef,
  internalShapeUpdateRef,
  lastSyncedGeometryRef,
  onNotice,
  storedShapes,
  workspaceId
}: {
  apiClient: PrReviewApiClient;
  enabled: boolean;
  hydratingRef: MutableRefObject<boolean>;
  internalShapeUpdateRef: MutableRefObject<boolean>;
  lastSyncedGeometryRef: MutableRefObject<Map<string, string>>;
  onNotice: (notice: PrReviewCanvasPersistenceNotice) => void;
  storedShapes: PrReviewCanvasShape[];
  workspaceId: string;
}) {
  const editor = useEditor();
  const storedShapeByIdRef = useRef(new Map<string, PrReviewCanvasShape>());
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
            h: latest.height ?? current.props.h
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
        for (const shape of editor.getCurrentPageShapes()) {
          if (!isPrReviewFileNodeShape(shape)) {
            continue;
          }

          const snapshot = toPrReviewFileShapeSnapshot(shape);
          const geometryKey = getPrReviewFileShapeGeometryKey(snapshot);
          if (lastSyncedGeometryRef.current.get(shape.id) === geometryKey) {
            continue;
          }

          pendingShapes.set(shape.id, snapshot);
          hasChangedFile = true;
        }

        if (!hasChangedFile) {
          return;
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
  onFileSelect,
  preparedConflictFileIds = new Set<string>(),
  reviewRoomId,
  selectedReviewFileId,
  workspaceId
}: PrReviewCanvasSurfaceProps) {
  const editorRef = useRef<Editor | null>(null);
  const allowFileGeometryRef = useRef(false);
  const hydratingRef = useRef(false);
  const internalShapeUpdateRef = useRef(false);
  const lastSyncedGeometryRef = useRef(new Map<string, string>());
  const selectedReviewFileIdRef = useRef<string | null>(
    selectedReviewFileId ?? null
  );
  const [storedShapes, setStoredShapes] = useState<
    PrReviewCanvasShape[] | null
  >(null);
  const [persistenceNotice, setPersistenceNotice] =
    useState<PrReviewCanvasPersistenceNotice>(null);
  const persistedFileShapeEnabled = Boolean(
    storedShapes?.some(isPrReviewCanvasFileShape)
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
    () => buildStoredPrReviewCanvasShapes(storedShapes ?? []),
    [storedShapes]
  );
  const shapes = persistedFileShapeEnabled
    ? persistedShapes
    : storedShapes === null
      ? []
      : fallbackShapes;
  const handlePersistenceNotice = useCallback(
    (notice: PrReviewCanvasPersistenceNotice) => {
      setPersistenceNotice(notice);
    },
    []
  );

  allowFileGeometryRef.current = persistedFileShapeEnabled;

  useEffect(() => {
    const abortController = new AbortController();
    setStoredShapes(null);
    setPersistenceNotice(null);

    void apiClient
      .getReviewRoom(workspaceId, reviewRoomId, {
        signal: abortController.signal
      })
      .then((room) =>
        apiClient.listReviewCanvasShapes(
          workspaceId,
          room.canvasId,
          PR_REVIEW_CANVAS_LOAD_QUERY,
          { signal: abortController.signal }
        )
      )
      .then((loadedShapes) => {
        if (abortController.signal.aborted) {
          return;
        }

        setStoredShapes(loadedShapes.filter(isPrReviewCanvasSystemShape));
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          return;
        }

        setStoredShapes([]);
        setPersistenceNotice({
          message: "저장된 노드 배치를 불러오지 못해 기본 배치를 표시합니다.",
          tone: "error"
        });
      });

    return () => abortController.abort();
  }, [apiClient, canvas.reviewSessionId, reviewRoomId, workspaceId]);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
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
        lastSyncedGeometryRef
      );
      if (persistedFileShapeEnabled) {
        syncPrReviewFileNodeMetadata(
          editor,
          canvas,
          conflictAnalysis,
          preparedConflictFileIds,
          internalShapeUpdateRef
        );
        updatePrReviewRelationGeometry(editor, internalShapeUpdateRef);
      }
    },
    [
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
      updatePrReviewRelationGeometry(
        editorRef.current,
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
        <PrReviewFileNodeActivationBridge onFileSelect={onFileSelect} />
        <PrReviewCanvasPersistenceBridge
          apiClient={apiClient}
          enabled={persistedFileShapeEnabled}
          hydratingRef={hydratingRef}
          internalShapeUpdateRef={internalShapeUpdateRef}
          lastSyncedGeometryRef={lastSyncedGeometryRef}
          onNotice={handlePersistenceNotice}
          storedShapes={storedShapes ?? []}
          workspaceId={workspaceId}
        />
      </TldrawSurface>
    </div>
  );
}
