export const PR_REVIEW_DECISION_REDIS_CHANNEL = "pr-review:decision-events";
export const PR_REVIEW_DECISION_UPDATED_EVENT = "pr-review:decision:updated";
export const PR_REVIEW_ROOM_REDIS_CHANNEL = "pr-review:room-events";
export const PR_REVIEW_ROOM_DELETED_EVENT = "pr-review:room:deleted";
export const PR_REVIEW_CONFLICT_DRAFT_REDIS_CHANNEL =
  "pr-review:conflict-draft-events";
export const PR_REVIEW_CONFLICT_DRAFT_UPDATED_EVENT =
  "pr-review:conflict-draft:updated";
export const PR_REVIEW_CONFLICT_DRAFT_INVALIDATED_EVENT =
  "pr-review:conflict-draft:invalidated";
export const PR_REVIEW_CONFLICT_DRAFT_LOCK_CLAIM_EVENT =
  "pr-review:conflict-draft:lock:claim";
export const PR_REVIEW_CONFLICT_DRAFT_LOCK_RELEASE_EVENT =
  "pr-review:conflict-draft:lock:release";
export const PR_REVIEW_CONFLICT_DRAFT_LOCK_ACCEPTED_EVENT =
  "pr-review:conflict-draft:lock:accepted";
export const PR_REVIEW_CONFLICT_DRAFT_LOCK_REJECTED_EVENT =
  "pr-review:conflict-draft:lock:rejected";
export const PR_REVIEW_CONFLICT_DRAFT_LOCK_UPDATED_EVENT =
  "pr-review:conflict-draft:lock:updated";
export const PR_REVIEW_CONFLICT_DRAFT_LOCK_RELEASED_EVENT =
  "pr-review:conflict-draft:lock:released";

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

export type PrReviewRoomDeletedEvent = {
  event: typeof PR_REVIEW_ROOM_DELETED_EVENT;
  workspaceId: string;
  canvasId: string;
  reviewRoomId: string;
};

export type PrReviewConflictDraftUpdatedEvent = {
  event: typeof PR_REVIEW_CONFLICT_DRAFT_UPDATED_EVENT;
  workspaceId: string;
  canvasId: string;
  reviewRoomId: string;
  reviewSessionId: string;
  reviewFileId: string;
  sourceHeadBlobSha: string;
  resolvedContent: string;
  resolutionState: PrReviewConflictDraftResolutionState;
  draftVersion: number;
  updatedByUserId: string;
  updatedAt: string;
};

type PrReviewConflictDraftResolutionChoice =
  | "ai"
  | "pr"
  | "target"
  | "both"
  | "manual";

type PrReviewConflictDraftResolutionState = {
  resolutionChoices: Record<string, PrReviewConflictDraftResolutionChoice>;
  acceptedAiResolvedTexts: Record<string, string>;
  manualResolvedTexts: Record<string, string>;
  suggestion?: PrReviewConflictDraftSuggestion | null;
  isCustomized: boolean;
};

type PrReviewConflictDraftSuggestion = {
  status: "suggested" | "invalid";
  aiSummary: string;
  aiSuggestion: string;
  resolvedHunks: Array<{
    hunkId: string;
    resolvedText: string;
  }>;
  validationMessages: string[];
};

export type PrReviewConflictDraftInvalidatedEvent = {
  event: typeof PR_REVIEW_CONFLICT_DRAFT_INVALIDATED_EVENT;
  workspaceId: string;
  canvasId: string;
  reviewRoomId: string;
  reviewSessionId: string;
  reviewFileIds: string[];
};

export type PrReviewConflictDraftLockPayload = {
  workspaceId: string;
  canvasId: string;
  reviewSessionId: string;
  reviewFileId: string;
};

export type PrReviewConflictDraftLockState = PrReviewConflictDraftLockPayload & {
  ownerUserId: string;
  lockedAt: string;
  expiresAt: string;
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

export function isPrReviewRoomDeletedEvent(
  value: unknown,
): value is PrReviewRoomDeletedEvent {
  return (
    isRecord(value) &&
    value.event === PR_REVIEW_ROOM_DELETED_EVENT &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.canvasId) &&
    isNonEmptyString(value.reviewRoomId)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isConflictDraftResolutionChoice(
  value: unknown,
): value is PrReviewConflictDraftResolutionChoice {
  return (
    value === "ai" ||
    value === "pr" ||
    value === "target" ||
    value === "both" ||
    value === "manual"
  );
}

function isStringRecord(
  value: unknown,
  validateValue: (entry: unknown) => boolean,
): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, entry]) => isNonEmptyString(key) && validateValue(entry),
    )
  );
}

function isPrReviewConflictDraftResolutionState(
  value: unknown,
): value is PrReviewConflictDraftResolutionState {
  return (
    isRecord(value) &&
    isStringRecord(value.resolutionChoices, isConflictDraftResolutionChoice) &&
    isStringRecord(value.acceptedAiResolvedTexts, (entry) => typeof entry === "string") &&
    isStringRecord(value.manualResolvedTexts, (entry) => typeof entry === "string") &&
    (value.suggestion === undefined ||
      value.suggestion === null ||
      isPrReviewConflictDraftSuggestion(value.suggestion)) &&
    typeof value.isCustomized === "boolean"
  );
}

function isPrReviewConflictDraftSuggestion(
  value: unknown,
): value is PrReviewConflictDraftSuggestion {
  return (
    isRecord(value) &&
    (value.status === "suggested" || value.status === "invalid") &&
    typeof value.aiSummary === "string" &&
    typeof value.aiSuggestion === "string" &&
    Array.isArray(value.resolvedHunks) &&
    value.resolvedHunks.every(
      (hunk) =>
        isRecord(hunk) &&
        isNonEmptyString(hunk.hunkId) &&
        typeof hunk.resolvedText === "string",
    ) &&
    Array.isArray(value.validationMessages) &&
    value.validationMessages.every((message) => typeof message === "string")
  );
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

export function isPrReviewConflictDraftRedisEvent(
  value: unknown
): value is PrReviewConflictDraftUpdatedEvent | PrReviewConflictDraftInvalidatedEvent {
  if (!isRecord(value) || !isNonEmptyString(value.workspaceId) || !isNonEmptyString(value.canvasId) || !isNonEmptyString(value.reviewRoomId) || !isNonEmptyString(value.reviewSessionId)) {
    return false;
  }
  if (value.event === PR_REVIEW_CONFLICT_DRAFT_UPDATED_EVENT) {
    return (
      isNonEmptyString(value.reviewFileId) &&
      isNonEmptyString(value.sourceHeadBlobSha) &&
      typeof value.resolvedContent === "string" &&
      isPrReviewConflictDraftResolutionState(value.resolutionState) &&
      isPositiveInteger(value.draftVersion) &&
      isNonEmptyString(value.updatedByUserId) &&
      typeof value.updatedAt === "string" &&
      Number.isFinite(Date.parse(value.updatedAt))
    );
  }
  return (
    value.event === PR_REVIEW_CONFLICT_DRAFT_INVALIDATED_EVENT &&
    isStringList(value.reviewFileIds)
  );
}

export function isPrReviewConflictDraftLockPayload(
  value: unknown
): value is PrReviewConflictDraftLockPayload {
  return (
    isRecord(value) &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.canvasId) &&
    isNonEmptyString(value.reviewSessionId) &&
    isNonEmptyString(value.reviewFileId)
  );
}
