import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [apiClient, roomsPanel, shell, surface, presenceHook] = await Promise.all([
  readFile(
    new URL("../src/features/pr-review/api/client.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/features/pr-review/components/pr-review-rooms-panel.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/features/pr-review/components/review-canvas/PrReviewCanvasShell.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/features/pr-review/components/review-canvas/PrReviewCanvasSurface.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/features/pr-review/realtime/usePrReviewCanvasPresence.ts",
      import.meta.url,
    ),
    "utf8",
  ),
]);

assert.match(apiClient, /async deleteReviewRoom/);
assert.match(roomsPanel, /PrReviewRoomDeleteButton/);
assert.match(shell, /PrReviewRoomDeleteButton/);
assert.match(surface, /onRealtimeRoomDeleted/);
assert.match(presenceHook, /"pr-review:room:deleted"/);
assert.match(presenceHook, /onRoomDeletedRef\.current\?\.\(payload\)/);

console.log("PR Review room deletion client tests passed");
