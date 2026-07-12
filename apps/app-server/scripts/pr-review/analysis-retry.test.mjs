import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrReviewService } = require(
  "../../dist/modules/pr-review/pr-review.service.js"
);

const currentUserId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const failedSessionId = "33333333-3333-4333-8333-333333333333";
const pullRequestId = "44444444-4444-4444-8444-444444444444";

function sessionRow(status) {
  return {
    id: failedSessionId,
    pull_request_id: pullRequestId,
    created_by_user_id: currentUserId,
    head_sha: "old-head-sha",
    status,
    pr_purpose: null,
    change_summary: [],
    recommended_review_order: null,
    caution_points: [],
    reviewed_count: 0,
    total_file_count: 0,
    conflict_status: "unknown",
    conflict_checked_at: null,
    analysis_error_code:
      status === "failed" ? "ANALYSIS_PROVIDER_FAILED" : null,
    analysis_error_message:
      status === "failed" ? "분석을 완료하지 못했습니다." : null,
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:01:00.000Z"
  };
}

function createService(sourceSession) {
  const accessChecks = [];
  const database = {
    async queryOne(text) {
      if (text.includes("FROM pr_review_sessions AS review_session")) {
        return sourceSession;
      }
      throw new Error(`Unhandled retry query: ${text}`);
    }
  };
  const service = new PrReviewService(
    database,
    {
      async assertWorkspaceAccess(userId, requestedWorkspaceId) {
        accessChecks.push({ userId, workspaceId: requestedWorkspaceId });
      }
    },
    {},
    {},
    {}
  );

  return { service, accessChecks };
}

{
  const { service, accessChecks } = createService(sessionRow("failed"));
  const nextSession = {
    id: "55555555-5555-4555-8555-555555555555",
    status: "analyzing"
  };
  const createCalls = [];
  service.createReviewSession = async (...args) => {
    createCalls.push(args);
    return { session: nextSession, created: true };
  };

  const result = await service.retryReviewSession(
    currentUserId,
    workspaceId,
    failedSessionId
  );

  assert.equal(result, nextSession);
  assert.deepEqual(createCalls, [[currentUserId, workspaceId, pullRequestId]]);
  assert.deepEqual(accessChecks, [{ userId: currentUserId, workspaceId }]);
}

{
  const { service } = createService(sessionRow("reviewing"));

  await assert.rejects(
    service.retryReviewSession(currentUserId, workspaceId, failedSessionId),
    (error) =>
      error.getStatus() === 409 &&
      error.getResponse().error.message ===
        "Only failed review sessions can be retried"
  );
}

{
  const { service } = createService(null);

  await assert.rejects(
    service.retryReviewSession(currentUserId, workspaceId, failedSessionId),
    (error) => error.getStatus() === 404
  );
}
