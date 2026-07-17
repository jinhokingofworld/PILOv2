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
const filePath = "apps/app-server/src/modules/pr-review/pr-review.service.ts";

{
  const queries = [];
  const database = {
    async queryOne(text, values = []) {
      queries.push({ method: "queryOne", text, values });
      return {
        id: reviewSessionId,
        status: "reviewing"
      };
    },
    async query(text, values = []) {
      queries.push({ method: "query", text, values });
      if (text.includes("FROM review_flow_relations AS relation")) {
        return [
          {
            from_review_file_id: reviewFileId,
            to_review_file_id: "66666666-6666-4666-8666-666666666666",
            relation_type: "uses_api",
            reason: "주문 API 응답을 화면 상태에 전달합니다."
          }
        ];
      }

      return [
        {
          id: reviewFileId,
          file_path: filePath,
          file_name: "pr-review.service.ts",
          role_type: "core_logic",
          risk_level: "high",
          change_summary: "리뷰 세션 조회를 추가했습니다.",
          review_points: ["workspace 소속을 확인합니다."],
          current_status: "not_reviewed",
          comment: "must not be returned",
          raw_diff: "must not be queried"
        }
      ];
    }
  };
  const service = new PrReviewService(
    database,
    { async assertWorkspaceAccess() {} },
    {},
    {}
  );

  const result = await service.getReviewSessionAgentFocusData(
    currentUserId,
    workspaceId,
    reviewSessionId
  );

  assert.deepEqual(result, {
    reviewSessionId,
    status: "reviewing",
    files: [
      {
        id: reviewFileId,
        filePath,
        fileName: "pr-review.service.ts",
        roleType: "core_logic",
        riskLevel: "high",
        changeSummary: "리뷰 세션 조회를 추가했습니다.",
        reviewPoints: ["workspace 소속을 확인합니다."],
        reviewStatus: "not_reviewed"
      }
    ],
    relations: [
      {
        fromReviewFileId: reviewFileId,
        toReviewFileId: "66666666-6666-4666-8666-666666666666",
        relationType: "uses_api",
        reason: "주문 API 응답을 화면 상태에 전달합니다."
      }
    ]
  });
  assert.match(queries[0].text, /JOIN pr_review_rooms AS review_room/);
  assert.doesNotMatch(JSON.stringify(result), /must not be returned|raw_diff/);
}

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
    file_path: filePath,
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
      summary: `${filePath} 파일의 PR Review 판단을 승인 상태로 변경했습니다.`,
      data: {
        reviewSessionId,
        reviewFileId,
        filePath,
        decision: "approved"
      }
    }
  });
  assert.deepEqual(Object.keys(events.at(-1).input.metadata.data).sort(), [
    "decision",
    "filePath",
    "reviewFileId",
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
