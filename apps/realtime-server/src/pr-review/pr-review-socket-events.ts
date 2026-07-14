export const PR_REVIEW_DECISION_REDIS_CHANNEL = "pr-review:decision-events";
export const PR_REVIEW_DECISION_UPDATED_EVENT = "pr-review:decision:updated";

export type PrReviewDecisionUpdatedEvent = {
  event: typeof PR_REVIEW_DECISION_UPDATED_EVENT;
  workspaceId: string;
  canvasId: string;
  reviewRoomId: string;
  reviewSessionId: string;
  reviewFileId: string;
  roomFileId: string;
  currentStatus:
    | "not_reviewed"
    | "approved"
    | "discussion_needed"
    | "unknown";
  decisionVersion: number;
  reviewedCount: number;
  totalFileCount: number;
  readyToSubmit: boolean;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isReviewStatus(
  value: unknown,
): value is PrReviewDecisionUpdatedEvent["currentStatus"] {
  return (
    value === "not_reviewed" ||
    value === "approved" ||
    value === "discussion_needed" ||
    value === "unknown"
  );
}

export function isPrReviewDecisionUpdatedEvent(
  value: unknown,
): value is PrReviewDecisionUpdatedEvent {
  if (!isRecord(value)) return false;

  return (
    value.event === PR_REVIEW_DECISION_UPDATED_EVENT &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.canvasId) &&
    isNonEmptyString(value.reviewRoomId) &&
    isNonEmptyString(value.reviewSessionId) &&
    isNonEmptyString(value.reviewFileId) &&
    isNonEmptyString(value.roomFileId) &&
    isReviewStatus(value.currentStatus) &&
    isNonNegativeInteger(value.decisionVersion) &&
    isNonNegativeInteger(value.reviewedCount) &&
    isNonNegativeInteger(value.totalFileCount) &&
    value.reviewedCount <= value.totalFileCount &&
    typeof value.readyToSubmit === "boolean" &&
    (value.reviewedByUserId === null ||
      isNonEmptyString(value.reviewedByUserId)) &&
    (value.reviewedAt === null ||
      (typeof value.reviewedAt === "string" &&
        Number.isFinite(Date.parse(value.reviewedAt))))
  );
}
