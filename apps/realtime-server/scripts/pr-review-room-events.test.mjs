import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const events = await readFile(
  new URL("../src/pr-review/pr-review-socket-events.ts", import.meta.url),
  "utf8",
);
const socketServer = await readFile(
  new URL("../src/socket/socket-server.ts", import.meta.url),
  "utf8",
);

assert.match(events, /PR_REVIEW_ROOM_REDIS_CHANNEL = "pr-review:room-events"/);
assert.match(events, /PR_REVIEW_ROOM_DELETED_EVENT = "pr-review:room:deleted"/);
assert.match(events, /isPrReviewRoomDeletedEvent/);
assert.match(socketServer, /unsubscribePrReviewRoomDeleted/);
assert.match(socketServer, /PR_REVIEW_ROOM_DELETED_EVENT/);
assert.match(socketServer, /createCanvasRoomName\(payload\)/);

console.log("PR Review room deletion socket event tests passed");
