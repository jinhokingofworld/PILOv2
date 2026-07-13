import {
  PrReviewFileNodeShapeUtil,
  PrReviewFlowEdgeShapeUtil,
  PrReviewFlowLabelShapeUtil,
  PrReviewFlowMilestoneShapeUtil,
  PrReviewRelationEdgeShapeUtil,
  PrReviewRoleLaneShapeUtil
} from "@/features/pr-review/components/review-canvas/PrReviewFileNodeShapeUtil";

export const prReviewShapeUtils = [
  PrReviewRoleLaneShapeUtil,
  PrReviewRelationEdgeShapeUtil,
  PrReviewFlowEdgeShapeUtil,
  PrReviewFlowLabelShapeUtil,
  PrReviewFlowMilestoneShapeUtil,
  PrReviewFileNodeShapeUtil
];
