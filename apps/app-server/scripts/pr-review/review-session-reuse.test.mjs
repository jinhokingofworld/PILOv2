import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrReviewService } = require(
  "../../dist/modules/pr-review/pr-review.service.js"
);

const workspaceId = "11111111-1111-4111-8111-111111111111";
const reviewRoomId = "22222222-2222-4222-8222-222222222222";
const reviewSessionId = "33333333-3333-4333-8333-333333333333";

class FakeDatabase {
  constructor() {
    this.queryOneCalls = [];
    this.queryCalls = [];
    this.executeCalls = [];
  }

  async transaction(callback) {
    return callback(this);
  }

  async queryOne(text, values = []) {
    this.queryOneCalls.push({ text, values });
    if (text.includes("UPDATE pr_review_rooms")) {
      return { id: reviewRoomId };
    }
    if (text.includes("SELECT canvas_id")) {
      return { canvas_id: "canvas-1" };
    }
    return null;
  }

  async query(text, values = []) {
    this.queryCalls.push({ text, values });
    if (text.includes("FROM review_files AS review_file")) {
      return [
        {
          review_file_id: "review-file-1",
          room_file_id: "room-file-1",
          review_flow_file_id: null,
          flow_id: null,
          flow_sort_order: null,
          workflow_order: null,
          file_name: "conflict.ts",
          file_path: "src/conflict.ts",
          file_status: "modified",
          file_role: "Conflict resolution",
          risk_level: "high",
          current_status: "not_reviewed"
        }
      ];
    }
    if (text.includes("FROM review_flow_relations AS relation")) {
      return [];
    }
    if (text.includes("FROM canvas_freeform_shapes")) {
      return [];
    }
    return [];
  }

  async execute(text, values = []) {
    this.executeCalls.push({ text, values });
    return { rows: [] };
  }
}

const database = new FakeDatabase();
const service = new PrReviewService(
  database,
  { async assertWorkspaceAccess() {} },
  {},
  {}
);

await service.activateReusableReviewSession(workspaceId, {
  id: reviewSessionId,
  room_id: reviewRoomId,
  pull_request_id: "44444444-4444-4444-8444-444444444444",
  created_by_user_id: null,
  head_sha: "reused-head-sha",
  status: "reviewing",
  pr_purpose: null,
  change_summary: [],
  recommended_review_order: null,
  caution_points: [],
  reviewed_count: 0,
  total_file_count: 1,
  conflict_status: "conflicted",
  conflict_checked_at: null,
  analysis_error_code: null,
  analysis_error_message: null,
  created_at: "2026-07-16T00:00:00.000Z",
  updated_at: "2026-07-16T00:00:00.000Z"
});

const activatedRoom = database.queryOneCalls.find((call) =>
  call.text.includes("UPDATE pr_review_rooms")
);
assert.ok(activatedRoom);
assert.deepEqual(activatedRoom.values, [reviewRoomId, reviewSessionId, workspaceId]);

const fileShapeInsert = database.executeCalls.find((call) =>
  call.text.includes("INSERT INTO canvas_freeform_shapes")
);
assert.ok(fileShapeInsert);
assert.equal(
  JSON.parse(fileShapeInsert.values[12]).props.currentReviewSessionId,
  reviewSessionId,
  "reusing a historical session must rematerialize the Canvas for that session"
);

console.log("PR Review reusable session activation tests passed");
