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

assert.match(events, /PR_REVIEW_DECISION_REDIS_CHANNEL = "pr-review:decision-events"/);
assert.match(events, /PR_REVIEW_DECISION_UPDATED_EVENT = "pr-review:decision:updated"/);
assert.match(events, /value\.reviewedCount <= value\.totalFileCount/);
assert.match(events, /isPrReviewDecisionUpdatedEvent/);
assert.match(socketServer, /unsubscribePrReviewDecisions/);
assert.match(socketServer, /createCanvasRoomName\(payload\)/);
assert.match(socketServer, /PR_REVIEW_DECISION_UPDATED_EVENT/);
