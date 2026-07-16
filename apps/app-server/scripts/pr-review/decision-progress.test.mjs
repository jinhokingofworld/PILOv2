import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrReviewService } = require(
  "../../dist/modules/pr-review/pr-review.service.js"
);

const reviewSessionId = "33333333-3333-4333-8333-333333333333";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const reviewFileId = "22222222-2222-4222-8222-222222222222";
const currentUserId = "44444444-4444-4444-8444-444444444444";
const decisionId = "55555555-5555-4555-8555-555555555555";

async function captureProgressUpdate(reviewedCount, totalFileCount) {
  const queries = [];
  const transaction = {
    async queryOne(text, values = []) {
      queries.push({ text, values });
      if (queries.length === 1) {
        return {
          reviewed_count: String(reviewedCount),
          total_file_count: String(totalFileCount)
        };
      }

      return { id: reviewSessionId };
    }
  };
  const service = new PrReviewService({}, {}, {}, {});

  await service.syncReviewSessionReviewProgress(transaction, reviewSessionId);

  return queries[1];
}

{
  const update = await captureProgressUpdate(1, 3);

  assert.match(update.text, /reviewed_count = \$2::integer/);
  assert.match(update.text, /total_file_count = \$3::integer/);
  assert.match(update.text, /WHEN \$4::boolean/);
  assert.deepEqual(update.values, [reviewSessionId, 1, 3, false]);
}

{
  const update = await captureProgressUpdate(3, 3);

  assert.deepEqual(update.values, [reviewSessionId, 3, 3, true]);
}

{
  let updateQuery = null;
  const transaction = {
    async queryOne(text, values = []) {
      updateQuery = { text, values };
      return { id: "review-file-id", session_id: reviewSessionId };
    }
  };
  const service = new PrReviewService({}, {}, {}, {});

  await service.updateReviewFileDecisionState(transaction, {
    workspaceId: "workspace-id",
    reviewFileId: "review-file-id",
    currentUserId: "user-id",
    status: "approved",
    comment: null,
    expectedDecisionVersion: 0
  });

  assert.match(updateQuery.text, /carried_from_decision_id = NULL/);
  assert.match(updateQuery.text, /review_file\.decision_version = \$6/);
}

function createDecisionUpdateHarness({ appendError } = {}) {
  const transaction = { name: "decision-transaction" };
  const events = [];
  const database = {
    committed: false,
    rolledBack: false,
    async transaction(callback) {
      try {
        const result = await callback(transaction);
        this.committed = true;
        return result;
      } catch (error) {
        this.rolledBack = true;
        throw error;
      }
    }
  };
  const activityLogService = {
    async append(receivedTransaction, input) {
      events.push({ name: "append", transaction: receivedTransaction, input });
      if (appendError) {
        throw appendError;
      }
    }
  };
  const service = new PrReviewService(
    database,
    { async assertWorkspaceAccess() {} },
    {},
    {},
    {},
    activityLogService
  );
  const file = {
    id: reviewFileId,
    session_id: reviewSessionId,
    current_status: "approved",
    comment: null,
    reviewed_by_user_id: currentUserId,
    reviewed_at: "2026-07-16T00:00:00.000Z",
    decision_version: 1
  };

  service.findReviewFile = async () => file;
  service.findReviewSession = async () => ({ id: reviewSessionId });
  service.assertReviewSessionRoomWritable = () => {};
  service.updateReviewFileDecisionState = async (receivedTransaction) => {
    events.push({ name: "state", transaction: receivedTransaction });
    return { changed: true, file };
  };
  service.insertReviewFileDecision = async (receivedTransaction) => {
    events.push({ name: "history", transaction: receivedTransaction });
    return decisionId;
  };
  service.syncReviewSessionReviewProgress = async (receivedTransaction) => {
    events.push({ name: "progress", transaction: receivedTransaction });
  };
  service.listReviewFileFlowMemberships = async () => [];
  service.mapReviewFile = () => ({ id: reviewFileId });

  return { database, events, service, transaction };
}

{
  const { database, events, service, transaction } =
    createDecisionUpdateHarness();

  await service.updateReviewFileDecision(
    currentUserId,
    workspaceId,
    reviewFileId,
    { status: "approved", comment: null, expectedDecisionVersion: 0 }
  );

  assert.equal(database.committed, true);
  assert.deepEqual(events.map((event) => event.name), [
    "state",
    "history",
    "progress",
    "append"
  ]);
  assert.ok(events.every((event) => event.transaction === transaction));
  assert.deepEqual(events.at(-1).input, {
    workspaceId,
    actor: { type: "user", userId: currentUserId },
    action: "file_review_decision_created",
    target: { type: "file_review_decision", id: decisionId },
    dedupeKey: `pr-review:file_review_decision_created:${decisionId}:created`,
    metadata: {
      version: 1,
      summary: events.at(-1).input.metadata.summary,
      data: { reviewSessionId, decision: "approved" }
    }
  });
  assert.deepEqual(Object.keys(events.at(-1).input.metadata.data).sort(), [
    "decision",
    "reviewSessionId"
  ]);
}

{
  const appendError = new Error("activity append failed");
  const { database, events, service } = createDecisionUpdateHarness({
    appendError
  });

  await assert.rejects(
    service.updateReviewFileDecision(
      currentUserId,
      workspaceId,
      reviewFileId,
      {
        status: "approved",
        comment: null,
        expectedDecisionVersion: 0
      }
    ),
    appendError
  );

  assert.equal(database.committed, false);
  assert.equal(database.rolledBack, true);
  assert.deepEqual(events.map((event) => event.name), [
    "state",
    "history",
    "progress",
    "append"
  ]);
}

{
  const transaction = {
    async queryOne(text, values = []) {
      assert.match(text, /INSERT INTO file_review_decisions/);
      assert.match(text, /RETURNING id/);
      assert.deepEqual(values, [
        reviewFileId,
        currentUserId,
        "approved",
        null
      ]);
      return { id: decisionId };
    }
  };
  const service = new PrReviewService({}, {}, {}, {});

  const insertedDecisionId = await service.insertReviewFileDecision(
    transaction,
    {
      reviewFileId,
      currentUserId,
      status: "approved",
      comment: null
    }
  );

  assert.equal(insertedDecisionId, decisionId);
}
