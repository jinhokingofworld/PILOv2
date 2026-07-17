import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrReviewAgentToolsService } = require(
  "../../dist/modules/agent/tools/pr-review-agent-tools.service.js"
);

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";

function createFocusData(overrides = {}) {
  return {
    reviewSessionId: SESSION_ID,
    status: "reviewing",
    files: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        filePath: "apps/app-server/src/modules/pr-review/pr-review.service.ts",
        fileName: "pr-review.service.ts",
        roleType: "core_logic",
        riskLevel: "high",
        changeSummary: "리뷰 세션 조회를 추가했습니다.",
        reviewPoints: ["workspace 소속을 확인합니다."],
        reviewStatus: "discussion_needed"
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        filePath: "apps/frontend/src/features/pr-review/api/client.ts",
        fileName: "client.ts",
        roleType: "api_contract",
        riskLevel: "medium",
        changeSummary: "리뷰 세션 API 응답을 연결했습니다.",
        reviewPoints: ["응답 필드를 확인합니다."],
        reviewStatus: "not_reviewed"
      },
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        filePath: "apps/frontend/src/features/pr-review/components/pr-review-panel.tsx",
        fileName: "pr-review-panel.tsx",
        roleType: "ui_state",
        riskLevel: "low",
        changeSummary: "리뷰 화면 상태를 표시했습니다.",
        reviewPoints: [],
        reviewStatus: "approved"
      },
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        filePath: "apps/app-server/scripts/pr-review/decision-progress.test.mjs",
        fileName: "decision-progress.test.mjs",
        roleType: "verification",
        riskLevel: "medium",
        changeSummary: "리뷰 진행률 검증을 추가했습니다.",
        reviewPoints: ["권한 거부 경로를 검증합니다."],
        reviewStatus: "not_reviewed"
      }
    ],
    relations: [
      {
        fromReviewFileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        toReviewFileId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        relationType: "tests",
        reason: "세션 조회 권한 경로를 검증합니다."
      },
      {
        fromReviewFileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        toReviewFileId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        relationType: "passes_data_to",
        reason: "세션 상태를 리뷰 화면에 전달합니다."
      }
    ],
    ...overrides
  };
}

class FakePrReviewService {
  constructor(data) {
    this.data = data;
    this.calls = [];
  }

  async getReviewSessionAgentFocusData(currentUserId, workspaceId, sessionId) {
    this.calls.push({ currentUserId, workspaceId, sessionId });
    return this.data;
  }
}

const context = {
  currentUserId: USER_ID,
  workspaceId: WORKSPACE_ID,
  runId: RUN_ID,
  requestContext: {
    surface: "pr_review",
    sessionId: SESSION_ID
  }
};

{
  const prReviewService = new FakePrReviewService(createFocusData());
  const service = new PrReviewAgentToolsService(prReviewService);
  const [definition] = service.listDefinitions();

  assert.equal(definition.name, "recommend_pr_review_focus");
  assert.equal(definition.riskLevel, "low");
  assert.equal(definition.executionMode, "contextual");
  assert.deepEqual(definition.contextRequirement, { surface: "pr_review" });

  const result = await definition.execute(context, definition.validateInput({}));

  assert.equal(result.status, "recommended");
  assert.deepEqual(
    result.outputSummary.mustReview.map((file) => file.filePath),
    [
      "apps/app-server/src/modules/pr-review/pr-review.service.ts",
      "apps/frontend/src/features/pr-review/api/client.ts",
      "apps/app-server/scripts/pr-review/decision-progress.test.mjs"
    ]
  );
  assert.deepEqual(
    result.outputSummary.relatedFiles.map((file) => file.filePath),
    ["apps/frontend/src/features/pr-review/components/pr-review-panel.tsx"]
  );
  assert.equal(result.resourceRefs.length, 4);
  assert.doesNotMatch(JSON.stringify(result), /raw_diff|comment|patch/);
  assert.deepEqual(prReviewService.calls, [
    { currentUserId: USER_ID, workspaceId: WORKSPACE_ID, sessionId: SESSION_ID }
  ]);
}

{
  const service = new PrReviewAgentToolsService(
    new FakePrReviewService(createFocusData({ status: "analyzing" }))
  );
  const definition = service.listDefinitions()[0];
  const preparation = await definition.prepareExecution(
    context,
    definition.validateInput({ focus: "api" })
  );

  assert.equal(preparation.kind, "needs_clarification");
  assert.equal(preparation.outputSummary.status, "analyzing");
  assert.equal(preparation.resourceRefs.length, 0);
}

{
  const service = new PrReviewAgentToolsService(
    new FakePrReviewService(createFocusData())
  );
  const definition = service.listDefinitions()[0];

  assert.throws(() => definition.validateInput({ sessionId: SESSION_ID }));
  assert.throws(() => definition.validateInput({ focus: "database" }));
}
