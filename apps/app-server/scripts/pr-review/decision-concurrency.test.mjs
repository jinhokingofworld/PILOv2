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
const workspaceId = "11111111-1111-4111-8111-111111111111";
const reviewFileId = "22222222-2222-4222-8222-222222222222";
const currentUserId = "44444444-4444-4444-8444-444444444444";

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

function createDecisionUpdateHarness() {
  const transaction = { name: "decision-transaction" };
  const calls = { append: 0, history: 0, progress: 0 };
  const service = new PrReviewService(
    {
      async transaction(callback) {
        return callback(transaction);
      }
    },
    { async assertWorkspaceAccess() {} },
    {},
    {},
    {},
    {
      async append() {
        calls.append += 1;
      }
    }
  );
  const file = currentDecision({
    id: reviewFileId,
    session_id: "33333333-3333-4333-8333-333333333333"
  });

  service.findReviewFile = async () => file;
  service.findReviewSession = async () => ({ id: file.session_id });
  service.assertReviewSessionRoomWritable = () => {};
  service.insertReviewFileDecision = async () => {
    calls.history += 1;
    return "55555555-5555-4555-8555-555555555555";
  };
  service.syncReviewSessionReviewProgress = async () => {
    calls.progress += 1;
  };
  service.listReviewFileFlowMemberships = async () => [];
  service.mapReviewFile = () => ({ id: reviewFileId });

  return { calls, file, service, transaction };
}

{
  const { calls, file, service } = createDecisionUpdateHarness();
  service.updateReviewFileDecisionState = async () => ({
    changed: false,
    file
  });

  await service.updateReviewFileDecision(
    currentUserId,
    workspaceId,
    reviewFileId,
    {
      status: baseInput.status,
      comment: baseInput.comment,
      expectedDecisionVersion: baseInput.expectedDecisionVersion
    }
  );

  assert.deepEqual(calls, { append: 0, history: 0, progress: 0 });
}

{
  let queryCount = 0;
  const { calls, service } = createDecisionUpdateHarness();
  service.updateReviewFileDecisionState = async (transaction) => {
    queryCount = 0;
    const conflictTransaction = {
      async queryOne() {
        queryCount += 1;
        return queryCount === 1 ? null : currentDecision();
      }
    };
    return PrReviewService.prototype.updateReviewFileDecisionState.call(
      service,
      conflictTransaction,
      baseInput
    );
  };

  await assert.rejects(
    service.updateReviewFileDecision(
      currentUserId,
      workspaceId,
      reviewFileId,
      {
        status: baseInput.status,
        comment: baseInput.comment,
        expectedDecisionVersion: baseInput.expectedDecisionVersion
      }
    ),
    (error) => error.getStatus() === 409
  );

  assert.equal(queryCount, 2);
  assert.deepEqual(calls, { append: 0, history: 0, progress: 0 });
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
