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
  PrReviewFileRoleType,
  PrReviewFileRiskLevel,
  PrReviewFileReviewStatus,
  PrReviewFileStatus
} from "@/features/pr-review/types";

export const PR_REVIEW_FILE_NODE_SHAPE_TYPE = "pr_review_file_node";
export const PR_REVIEW_FLOW_EDGE_SHAPE_TYPE = "pr_review_flow_edge";
export const PR_REVIEW_RELATION_EDGE_SHAPE_TYPE = "pr_review_relation_edge";
export const PR_REVIEW_FLOW_LABEL_SHAPE_TYPE = "pr_review_flow_label";
export const PR_REVIEW_FLOW_MILESTONE_SHAPE_TYPE = "pr_review_flow_milestone";
export const PR_REVIEW_ROLE_LANE_SHAPE_TYPE = "pr_review_role_lane";

export type PrReviewFileNodeShapeProps = {
  w: number;
  h: number;
  reviewRoomId: string | null;
  roomFileId: string | null;
  currentReviewSessionId: string | null;
  reviewFileId: string;
  reviewSessionId: string;
  reviewFlowFileId: string;
  flowId: string;
  workflowOrder: number;
  fileName: string;
  filePath: string;
  fileStatus: PrReviewFileStatus;
  roleSummary: string | null;
  riskLevel: PrReviewFileRiskLevel;
  reviewStatus: PrReviewFileReviewStatus;
  conflictState: "none" | "unresolved" | "ready" | "unsupported";
  conflictReason: string | null;
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
  kind: "review_order" | "semantic";
};

export type PrReviewRelationEdgeShapeProps = PrReviewFlowEdgeShapeProps & {
  reviewRoomId: string;
  currentReviewSessionId: string;
  fromRoomFileId: string;
  toRoomFileId: string;
  relationType:
    | "review_order"
    | "depends_on"
    | "tests"
    | "uses_api"
    | "passes_data_to"
    | "supports";
  source: "rule" | "ai" | "hybrid" | "fallback";
  confidence: number;
};

export type PrReviewRoleLaneShapeProps = {
  w: number;
  h: number;
  flowId: string;
  roleType: PrReviewFileRoleType;
  label: string;
  description: string;
  fileCount: number;
  labelWidth: number;
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

export type PrReviewFlowMilestoneShapeProps = {
  w: number;
  h: number;
  flowId: string;
  kind: "start" | "end";
  label: string;
  description: string | null;
};

export type PrReviewFileNodeShape = TLBaseShape<
  typeof PR_REVIEW_FILE_NODE_SHAPE_TYPE,
  PrReviewFileNodeShapeProps
>;

export type PrReviewFlowEdgeShape = TLBaseShape<
  typeof PR_REVIEW_FLOW_EDGE_SHAPE_TYPE,
  PrReviewFlowEdgeShapeProps
>;

export type PrReviewRelationEdgeShape = TLBaseShape<
  typeof PR_REVIEW_RELATION_EDGE_SHAPE_TYPE,
  PrReviewRelationEdgeShapeProps
>;

export type PrReviewFlowLabelShape = TLBaseShape<
  typeof PR_REVIEW_FLOW_LABEL_SHAPE_TYPE,
  PrReviewFlowLabelShapeProps
>;

export type PrReviewFlowMilestoneShape = TLBaseShape<
  typeof PR_REVIEW_FLOW_MILESTONE_SHAPE_TYPE,
  PrReviewFlowMilestoneShapeProps
>;

export type PrReviewRoleLaneShape = TLBaseShape<
  typeof PR_REVIEW_ROLE_LANE_SHAPE_TYPE,
  PrReviewRoleLaneShapeProps
>;

declare module "@tldraw/tlschema" {
  interface TLGlobalShapePropsMap {
    [PR_REVIEW_FILE_NODE_SHAPE_TYPE]: PrReviewFileNodeShapeProps;
    [PR_REVIEW_FLOW_EDGE_SHAPE_TYPE]: PrReviewFlowEdgeShapeProps;
    [PR_REVIEW_RELATION_EDGE_SHAPE_TYPE]: PrReviewRelationEdgeShapeProps;
    [PR_REVIEW_FLOW_LABEL_SHAPE_TYPE]: PrReviewFlowLabelShapeProps;
    [PR_REVIEW_FLOW_MILESTONE_SHAPE_TYPE]: PrReviewFlowMilestoneShapeProps;
    [PR_REVIEW_ROLE_LANE_SHAPE_TYPE]: PrReviewRoleLaneShapeProps;
  }
}

const contractRoleLaneClass =
  "border-cyan-200 bg-cyan-50/55 text-cyan-800";

function getRoleLaneClass(roleType: PrReviewFileRoleType) {
  switch (roleType) {
    case "entry":
      return "border-blue-200 bg-blue-50/55 text-blue-800";
    case "api_contract":
      return contractRoleLaneClass;
    case "core_logic":
      return "border-rose-200 bg-rose-50/45 text-rose-800";
    case "ui_state":
      return "border-violet-200 bg-violet-50/45 text-violet-800";
    case "verification":
      return "border-emerald-200 bg-emerald-50/50 text-emerald-800";
    case "support":
      return "border-amber-200 bg-amber-50/50 text-amber-800";
    case "unknown":
      return "border-slate-200 bg-slate-50/70 text-slate-700";
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

const riskLevelLabels: Record<PrReviewFileRiskLevel, string> = {
  high: "위험 높음",
  medium: "위험 중간",
  low: "위험 낮음",
  unknown: "위험 미확인"
};

const riskNodeClasses: Record<PrReviewFileRiskLevel, string> = {
  high: "border-rose-300 bg-rose-50/95 shadow-rose-100",
  medium: "border-amber-300 bg-amber-50/95 shadow-amber-100",
  low: "border-emerald-300 bg-emerald-50/95 shadow-emerald-100",
  unknown: "border-slate-200 bg-white shadow-slate-100"
};

const riskBadgeClasses: Record<PrReviewFileRiskLevel, string> = {
  high: "border-rose-200 bg-white text-rose-700",
  medium: "border-amber-200 bg-white text-amber-700",
  low: "border-emerald-200 bg-white text-emerald-700",
  unknown: "border-slate-200 bg-white text-slate-600"
};

const conflictNodeClasses: Record<
  Exclude<PrReviewFileNodeShapeProps["conflictState"], "none">,
  string
> = {
  unresolved: "border-rose-400 bg-rose-50/95 shadow-rose-100",
  ready: "border-emerald-400 bg-emerald-50/95 shadow-emerald-100",
  unsupported: "border-amber-400 bg-amber-50/95 shadow-amber-100"
};

const conflictBadgeLabels: Record<
  Exclude<PrReviewFileNodeShapeProps["conflictState"], "none">,
  string
> = {
  unresolved: "conflict",
  ready: "해결 준비",
  unsupported: "unsupported"
};

const conflictBadgeClasses: Record<
  Exclude<PrReviewFileNodeShapeProps["conflictState"], "none">,
  string
> = {
  unresolved: "border-rose-200 bg-white text-rose-700",
  ready: "border-emerald-200 bg-white text-emerald-700",
  unsupported: "border-amber-200 bg-white text-amber-700"
};

function getEdgePathData(
  shape: PrReviewFlowEdgeShape | PrReviewRelationEdgeShape
) {
  const { startX, startY, endX, endY } = shape.props;
  if (startX === endX || startY === endY) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }

  const midX = startX + (endX - startX) / 2;

  return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
}

export function isPrReviewFileNodeShape(
  shape: TLShape | null | undefined
): shape is PrReviewFileNodeShape {
  return shape?.type === PR_REVIEW_FILE_NODE_SHAPE_TYPE;
}

function PrReviewFileNode({ shape }: { shape: PrReviewFileNodeShape }) {
  const conflictState =
    shape.props.conflictState === "none" ? null : shape.props.conflictState;

  return (
    <HTMLContainer
      className="overflow-visible rounded-lg"
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      <article
        className={cn(
          "flex h-full w-full flex-col justify-between rounded-md border-2 px-4 py-3 shadow-sm",
          conflictState
            ? conflictNodeClasses[conflictState]
            : riskNodeClasses[shape.props.riskLevel]
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
          <div className="flex shrink-0 items-center gap-1">
            {conflictState ? (
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 font-semibold",
                  conflictBadgeClasses[conflictState]
                )}
                title={shape.props.conflictReason ?? undefined}
              >
                {conflictBadgeLabels[conflictState]}
              </span>
            ) : null}
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 font-semibold",
                riskBadgeClasses[shape.props.riskLevel]
              )}
            >
              {riskLevelLabels[shape.props.riskLevel]}
            </span>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 font-medium",
                reviewStatusClasses[shape.props.reviewStatus]
              )}
            >
              {reviewStatusLabels[shape.props.reviewStatus]}
            </span>
          </div>
        </div>
      </article>
    </HTMLContainer>
  );
}

function PrReviewFlowEdge({
  shape
}: {
  shape: PrReviewFlowEdgeShape | PrReviewRelationEdgeShape;
}) {
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
        stroke={
          shape.props.kind === "review_order"
            ? "rgba(37, 99, 235, 0.78)"
            : "rgba(71, 85, 105, 0.52)"
        }
        strokeDasharray={shape.props.kind === "semantic" ? "8 7" : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={shape.props.kind === "review_order" ? "3" : "2"}
      />
      <polygon
        fill={
          shape.props.kind === "review_order"
            ? "rgba(37, 99, 235, 0.78)"
            : "rgba(71, 85, 105, 0.58)"
        }
        points={arrowPoints}
      />
    </SVGContainer>
  );
}

function PrReviewRoleLane({ shape }: { shape: PrReviewRoleLaneShape }) {
  return (
    <HTMLContainer
      className="overflow-visible"
      style={{
        height: shape.props.h,
        pointerEvents: "none",
        width: shape.props.w
      }}
    >
      <div
        className={cn(
          "flex h-full w-full border-y bg-white/55",
          getRoleLaneClass(shape.props.roleType)
        )}
      >
        <div
          className="flex shrink-0 flex-col justify-center border-r border-current/15 px-4"
          style={{ width: shape.props.labelWidth }}
        >
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold leading-5">{shape.props.label}</p>
            <span className="text-xs font-medium opacity-70">
              {shape.props.fileCount}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-4 opacity-70">
            {shape.props.description}
          </p>
        </div>
      </div>
    </HTMLContainer>
  );
}

function PrReviewFlowLabel({ shape }: { shape: PrReviewFlowLabelShape }) {
  return (
    <HTMLContainer style={{ width: shape.props.w, height: shape.props.h }}>
      <div className="flex h-full min-w-0 flex-col justify-center overflow-hidden">
        <p className="text-xs font-semibold uppercase text-blue-600">
          Flow {shape.props.sortOrder} · {shape.props.fileCount}개 파일
        </p>
        <h2 className="mt-1 line-clamp-2 break-words text-lg font-semibold leading-6 text-slate-950">
          {shape.props.title}
        </h2>
        {shape.props.description ? (
          <p className="mt-2 line-clamp-2 break-words text-sm leading-5 text-slate-600">
            {shape.props.description}
          </p>
        ) : null}
      </div>
    </HTMLContainer>
  );
}

function PrReviewFlowMilestone({
  shape
}: {
  shape: PrReviewFlowMilestoneShape;
}) {
  return (
    <HTMLContainer
      className="overflow-visible"
      style={{ width: shape.props.w, height: shape.props.h }}
    >
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center rounded-full border-2 px-5 text-center shadow-sm",
          shape.props.kind === "start"
            ? "border-blue-300 bg-blue-50 text-blue-950"
            : "border-slate-300 bg-white text-slate-950"
        )}
      >
        <p className="text-sm font-semibold leading-5">{shape.props.label}</p>
        {shape.props.description ? (
          <p className="mt-0.5 text-xs leading-4 text-slate-500">
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
    reviewRoomId: T.nullable(T.string),
    roomFileId: T.nullable(T.string),
    currentReviewSessionId: T.nullable(T.string),
    reviewFileId: T.string,
    reviewSessionId: T.string,
    reviewFlowFileId: T.string,
    flowId: T.string,
    workflowOrder: T.number,
    fileName: T.string,
    filePath: T.string,
    fileStatus: T.literalEnum("added", "modified", "deleted", "renamed"),
    roleSummary: T.nullable(T.string),
    riskLevel: T.literalEnum("high", "medium", "low", "unknown"),
    reviewStatus: T.literalEnum(
      "not_reviewed",
      "approved",
      "discussion_needed",
      "unknown"
    ),
    conflictState: T.literalEnum(
      "none",
      "unresolved",
      "ready",
      "unsupported"
    ),
    conflictReason: T.nullable(T.string)
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
      reviewRoomId: null,
      roomFileId: null,
      currentReviewSessionId: null,
      reviewFileId: "",
      reviewSessionId: "",
      reviewFlowFileId: "",
      flowId: "",
      workflowOrder: 0,
      fileName: "",
      filePath: "",
      fileStatus: "modified",
      roleSummary: null,
      riskLevel: "unknown",
      reviewStatus: "not_reviewed",
      conflictState: "none",
      conflictReason: null
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
    reason: T.string,
    kind: T.literalEnum("review_order", "semantic")
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
      reason: "",
      kind: "review_order"
    };
  }

  override getGeometry(shape: PrReviewFlowEdgeShape) {
    const { startX, startY, endX, endY } = shape.props;
    if (startX === endX || startY === endY) {
      return new Polyline2d({
        points: [new Vec(startX, startY), new Vec(endX, endY)]
      });
    }

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

export class PrReviewRelationEdgeShapeUtil extends ShapeUtil<PrReviewRelationEdgeShape> {
  static override type = PR_REVIEW_RELATION_EDGE_SHAPE_TYPE;

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
    reason: T.string,
    kind: T.literalEnum("review_order", "semantic"),
    reviewRoomId: T.string,
    currentReviewSessionId: T.string,
    fromRoomFileId: T.string,
    toRoomFileId: T.string,
    relationType: T.literalEnum(
      "review_order",
      "depends_on",
      "tests",
      "uses_api",
      "passes_data_to",
      "supports"
    ),
    source: T.literalEnum("rule", "ai", "hybrid", "fallback"),
    confidence: T.number
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

  override getDefaultProps(): PrReviewRelationEdgeShape["props"] {
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
      reason: "",
      kind: "semantic",
      reviewRoomId: "",
      currentReviewSessionId: "",
      fromRoomFileId: "",
      toRoomFileId: "",
      relationType: "depends_on",
      source: "hybrid",
      confidence: 0
    };
  }

  override getGeometry(shape: PrReviewRelationEdgeShape) {
    const { startX, startY, endX, endY } = shape.props;
    if (startX === endX || startY === endY) {
      return new Polyline2d({
        points: [new Vec(startX, startY), new Vec(endX, endY)]
      });
    }

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

  override component(shape: PrReviewRelationEdgeShape) {
    return <PrReviewFlowEdge shape={shape} />;
  }

  override getIndicatorPath(shape: PrReviewRelationEdgeShape) {
    return new Path2D(getEdgePathData(shape));
  }
}

export class PrReviewRoleLaneShapeUtil extends ShapeUtil<PrReviewRoleLaneShape> {
  static override type = PR_REVIEW_ROLE_LANE_SHAPE_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    flowId: T.string,
    roleType: T.literalEnum(
      "entry",
      "core_logic",
      "api_contract",
      "ui_state",
      "verification",
      "support",
      "unknown"
    ),
    label: T.string,
    description: T.string,
    fileCount: T.number,
    labelWidth: T.number
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

  override getDefaultProps(): PrReviewRoleLaneShape["props"] {
    return {
      w: 640,
      h: 152,
      flowId: "",
      roleType: "unknown",
      label: "",
      description: "",
      fileCount: 0,
      labelWidth: 152
    };
  }

  override getGeometry(shape: PrReviewRoleLaneShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: false
    });
  }

  override component(shape: PrReviewRoleLaneShape) {
    return <PrReviewRoleLane shape={shape} />;
  }

  override getIndicatorPath(shape: PrReviewRoleLaneShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);

    return path;
  }
}

export class PrReviewFlowMilestoneShapeUtil extends ShapeUtil<PrReviewFlowMilestoneShape> {
  static override type = PR_REVIEW_FLOW_MILESTONE_SHAPE_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    flowId: T.string,
    kind: T.literalEnum("start", "end"),
    label: T.string,
    description: T.nullable(T.string)
  };

  override canBind() {
    return false;
  }

  override canResize() {
    return false;
  }

  override getDefaultProps(): PrReviewFlowMilestoneShape["props"] {
    return {
      w: 176,
      h: 72,
      flowId: "",
      kind: "start",
      label: "",
      description: null
    };
  }

  override getGeometry(shape: PrReviewFlowMilestoneShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true
    });
  }

  override component(shape: PrReviewFlowMilestoneShape) {
    return <PrReviewFlowMilestone shape={shape} />;
  }

  override getIndicatorPath(shape: PrReviewFlowMilestoneShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, shape.props.h / 2);

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
      w: 640,
      h: 128,
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
