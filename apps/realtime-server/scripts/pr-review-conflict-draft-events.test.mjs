import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const events = await readFile(
  new URL("../src/pr-review/pr-review-socket-events.ts", import.meta.url),
  "utf8"
);
const socketServer = await readFile(
  new URL("../src/socket/socket-server.ts", import.meta.url),
  "utf8"
);

assert.match(
  events,
  /PR_REVIEW_CONFLICT_DRAFT_REDIS_CHANNEL =\s*"pr-review:conflict-draft-events"/
);
assert.match(events, /isPrReviewConflictDraftRedisEvent/);
assert.match(events, /isPrReviewConflictDraftLockPayload/);
assert.match(socketServer, /unsubscribePrReviewConflictDrafts/);
assert.match(socketServer, /PR_REVIEW_CONFLICT_DRAFT_LOCK_CLAIM_EVENT/);
assert.match(socketServer, /PR_REVIEW_CONFLICT_DRAFT_LOCK_RELEASE_EVENT/);
assert.match(socketServer, /emitConflictDraftLockReleases/);

console.log("PR Review Conflict draft realtime event tests passed");
