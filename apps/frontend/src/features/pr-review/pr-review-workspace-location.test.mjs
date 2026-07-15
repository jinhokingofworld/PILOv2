import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createPrReviewDocumentWorkspaceLocation,
  createPrReviewWorkspaceLocation,
  getPrReviewDocumentScrollOffset,
  readPrReviewCamera,
} from "./pr-review-workspace-location.ts";

test("PR Review는 review session과 tldraw camera를 capture/restore한다", async () => {
  const location = createPrReviewWorkspaceLocation("review-1", { x: 1, y: 2, z: 0.8 });
  assert.equal(location.route.search, "?reviewSessionId=review-1");
  assert.deepEqual(readPrReviewCamera(location, "review-1"), { x: 1, y: 2, z: 0.8 });
  const adapter = await readFile(new URL("./pr-review-workspace-location-adapter.tsx", import.meta.url), "utf8");
  assert.match(adapter, /getCamera/);
  assert.match(adapter, /setCamera/);
  const host = await readFile(new URL("./components/review-canvas/PrReviewCanvasSurface.tsx", import.meta.url), "utf8");
  assert.match(host, /PrReviewWorkspaceLocationAdapter/);
});

test("PR Review 목록은 document scroll을 capture/restore한다", async () => {
  const location = createPrReviewDocumentWorkspaceLocation({ clientHeight: 500, clientWidth: 800, scrollHeight: 1500, scrollLeft: 0, scrollTop: 500, scrollWidth: 800 });
  assert.equal(location.context.reviewSessionId, null);
  assert.deepEqual(getPrReviewDocumentScrollOffset(location.viewport, { clientHeight: 500, clientWidth: 800, scrollHeight: 1500, scrollWidth: 800 }), { left: 0, top: 500 });
  const adapter = await readFile(new URL("./pr-review-workspace-location-adapter.tsx", import.meta.url), "utf8");
  assert.match(adapter, /PrReviewDocumentWorkspaceLocationAdapter/);
  const host = await readFile(new URL("./components/pr-review-panel.tsx", import.meta.url), "utf8");
  assert.match(host, /PrReviewDocumentWorkspaceLocationAdapter/);
});
