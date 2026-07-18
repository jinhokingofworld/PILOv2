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
  assert.equal(location.context.reviewFileId, null);
  assert.deepEqual(readPrReviewCamera(location, "review-1"), { x: 1, y: 2, z: 0.8 });
  assert.equal(
    readPrReviewCamera(
      { ...location, context: { ...location.context, reviewFileId: "file-1" } },
      "review-1",
    ),
    null,
  );
  const adapter = await readFile(new URL("./pr-review-workspace-location-adapter.tsx", import.meta.url), "utf8");
  assert.match(adapter, /getCamera/);
  assert.match(adapter, /setCamera/);
  const host = await readFile(new URL("./components/review-canvas/PrReviewCanvasSurface.tsx", import.meta.url), "utf8");
  assert.match(host, /PrReviewWorkspaceLocationAdapter/);
});

test("PR Review 목록은 document scroll을 capture/restore한다", async () => {
  const location = createPrReviewDocumentWorkspaceLocation({ clientHeight: 500, clientWidth: 800, scrollHeight: 1500, scrollLeft: 0, scrollTop: 500, scrollWidth: 800 });
  assert.equal(location.context.reviewSessionId, null);
  assert.equal(location.context.reviewFileId, null);
  assert.deepEqual(getPrReviewDocumentScrollOffset(location.viewport, { clientHeight: 500, clientWidth: 800, scrollHeight: 1500, scrollWidth: 800 }), { left: 0, top: 500 });
  const adapter = await readFile(new URL("./pr-review-workspace-location-adapter.tsx", import.meta.url), "utf8");
  assert.match(adapter, /PrReviewDocumentWorkspaceLocationAdapter/);
  const host = await readFile(new URL("./components/pr-review-panel.tsx", import.meta.url), "utf8");
  assert.match(host, /PrReviewDocumentWorkspaceLocationAdapter/);
});

test("PR Review canvas는 drawer file과 active surface를 location adapter까지 연결한다", async () => {
  const shell = await readFile(
    new URL("./components/review-canvas/PrReviewCanvasShell.tsx", import.meta.url),
    "utf8",
  );
  const surface = await readFile(
    new URL("./components/review-canvas/PrReviewCanvasSurface.tsx", import.meta.url),
    "utf8",
  );
  const adapter = await readFile(
    new URL("./pr-review-workspace-location-adapter.tsx", import.meta.url),
    "utf8",
  );

  assert.match(shell, /activeFollowSurface/);
  assert.match(shell, /openedReviewFileId=\{openedReviewFileId\}/);
  assert.match(shell, /onOpenedReviewFileChange=\{handleOpenedReviewFileChange\}/);
  assert.match(shell, /onFollowSurfaceChange=\{setActiveFollowSurface\}/);
  assert.match(surface, /openedReviewFileId=\{openedReviewFileId\}/);
  assert.match(surface, /onOpenedReviewFileChange=\{onOpenedReviewFileChange\}/);
  assert.match(adapter, /waitForPrReviewScrollTarget/);
  assert.match(adapter, /scrollTo/);
});

test("PR Review drawer는 실제 diff/inspector scroller에서 active surface와 manual interaction을 보고한다", async () => {
  const shell = await readFile(
    new URL("./components/review-canvas/PrReviewCanvasShell.tsx", import.meta.url),
    "utf8",
  );
  const drawer = await readFile(
    new URL("./components/review-canvas/PrReviewFileDiffDrawer.tsx", import.meta.url),
    "utf8",
  );

  assert.match(drawer, /data-workspace-follow-surface="pr-review-diff"/);
  assert.match(drawer, /data-workspace-follow-surface="pr-review-inspector"/);
  assert.match(drawer, /data-workspace-follow-review-file-id=\{reviewFileId\}/);
  assert.match(drawer, /onFollowSurfaceInteraction/);
  assert.match(drawer, /onWheel/);
  assert.match(drawer, /onTouchStart/);
  assert.match(drawer, /onPointerDown/);
  assert.match(shell, /reportManualInteraction/);
});
