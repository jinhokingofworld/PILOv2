import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [service, moduleSource, publisher] = await Promise.all([
  readFile(
    new URL("../../src/modules/pr-review/pr-review.service.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../../src/modules/pr-review/pr-review.module.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../../src/modules/pr-review/pr-review-room-realtime-publisher.service.ts",
      import.meta.url,
    ),
    "utf8",
  ),
]);

assert.match(publisher, /PR_REVIEW_ROOM_REDIS_CHANNEL = "pr-review:room-events"/);
assert.match(publisher, /PR_REVIEW_ROOM_DELETED_EVENT = "pr-review:room:deleted"/);
assert.match(publisher, /publishRoomDeletedSafely/);
assert.match(service, /PrReviewRoomRealtimePublisherService/);
assert.match(service, /publishRoomDeletedSafely\(\{[\s\S]*canvasId: deleted\.id/);
assert.match(service, /reviewRoomId: roomId/);
assert.match(moduleSource, /PrReviewRoomRealtimePublisherService/);

console.log("PR Review room deletion realtime tests passed");
