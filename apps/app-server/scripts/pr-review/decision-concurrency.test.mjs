import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrReviewService } = require(
  "../../dist/modules/pr-review/pr-review.service.js"
);

const baseInput = {
  workspaceId: "workspace-id",
  reviewFileId: "review-file-id",
  currentUserId: "user-id",
  status: "discussion_needed",
  comment: "확인이 필요합니다.",
  expectedDecisionVersion: 3
};

function currentDecision(overrides = {}) {
  return {
    id: "review-file-id",
    session_id: "review-session-id",
    current_status: "approved",
    comment: "문제 없음",
    reviewed_by_user_id: "other-user-id",
    reviewed_at: "2026-07-14T00:00:00.000Z",
    decision_version: 4,
    ...overrides
  };
}

{
  const queries = [];
  const transaction = {
    async queryOne(text, values = []) {
      queries.push({ text, values });
      return currentDecision({
        current_status: baseInput.status,
        comment: baseInput.comment,
        reviewed_by_user_id: baseInput.currentUserId
      });
    }
  };
  const service = new PrReviewService({}, {}, {}, {});

  const result = await service.updateReviewFileDecisionState(
    transaction,
    baseInput
  );

  assert.equal(result.changed, true);
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /decision_version = review_file\.decision_version \+ 1/);
  assert.match(queries[0].text, /review_file\.decision_version = \$6/);
  assert.match(queries[0].text, /IS DISTINCT FROM \$3/);
  assert.deepEqual(queries[0].values, [
    baseInput.workspaceId,
    baseInput.reviewFileId,
    baseInput.status,
    baseInput.comment,
    baseInput.currentUserId,
    baseInput.expectedDecisionVersion
  ]);
}

{
  let queryCount = 0;
  const transaction = {
    async queryOne() {
      queryCount += 1;
      return queryCount === 1
        ? null
        : currentDecision({
            current_status: baseInput.status,
            comment: baseInput.comment
          });
    }
  };
  const service = new PrReviewService({}, {}, {}, {});

  const result = await service.updateReviewFileDecisionState(
    transaction,
    baseInput
  );

  assert.equal(result.changed, false);
  assert.equal(queryCount, 2);
}

{
  let queryCount = 0;
  const transaction = {
    async queryOne() {
      queryCount += 1;
      return queryCount === 1 ? null : currentDecision();
    }
  };
  const service = new PrReviewService({}, {}, {}, {});

  await assert.rejects(
    service.updateReviewFileDecisionState(transaction, baseInput),
    (error) => {
      assert.equal(error.getStatus(), 409);
      assert.deepEqual(error.getResponse(), {
        success: false,
        error: {
          code: "REVIEW_DECISION_CHANGED",
          message: "Another reviewer saved a decision first",
          latestDecision: {
            decisionVersion: 4,
            currentStatus: "approved",
            comment: "문제 없음",
            reviewedByUserId: "other-user-id",
            reviewedAt: "2026-07-14T00:00:00.000Z"
          }
        }
      });
      return true;
    }
  );
  assert.equal(queryCount, 2);
}
