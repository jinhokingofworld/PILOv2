"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  createShapeId,
  useEditor,
  type Editor,
  type TLShapeId,
  type TLShapePartial
} from "tldraw";
import { useValue } from "@tldraw/state-react";

import { TldrawSurface } from "@/shared/tldraw/TldrawSurface";
import type {
  PrReviewCanvas,
  PrReviewCanvasFlow,
  PrReviewConflictAnalysis,
  PrReviewFlowFile
} from "@/features/pr-review/types";
import { PrReviewCanvasBackground } from "@/features/pr-review/components/review-canvas/PrReviewCanvasBackground";
import {
  PR_REVIEW_FILE_NODE_SHAPE_TYPE,
  PR_REVIEW_FLOW_EDGE_SHAPE_TYPE,
  PR_REVIEW_FLOW_LABEL_SHAPE_TYPE,
  PR_REVIEW_FLOW_MILESTONE_SHAPE_TYPE,
  PR_REVIEW_ROLE_LANE_SHAPE_TYPE,
  isPrReviewFileNodeShape,
  type PrReviewFileNodeShape,
  type PrReviewFlowEdgeShape,
  type PrReviewFlowLabelShape,
  type PrReviewFlowMilestoneShape,
  type PrReviewRoleLaneShape
} from "@/features/pr-review/components/review-canvas/PrReviewFileNodeShapeUtil";
import { prReviewShapeUtils } from "@/features/pr-review/components/review-canvas/pr-review-shape-utils";
import {
  buildPrReviewFileColumnMap,
  buildPrReviewRoleLanes,
  sortPrReviewFlowFiles,
  type PrReviewRoleLane
} from "@/features/pr-review/components/review-canvas/pr-review-flow-layout";

type PrReviewCanvasSurfaceProps = {
  canvas: PrReviewCanvas;
  className?: string;
  conflictAnalysis?: PrReviewConflictAnalysis | null;
  onFileSelect?: (reviewFileId: string | null) => void;
  preparedConflictFileIds?: Set<string>;
  selectedReviewFileId?: string | null;
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

const prReviewTldrawComponents = {
  Background: PrReviewCanvasBackground
};

const prReviewShapeTypes = new Set<string>([
  PR_REVIEW_FILE_NODE_SHAPE_TYPE,
  PR_REVIEW_FLOW_EDGE_SHAPE_TYPE,
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
  selectedReviewFileId: string | null | undefined
) {
  const existingShapeIds = editor
    .getCurrentPageShapes()
    .map((shape) => shape.id as TLShapeId);

  if (existingShapeIds.length) {
    editor.deleteShapes(existingShapeIds);
  }

  if (!shapes.length) {
    editor.selectNone();
    return;
  }

  editor.createShapes(shapes);
  selectReviewFileNode(editor, selectedReviewFileId);
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

function registerReadOnlyReviewShapes(editor: Editor) {
  editor.sideEffects.registerBeforeChangeHandler("shape", (prev, next) => {
    if (prReviewShapeTypes.has(next.type)) {
      return prev;
    }

    return next;
  });
}

function PrReviewSelectionBridge({
  onFileSelect
}: {
  onFileSelect?: (reviewFileId: string | null) => void;
}) {
  const editor = useEditor();
  const selectedReviewFileId = useValue(
    "pr-review-selected-shape",
    () => {
      const selectedShape = editor.getOnlySelectedShape();

      return isPrReviewFileNodeShape(selectedShape)
        ? selectedShape.props.reviewFileId
        : null;
    },
    [editor]
  );

  useEffect(() => {
    onFileSelect?.(selectedReviewFileId);
  }, [onFileSelect, selectedReviewFileId]);

  return null;
}

export function PrReviewCanvasSurface({
  canvas,
  className,
  conflictAnalysis,
  onFileSelect,
  preparedConflictFileIds = new Set<string>(),
  selectedReviewFileId
}: PrReviewCanvasSurfaceProps) {
  const editorRef = useRef<Editor | null>(null);
  const selectedReviewFileIdRef = useRef<string | null>(
    selectedReviewFileId ?? null
  );
  const shapes = useMemo(
    () =>
      buildPrReviewCanvasShapes(
        canvas,
        conflictAnalysis,
        preparedConflictFileIds
      ),
    [canvas, conflictAnalysis, preparedConflictFileIds]
  );
  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      editor.setCurrentTool("select.idle");
      registerReadOnlyReviewShapes(editor);
      resetPrReviewCanvas(editor, shapes, selectedReviewFileIdRef.current);
    },
    [shapes]
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
      selectedReviewFileIdRef.current
    );
  }, [shapes]);

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }

    selectReviewFileNode(editorRef.current, selectedReviewFileId);
  }, [selectedReviewFileId]);

  return (
    <TldrawSurface
      className={className}
      components={prReviewTldrawComponents}
      hideUi
      onMount={handleMount}
      shapeUtils={prReviewShapeUtils}
    >
      <PrReviewSelectionBridge onFileSelect={onFileSelect} />
    </TldrawSurface>
  );
}
