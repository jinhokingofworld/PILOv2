"use client";

import {
  HTMLContainer,
  Polyline2d,
  Rectangle2d,
  SVGContainer,
  ShapeUtil,
  T,
  Vec,
  type TLBaseShape,
  type TLShape
} from "tldraw";

import { cn } from "@/lib/utils";
import type {
  PrReviewFileReviewStatus,
  PrReviewFileStatus
} from "@/features/pr-review/types";

export const PR_REVIEW_FILE_NODE_SHAPE_TYPE = "pr_review_file_node";
export const PR_REVIEW_FLOW_EDGE_SHAPE_TYPE = "pr_review_flow_edge";
export const PR_REVIEW_FLOW_LABEL_SHAPE_TYPE = "pr_review_flow_label";

export type PrReviewFileNodeShapeProps = {
  w: number;
  h: number;
  reviewFileId: string;
  reviewSessionId: string;
  reviewFlowFileId: string;
  flowId: string;
  workflowOrder: number;
  fileName: string;
  filePath: string;
  fileStatus: PrReviewFileStatus;
  roleSummary: string | null;
  reviewStatus: PrReviewFileReviewStatus;
};

export type PrReviewFlowEdgeShapeProps = {
  w: number;
  h: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  fromReviewFileId: string;
  toReviewFileId: string;
  flowId: string;
  reason: string;
};

export type PrReviewFlowLabelShapeProps = {
  w: number;
  h: number;
  flowId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  fileCount: number;
};

export type PrReviewFileNodeShape = TLBaseShape<
  typeof PR_REVIEW_FILE_NODE_SHAPE_TYPE,
  PrReviewFileNodeShapeProps
>;

export type PrReviewFlowEdgeShape = TLBaseShape<
  typeof PR_REVIEW_FLOW_EDGE_SHAPE_TYPE,
  PrReviewFlowEdgeShapeProps
>;

export type PrReviewFlowLabelShape = TLBaseShape<
  typeof PR_REVIEW_FLOW_LABEL_SHAPE_TYPE,
  PrReviewFlowLabelShapeProps
>;

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    [PR_REVIEW_FILE_NODE_SHAPE_TYPE]: PrReviewFileNodeShapeProps;
    [PR_REVIEW_FLOW_EDGE_SHAPE_TYPE]: PrReviewFlowEdgeShapeProps;
    [PR_REVIEW_FLOW_LABEL_SHAPE_TYPE]: PrReviewFlowLabelShapeProps;
  }
}

const fileStatusLabels: Record<PrReviewFileStatus, string> = {
  added: "added",
  deleted: "deleted",
  modified: "modified",
  renamed: "renamed"
};

const reviewStatusLabels: Record<PrReviewFileReviewStatus, string> = {
  approved: "approved",
  discussion_needed: "discuss",
  not_reviewed: "not reviewed",
  unknown: "unknown"
};

const reviewStatusClasses: Record<PrReviewFileReviewStatus, string> = {
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  discussion_needed: "border-amber-200 bg-amber-50 text-amber-700",
  not_reviewed: "border-slate-200 bg-slate-100 text-slate-600",
  unknown: "border-violet-200 bg-violet-50 text-violet-700"
};

function getEdgePathData(shape: PrReviewFlowEdgeShape) {
  const { startX, startY, endX, endY } = shape.props;
  const midX = startX + (endX - startX) / 2;

  return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
}

export function isPrReviewFileNodeShape(
  shape: TLShape | null | undefined
): shape is PrReviewFileNodeShape {
  return shape?.type === PR_REVIEW_FILE_NODE_SHAPE_TYPE;
}

function PrReviewFileNode({ shape }: { shape: PrReviewFileNodeShape }) {
  return (
    <HTMLContainer
      className="overflow-visible rounded-lg"
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      <article
        className={cn(
          "flex h-full w-full flex-col justify-between rounded-lg border-2 bg-white px-4 py-3 shadow-sm",
          shape.props.reviewStatus === "discussion_needed"
            ? "border-amber-300"
            : shape.props.reviewStatus === "approved"
              ? "border-emerald-300"
              : "border-blue-200"
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
            {shape.props.workflowOrder}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-950">
              {shape.props.fileName}
            </h3>
            <p className="mt-1 truncate text-xs text-slate-500">
              {shape.props.filePath}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
          <span className="truncate font-medium text-slate-600">
            {shape.props.roleSummary || fileStatusLabels[shape.props.fileStatus]}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 font-medium",
              reviewStatusClasses[shape.props.reviewStatus]
            )}
          >
            {reviewStatusLabels[shape.props.reviewStatus]}
          </span>
        </div>
      </article>
    </HTMLContainer>
  );
}

function PrReviewFlowEdge({ shape }: { shape: PrReviewFlowEdgeShape }) {
  const path = getEdgePathData(shape);
  const arrowSize = 7;
  const { endX, endY, startX, startY } = shape.props;
  const horizontalDirection = endX >= startX ? 1 : -1;
  const verticalDirection = endY === startY ? 0 : endY > startY ? 1 : -1;
  const arrowPoints =
    verticalDirection === 0
      ? `${endX},${endY} ${endX - arrowSize * horizontalDirection},${endY - arrowSize} ${endX - arrowSize * horizontalDirection},${endY + arrowSize}`
      : `${endX},${endY} ${endX - arrowSize},${endY - arrowSize * verticalDirection} ${endX + arrowSize},${endY - arrowSize * verticalDirection}`;

  return (
    <SVGContainer style={{ overflow: "visible" }}>
      <path
        d={path}
        fill="none"
        stroke="rgba(71, 85, 105, 0.78)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.25"
      />
      <polygon fill="rgba(71, 85, 105, 0.78)" points={arrowPoints} />
    </SVGContainer>
  );
}

function PrReviewFlowLabel({ shape }: { shape: PrReviewFlowLabelShape }) {
  return (
    <HTMLContainer style={{ width: shape.props.w, height: shape.props.h }}>
      <div className="flex h-full flex-col justify-center">
        <p className="text-xs font-semibold uppercase text-blue-600">
          Flow {shape.props.sortOrder}
        </p>
        <h2 className="mt-1 truncate text-lg font-semibold text-slate-950">
          {shape.props.title}
        </h2>
        {shape.props.description ? (
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-600">
            {shape.props.description}
          </p>
        ) : null}
      </div>
    </HTMLContainer>
  );
}

export class PrReviewFileNodeShapeUtil extends ShapeUtil<PrReviewFileNodeShape> {
  static override type = PR_REVIEW_FILE_NODE_SHAPE_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    reviewFileId: T.string,
    reviewSessionId: T.string,
    reviewFlowFileId: T.string,
    flowId: T.string,
    workflowOrder: T.number,
    fileName: T.string,
    filePath: T.string,
    fileStatus: T.literalEnum("added", "modified", "deleted", "renamed"),
    roleSummary: T.nullable(T.string),
    reviewStatus: T.literalEnum(
      "not_reviewed",
      "approved",
      "discussion_needed",
      "unknown"
    )
  };

  override canBind() {
    return false;
  }

  override canResize() {
    return false;
  }

  override getDefaultProps(): PrReviewFileNodeShape["props"] {
    return {
      w: 260,
      h: 96,
      reviewFileId: "",
      reviewSessionId: "",
      reviewFlowFileId: "",
      flowId: "",
      workflowOrder: 0,
      fileName: "",
      filePath: "",
      fileStatus: "modified",
      roleSummary: null,
      reviewStatus: "not_reviewed"
    };
  }

  override getGeometry(shape: PrReviewFileNodeShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true
    });
  }

  override component(shape: PrReviewFileNodeShape) {
    return <PrReviewFileNode shape={shape} />;
  }

  override getIndicatorPath(shape: PrReviewFileNodeShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 8);

    return path;
  }
}

export class PrReviewFlowEdgeShapeUtil extends ShapeUtil<PrReviewFlowEdgeShape> {
  static override type = PR_REVIEW_FLOW_EDGE_SHAPE_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    startX: T.number,
    startY: T.number,
    endX: T.number,
    endY: T.number,
    fromReviewFileId: T.string,
    toReviewFileId: T.string,
    flowId: T.string,
    reason: T.string
  };

  override canBind() {
    return false;
  }

  override canResize() {
    return false;
  }

  override hideSelectionBoundsBg() {
    return true;
  }

  override hideSelectionBoundsFg() {
    return true;
  }

  override getDefaultProps(): PrReviewFlowEdgeShape["props"] {
    return {
      w: 1,
      h: 1,
      startX: 0,
      startY: 0,
      endX: 1,
      endY: 1,
      fromReviewFileId: "",
      toReviewFileId: "",
      flowId: "",
      reason: ""
    };
  }

  override getGeometry(shape: PrReviewFlowEdgeShape) {
    const { startX, startY, endX, endY } = shape.props;
    const midX = startX + (endX - startX) / 2;

    return new Polyline2d({
      points: [
        new Vec(startX, startY),
        new Vec(midX, startY),
        new Vec(midX, endY),
        new Vec(endX, endY)
      ]
    });
  }

  override component(shape: PrReviewFlowEdgeShape) {
    return <PrReviewFlowEdge shape={shape} />;
  }

  override getIndicatorPath(shape: PrReviewFlowEdgeShape) {
    const path = new Path2D(getEdgePathData(shape));

    return path;
  }
}

export class PrReviewFlowLabelShapeUtil extends ShapeUtil<PrReviewFlowLabelShape> {
  static override type = PR_REVIEW_FLOW_LABEL_SHAPE_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    flowId: T.string,
    title: T.string,
    description: T.nullable(T.string),
    sortOrder: T.number,
    fileCount: T.number
  };

  override canBind() {
    return false;
  }

  override canResize() {
    return false;
  }

  override hideSelectionBoundsBg() {
    return true;
  }

  override hideSelectionBoundsFg() {
    return true;
  }

  override getDefaultProps(): PrReviewFlowLabelShape["props"] {
    return {
      w: 360,
      h: 72,
      flowId: "",
      title: "",
      description: null,
      sortOrder: 0,
      fileCount: 0
    };
  }

  override getGeometry(shape: PrReviewFlowLabelShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: false
    });
  }

  override component(shape: PrReviewFlowLabelShape) {
    return <PrReviewFlowLabel shape={shape} />;
  }

  override getIndicatorPath(shape: PrReviewFlowLabelShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);

    return path;
  }
}
