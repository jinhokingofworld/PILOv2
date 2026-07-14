import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  PR_REVIEW_DECISION_REDIS_CHANNEL,
  PrReviewDecisionRealtimePublisherService
} = require(
  "../../dist/modules/pr-review/pr-review-decision-realtime-publisher.service.js"
);

const published = [];
const database = {
  async queryOne(text, values) {
    assert.match(text, /JOIN pr_review_rooms review_room/);
    assert.match(text, /JOIN github_pull_requests pull_request/);
    assert.deepEqual(values, ["review-file-id"]);
    return {
      workspace_id: "workspace-id",
      canvas_id: "canvas-id",
      review_room_id: "review-room-id",
      review_session_id: "review-session-id",
      review_file_id: "review-file-id",
      room_file_id: "room-file-id",
      current_status: "approved",
      decision_version: 5,
      reviewed_by_user_id: "user-id",
      reviewed_at: "2026-07-14T07:00:00.000Z",
      reviewed_count: 2,
      total_file_count: 2
    };
  }
};
const publisher = new PrReviewDecisionRealtimePublisherService(database);
publisher.getClient = async () => ({
  async publish(channel, payload) {
    published.push({ channel, payload: JSON.parse(payload) });
  }
});

await publisher.publishDecisionUpdated("review-file-id");

assert.equal(published.length, 1);
assert.equal(published[0].channel, PR_REVIEW_DECISION_REDIS_CHANNEL);
assert.deepEqual(published[0].payload, {
  event: "pr-review:decision:updated",
  workspaceId: "workspace-id",
  canvasId: "canvas-id",
  reviewRoomId: "review-room-id",
  reviewSessionId: "review-session-id",
  reviewFileId: "review-file-id",
  roomFileId: "room-file-id",
  currentStatus: "approved",
  decisionVersion: 5,
  reviewedCount: 2,
  totalFileCount: 2,
  readyToSubmit: true,
  reviewedByUserId: "user-id",
  reviewedAt: "2026-07-14T07:00:00.000Z"
});

{
  const noRedisPublisher = new PrReviewDecisionRealtimePublisherService(database);
  noRedisPublisher.getClient = async () => null;
  await noRedisPublisher.publishDecisionUpdated("review-file-id");
}
