import type { ActivityLogInput } from "../../common/activity-log.service";

interface PrReviewActivityLogContext {
  currentUserId: string;
  workspaceId: string;
}

interface BuildPrReviewSessionCreatedActivityLogInput
  extends PrReviewActivityLogContext {
  pullRequestId: string;
  reviewSessionId: string;
}

interface BuildFileReviewDecisionCreatedActivityLogInput
  extends PrReviewActivityLogContext {
  decision: "approved" | "discussion_needed" | "unknown";
  decisionId: string;
  filePath: string;
  reviewFileId: string;
  reviewSessionId: string;
}

interface BuildReviewSubmissionTerminalActivityLogInput
  extends PrReviewActivityLogContext {
  reviewSessionId: string;
  submissionId: string;
  terminal: "submitted" | "failed";
}

interface BuildPrReviewConflictResolutionAppliedActivityLogInput
  extends PrReviewActivityLogContext {
  commitSha: string;
  conflictStatusAfter: "checking" | "clean" | "conflicted" | "unknown";
  headShaAfter: string;
  pullRequestId: string;
  resolvedFileCount: number;
  reviewSessionId: string;
}

interface BuildPrReviewPullRequestMergedActivityLogInput
  extends PrReviewActivityLogContext {
  mergeCommitSha: string;
  mergeMethod: "merge";
  pullRequestId: string;
  reviewSessionId: string;
}

const REVIEW_DECISION_SUMMARY_LABELS = {
  approved: "승인",
  discussion_needed: "추가 논의 필요",
  unknown: "미정"
} as const;

const ACTIVITY_FILE_PATH_MAX_LENGTH = 400;

export function buildPrReviewSessionCreatedActivityLog(
  input: BuildPrReviewSessionCreatedActivityLogInput
): ActivityLogInput {
  return {
    workspaceId: input.workspaceId,
    actor: { type: "user", userId: input.currentUserId },
    action: "pr_review_session_created",
    target: { type: "pr_review_session", id: input.reviewSessionId },
    dedupeKey: `pr-review:pr_review_session_created:${input.reviewSessionId}:created`,
    metadata: {
      version: 1,
      summary: "새 PR Review revision을 시작했습니다.",
      data: { pullRequestId: input.pullRequestId }
    }
  };
}

export function buildFileReviewDecisionCreatedActivityLog(
  input: BuildFileReviewDecisionCreatedActivityLogInput
): ActivityLogInput {
  const filePath = normalizeActivityFilePath(input.filePath);

  return {
    workspaceId: input.workspaceId,
    actor: { type: "user", userId: input.currentUserId },
    action: "file_review_decision_created",
    target: { type: "file_review_decision", id: input.decisionId },
    dedupeKey: `pr-review:file_review_decision_created:${input.decisionId}:created`,
    metadata: {
      version: 1,
      summary: `${filePath} 파일의 PR Review 판단을 ${REVIEW_DECISION_SUMMARY_LABELS[input.decision]} 상태로 변경했습니다.`,
      data: {
        reviewSessionId: input.reviewSessionId,
        reviewFileId: input.reviewFileId,
        filePath,
        decision: input.decision
      }
    }
  };
}

function normalizeActivityFilePath(filePath: string): string {
  const normalized = filePath.trim().replace(/\s+/g, " ");
  if (normalized.length <= ACTIVITY_FILE_PATH_MAX_LENGTH) {
    return normalized;
  }
  return `…${normalized.slice(-(ACTIVITY_FILE_PATH_MAX_LENGTH - 1))}`;
}

export function buildReviewSubmissionTerminalActivityLog(
  input: BuildReviewSubmissionTerminalActivityLogInput
): ActivityLogInput {
  const action =
    input.terminal === "submitted"
      ? "review_submission_submitted"
      : "review_submission_failed";
  const summary =
    input.terminal === "submitted"
      ? "GitHub Review 제출을 완료했습니다."
      : "GitHub Review 제출에 실패했습니다.";

  return {
    workspaceId: input.workspaceId,
    actor: { type: "user", userId: input.currentUserId },
    action,
    target: { type: "review_submission", id: input.submissionId },
    dedupeKey: `pr-review:${action}:${input.submissionId}:${input.terminal}`,
    metadata: {
      version: 1,
      summary,
      data: { reviewSessionId: input.reviewSessionId }
    }
  };
}

export function buildPrReviewConflictResolutionAppliedActivityLog(
  input: BuildPrReviewConflictResolutionAppliedActivityLogInput
): ActivityLogInput {
  return {
    workspaceId: input.workspaceId,
    actor: { type: "user", userId: input.currentUserId },
    action: "pr_review_conflict_resolution_applied",
    target: { type: "pull_request", id: input.pullRequestId },
    dedupeKey: `pr-review:pr_review_conflict_resolution_applied:${input.pullRequestId}:${input.commitSha}`,
    metadata: {
      version: 1,
      summary: `PR conflict 파일 ${input.resolvedFileCount}개를 해결했습니다.`,
      data: {
        reviewSessionId: input.reviewSessionId,
        resolvedFileCount: input.resolvedFileCount,
        headShaAfter: input.headShaAfter,
        commitSha: input.commitSha,
        conflictStatusAfter: input.conflictStatusAfter
      }
    }
  };
}

export function buildPrReviewPullRequestMergedActivityLog(
  input: BuildPrReviewPullRequestMergedActivityLogInput
): ActivityLogInput {
  return {
    workspaceId: input.workspaceId,
    actor: { type: "user", userId: input.currentUserId },
    action: "pr_review_pull_request_merged",
    target: { type: "pull_request", id: input.pullRequestId },
    dedupeKey: `pr-review:pr_review_pull_request_merged:${input.pullRequestId}:${input.mergeCommitSha}`,
    metadata: {
      version: 1,
      summary: `PR을 ${input.mergeMethod} 방식으로 병합했습니다.`,
      data: {
        reviewSessionId: input.reviewSessionId,
        mergeMethod: input.mergeMethod,
        mergeCommitSha: input.mergeCommitSha
      }
    }
  };
}
