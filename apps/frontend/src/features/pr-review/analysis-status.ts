import type {
  PrReviewAnalysisErrorCode,
  PrReviewSession,
  PrReviewSessionStatus
} from "@/features/pr-review/types";

export const PR_REVIEW_ANALYSIS_POLL_INTERVAL_MS = 2_000;
export const PR_REVIEW_ANALYSIS_DELAY_NOTICE_MS = 5 * 60 * 1_000;

export function shouldPollPrReviewAnalysis(status: PrReviewSessionStatus) {
  return status === "analyzing";
}

export function isPrReviewAnalysisDelayed(
  session: Pick<PrReviewSession, "createdAt" | "status">,
  nowMs = Date.now()
) {
  if (!shouldPollPrReviewAnalysis(session.status)) {
    return false;
  }

  const startedAtMs = Date.parse(session.createdAt);
  return (
    Number.isFinite(startedAtMs) &&
    nowMs - startedAtMs >= PR_REVIEW_ANALYSIS_DELAY_NOTICE_MS
  );
}

export function getPrReviewAnalysisRetryLabel(
  code: PrReviewAnalysisErrorCode | undefined
) {
  return code === "PR_HEAD_CHANGED" ? "새 분석 시작" : "분석 다시 시도";
}
