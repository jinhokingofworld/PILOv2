import {
  PrReviewFileNodeShapeUtil,
  PrReviewFlowEdgeShapeUtil,
  PrReviewFlowLabelShapeUtil,
  PrReviewFlowMilestoneShapeUtil,
  PrReviewRoleLaneShapeUtil
} from "@/features/pr-review/components/review-canvas/PrReviewFileNodeShapeUtil";

export const prReviewShapeUtils = [
  PrReviewRoleLaneShapeUtil,
  PrReviewFlowEdgeShapeUtil,
  PrReviewFlowLabelShapeUtil,
  PrReviewFlowMilestoneShapeUtil,
  PrReviewFileNodeShapeUtil
];
