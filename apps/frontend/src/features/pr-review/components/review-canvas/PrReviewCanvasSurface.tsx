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
  PrReviewFlowFile
} from "@/features/pr-review/types";
import { PrReviewCanvasBackground } from "@/features/pr-review/components/review-canvas/PrReviewCanvasBackground";
import {
  PR_REVIEW_FILE_NODE_SHAPE_TYPE,
  PR_REVIEW_FLOW_EDGE_SHAPE_TYPE,
  PR_REVIEW_FLOW_LABEL_SHAPE_TYPE,
  isPrReviewFileNodeShape,
  type PrReviewFileNodeShape,
  type PrReviewFlowEdgeShape,
  type PrReviewFlowLabelShape
} from "@/features/pr-review/components/review-canvas/PrReviewFileNodeShapeUtil";
import { prReviewShapeUtils } from "@/features/pr-review/components/review-canvas/pr-review-shape-utils";

type PrReviewCanvasSurfaceProps = {
  canvas: PrReviewCanvas;
  className?: string;
  onFileSelect?: (reviewFileId: string | null) => void;
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

const NODE_WIDTH = 268;
const NODE_HEIGHT = 96;
const FLOW_LABEL_WIDTH = 640;
const FLOW_LABEL_HEIGHT = 128;
const CANVAS_PADDING_X = 72;
const CANVAS_PADDING_Y = 56;
const COLUMN_GAP = 72;
const ROW_GAP = 104;
const FLOW_HEADER_GAP = 40;
const FLOW_GAP = 120;
const MAX_COLUMNS = 3;

const prReviewTldrawComponents = {
  Background: PrReviewCanvasBackground
};

const prReviewShapeTypes = new Set<string>([
  PR_REVIEW_FILE_NODE_SHAPE_TYPE,
  PR_REVIEW_FLOW_EDGE_SHAPE_TYPE,
  PR_REVIEW_FLOW_LABEL_SHAPE_TYPE
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

function sortFlowFiles(files: PrReviewCanvasFlow["files"]) {
  return [...files].sort(
    (left, right) =>
      left.workflowOrder - right.workflowOrder ||
      left.reviewFileId.localeCompare(right.reviewFileId)
  );
}

function getColumnCount(fileCount: number) {
  if (fileCount <= 1) {
    return 1;
  }

  if (fileCount <= 4) {
    return 2;
  }

  return MAX_COLUMNS;
}

function getFlowHeight(fileCount: number, columnCount: number) {
  const rowCount = Math.max(1, Math.ceil(fileCount / columnCount));

  return (
    FLOW_LABEL_HEIGHT +
    FLOW_HEADER_GAP +
    rowCount * NODE_HEIGHT +
    Math.max(0, rowCount - 1) * ROW_GAP
  );
}

function createFileNodeShape(
  file: PrReviewFlowFile,
  placement: NodePlacement
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
      reviewStatus: fileNodeData.reviewStatus
    }
  };
}

function createFlowLabelShape(
  flow: PrReviewCanvasFlow,
  y: number
): TLShapePartial<PrReviewFlowLabelShape> {
  return {
    id: createShapeId(`pr-review-flow-${shapeIdSuffix(flow.id)}`),
    type: PR_REVIEW_FLOW_LABEL_SHAPE_TYPE,
    x: CANVAS_PADDING_X,
    y,
    props: {
      w: FLOW_LABEL_WIDTH,
      h: FLOW_LABEL_HEIGHT,
      flowId: flow.id,
      title: flow.title,
      description: flow.description,
      sortOrder: flow.sortOrder,
      fileCount: flow.fileCount
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

function createEdgeShape(
  edge: PrReviewCanvas["edges"][number],
  placementByFlowAndFile: Map<string, NodePlacement>
): TLShapePartial<PrReviewFlowEdgeShape> | null {
  const from = placementByFlowAndFile.get(
    `${edge.flowId}:${edge.fromReviewFileId}`
  );
  const to = placementByFlowAndFile.get(`${edge.flowId}:${edge.toReviewFileId}`);

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
      `pr-review-edge-${shapeIdSuffix(edge.flowId)}-${shapeIdSuffix(
        edge.fromReviewFileId
      )}-${shapeIdSuffix(edge.toReviewFileId)}`
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
      fromReviewFileId: edge.fromReviewFileId,
      toReviewFileId: edge.toReviewFileId,
      flowId: edge.flowId,
      reason: edge.reason
    }
  };
}

function buildPrReviewCanvasShapes(canvas: PrReviewCanvas): TLShapePartial[] {
  const shapes: TLShapePartial[] = [];
  const placementByFlowAndFile = new Map<string, NodePlacement>();
  let nextFlowY = CANVAS_PADDING_Y;

  for (const flow of sortFlows(canvas.flows)) {
    const files = sortFlowFiles(flow.files);
    const columnCount = getColumnCount(files.length);
    const flowHeight = getFlowHeight(files.length, columnCount);

    shapes.push(createFlowLabelShape(flow, nextFlowY));

    files.forEach((file, index) => {
      const row = Math.floor(index / columnCount);
      const column = index % columnCount;
      const rowOffset = row % 2 === 1 ? 32 : 0;
      const placement: NodePlacement = {
        flowId: flow.id,
        reviewFileId: file.reviewFileId,
        x: CANVAS_PADDING_X + rowOffset + column * (NODE_WIDTH + COLUMN_GAP),
        y:
          nextFlowY +
          FLOW_LABEL_HEIGHT +
          FLOW_HEADER_GAP +
          row * (NODE_HEIGHT + ROW_GAP),
        w: NODE_WIDTH,
        h: NODE_HEIGHT
      };

      placementByFlowAndFile.set(`${flow.id}:${file.reviewFileId}`, placement);
      shapes.push(createFileNodeShape(file, placement));
    });

    nextFlowY += flowHeight + FLOW_GAP;
  }

  const edgeShapes = canvas.edges
    .map((edge) => createEdgeShape(edge, placementByFlowAndFile))
    .filter((shape): shape is TLShapePartial<PrReviewFlowEdgeShape> =>
      Boolean(shape)
    );

  return [...edgeShapes, ...shapes];
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
    editor.zoomToFit({ animation: { duration: 160 } });
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
  onFileSelect,
  selectedReviewFileId
}: PrReviewCanvasSurfaceProps) {
  const editorRef = useRef<Editor | null>(null);
  const selectedReviewFileIdRef = useRef<string | null>(
    selectedReviewFileId ?? null
  );
  const shapes = useMemo(() => buildPrReviewCanvasShapes(canvas), [canvas]);
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
