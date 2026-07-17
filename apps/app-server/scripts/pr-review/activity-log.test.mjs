import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  buildFileReviewDecisionCreatedActivityLog,
  buildPrReviewConflictResolutionAppliedActivityLog,
  buildPrReviewPullRequestMergedActivityLog,
  buildPrReviewSessionCreatedActivityLog,
  buildReviewSubmissionTerminalActivityLog
} = require("../../dist/modules/pr-review/pr-review-activity-log.js");

const currentUserId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const pullRequestId = "33333333-3333-4333-8333-333333333333";
const reviewSessionId = "44444444-4444-4444-8444-444444444444";
const decisionId = "55555555-5555-4555-8555-555555555555";
const reviewFileId = "88888888-8888-4888-8888-888888888888";
const filePath = "apps/app-server/src/modules/pr-review/pr-review.service.ts";

const cases = [
  {
    actual: buildPrReviewSessionCreatedActivityLog({
      currentUserId,
      pullRequestId,
      reviewSessionId,
      workspaceId
    }),
    expected: {
      workspaceId,
      actor: { type: "user", userId: currentUserId },
      action: "pr_review_session_created",
      target: { type: "pr_review_session", id: reviewSessionId },
      dedupeKey: `pr-review:pr_review_session_created:${reviewSessionId}:created`,
      metadata: {
        version: 1,
        summary: "새 PR Review revision을 시작했습니다.",
        data: { pullRequestId }
      }
    }
  },
  {
    actual: buildFileReviewDecisionCreatedActivityLog({
      currentUserId,
      decision: "approved",
      decisionId,
      filePath,
      reviewFileId,
      reviewSessionId,
      workspaceId
    }),
    expected: {
      workspaceId,
      actor: { type: "user", userId: currentUserId },
      action: "file_review_decision_created",
      target: {
        type: "file_review_decision",
        id: decisionId
      },
      dedupeKey:
        "pr-review:file_review_decision_created:55555555-5555-4555-8555-555555555555:created",
      metadata: {
        version: 1,
        summary: `${filePath} 파일의 PR Review 판단을 승인 상태로 변경했습니다.`,
        data: {
          reviewSessionId,
          reviewFileId,
          filePath,
          decision: "approved"
        }
      }
    }
  },
  {
    actual: buildReviewSubmissionTerminalActivityLog({
      currentUserId,
      reviewSessionId,
      submissionId: "66666666-6666-4666-8666-666666666666",
      terminal: "submitted",
      workspaceId
    }),
    expected: {
      workspaceId,
      actor: { type: "user", userId: currentUserId },
      action: "review_submission_submitted",
      target: {
        type: "review_submission",
        id: "66666666-6666-4666-8666-666666666666"
      },
      dedupeKey:
        "pr-review:review_submission_submitted:66666666-6666-4666-8666-666666666666:submitted",
      metadata: {
        version: 1,
        summary: "GitHub Review 제출을 완료했습니다.",
        data: { reviewSessionId }
      }
    }
  },
  {
    actual: buildReviewSubmissionTerminalActivityLog({
      currentUserId,
      reviewSessionId,
      submissionId: "77777777-7777-4777-8777-777777777777",
      terminal: "failed",
      workspaceId
    }),
    expected: {
      workspaceId,
      actor: { type: "user", userId: currentUserId },
      action: "review_submission_failed",
      target: {
        type: "review_submission",
        id: "77777777-7777-4777-8777-777777777777"
      },
      dedupeKey:
        "pr-review:review_submission_failed:77777777-7777-4777-8777-777777777777:failed",
      metadata: {
        version: 1,
        summary: "GitHub Review 제출에 실패했습니다.",
        data: { reviewSessionId }
      }
    }
  },
  {
    actual: buildPrReviewConflictResolutionAppliedActivityLog({
      commitSha: "conflict-resolution-commit-sha",
      conflictStatusAfter: "clean",
      currentUserId,
      headShaAfter: "head-sha-after-conflict-resolution",
      pullRequestId,
      resolvedFileCount: 2,
      reviewSessionId,
      workspaceId
    }),
    expected: {
      workspaceId,
      actor: { type: "user", userId: currentUserId },
      action: "pr_review_conflict_resolution_applied",
      target: { type: "pull_request", id: pullRequestId },
      dedupeKey:
        `pr-review:pr_review_conflict_resolution_applied:${pullRequestId}:conflict-resolution-commit-sha`,
      metadata: {
        version: 1,
        summary: "PR conflict 파일 2개를 해결했습니다.",
        data: {
          reviewSessionId,
          resolvedFileCount: 2,
          headShaAfter: "head-sha-after-conflict-resolution",
          commitSha: "conflict-resolution-commit-sha",
          conflictStatusAfter: "clean"
        }
      }
    }
  },
  {
    actual: buildPrReviewPullRequestMergedActivityLog({
      currentUserId,
      mergeCommitSha: "merge-commit-sha",
      mergeMethod: "merge",
      pullRequestId,
      reviewSessionId,
      workspaceId
    }),
    expected: {
      workspaceId,
      actor: { type: "user", userId: currentUserId },
      action: "pr_review_pull_request_merged",
      target: { type: "pull_request", id: pullRequestId },
      dedupeKey:
        `pr-review:pr_review_pull_request_merged:${pullRequestId}:merge-commit-sha`,
      metadata: {
        version: 1,
        summary: "PR을 merge 방식으로 병합했습니다.",
        data: {
          reviewSessionId,
          mergeMethod: "merge",
          mergeCommitSha: "merge-commit-sha"
        }
      }
    }
  }
];

for (const { actual, expected } of cases) {
  assert.deepEqual(actual, expected);
  assert.ok(actual.metadata.summary.length <= 500);
  assert.match(actual.metadata.summary, /(했습니다|실패했습니다)\.$/);
  assert.doesNotMatch(
    JSON.stringify(actual),
    /comment|reviewBody|resolvedContent|url|rawError/i
  );
}

const longPathActivity = buildFileReviewDecisionCreatedActivityLog({
  currentUserId,
  decision: "discussion_needed",
  decisionId: "99999999-9999-4999-8999-999999999999",
  filePath: `  packages/${"nested/".repeat(70)}final-review-file.ts\n`,
  reviewFileId,
  reviewSessionId,
  workspaceId
});
const boundedFilePath = longPathActivity.metadata.data.filePath;

assert.equal(typeof boundedFilePath, "string");
assert.equal(boundedFilePath.length, 400);
assert.ok(boundedFilePath.startsWith("…"));
assert.ok(boundedFilePath.endsWith("final-review-file.ts"));
assert.doesNotMatch(boundedFilePath, /\s/);
assert.ok(longPathActivity.metadata.summary.length <= 500);
assert.match(
  longPathActivity.metadata.summary,
  /final-review-file\.ts 파일의 PR Review 판단을 추가 논의 필요 상태로 변경했습니다\.$/
);

console.log("PR Review Activity Log builder tests passed.");
