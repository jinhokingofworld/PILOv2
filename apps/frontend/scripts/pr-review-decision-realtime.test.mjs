import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const hook = await readFile(
  new URL(
    "../src/features/pr-review/realtime/usePrReviewCanvasPresence.ts",
    import.meta.url,
  ),
  "utf8",
);
const sync = await readFile(
  new URL(
    "../src/features/pr-review/realtime/pr-review-decision-sync.ts",
    import.meta.url,
  ),
  "utf8",
);
const drawer = await readFile(
  new URL(
    "../src/features/pr-review/components/review-canvas/PrReviewFileDiffDrawer.tsx",
    import.meta.url,
  ),
  "utf8",
);

assert.match(hook, /"pr-review:decision:updated"/);
assert.match(hook, /onDecisionUpdatedRef\.current\?\.\(payload\)/);
assert.match(hook, /onRoomJoinedRef\.current\?\.\(\)/);
assert.match(sync, /reviewStatus: update\.currentStatus/);
assert.match(sync, /reviewedCount: update\.reviewedCount/);
assert.match(sync, /readyToSubmit: update\.readyToSubmit/);
assert.match(drawer, /remoteDecisionUpdate\.decisionVersion <= file\.decisionVersion/);
assert.match(drawer, /작성 중인 내용은 유지했습니다/);
