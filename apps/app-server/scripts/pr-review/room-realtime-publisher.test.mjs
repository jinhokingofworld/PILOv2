import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  PR_REVIEW_ROOM_DELETED_EVENT,
  PR_REVIEW_ROOM_REDIS_CHANNEL,
  PrReviewRoomRealtimePublisherService
} = require(
  "../../dist/modules/pr-review/pr-review-room-realtime-publisher.service.js"
);

const published = [];
const publisher = new PrReviewRoomRealtimePublisherService();
publisher.getClient = async () => ({
  async publish(channel, payload) {
    published.push({ channel, payload: JSON.parse(payload) });
  }
});

await publisher.publishRoomDeleted({
  workspaceId: "workspace-id",
  canvasId: "canvas-id",
  reviewRoomId: "review-room-id"
});

assert.deepEqual(published, [
  {
    channel: PR_REVIEW_ROOM_REDIS_CHANNEL,
    payload: {
      event: PR_REVIEW_ROOM_DELETED_EVENT,
      workspaceId: "workspace-id",
      canvasId: "canvas-id",
      reviewRoomId: "review-room-id"
    }
  }
]);

const noRedisPublisher = new PrReviewRoomRealtimePublisherService();
noRedisPublisher.getClient = async () => null;
await noRedisPublisher.publishRoomDeleted({
  workspaceId: "workspace-id",
  canvasId: "canvas-id",
  reviewRoomId: "review-room-id"
});

console.log("PR Review room realtime publisher tests passed");
