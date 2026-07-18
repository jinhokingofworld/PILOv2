import assert from "node:assert/strict";
import test from "node:test";

import {
  createPrReviewDiffLocation,
  getPrReviewScrollOffset,
  readPrReviewDiffTarget,
  waitForPrReviewScrollTarget,
} from "./pr-review-follow-location.ts";

const metrics = {
  clientHeight: 400,
  clientWidth: 600,
  scrollHeight: 1_400,
  scrollLeft: 200,
  scrollTop: 500,
  scrollWidth: 1_400,
};

test("diff 위치는 opaque file ID와 clamp된 scroll ratio만 포함한다", () => {
  const location = createPrReviewDiffLocation({
    metrics: { ...metrics, scrollLeft: 2_000, scrollTop: -20 },
    reviewFileId: "  file-opaque-1  ",
    reviewSessionId: "  session-1  ",
    surface: "pr-review-diff",
  });

  assert.deepEqual(location, {
    context: {
      reviewFileId: "file-opaque-1",
      reviewSessionId: "session-1",
    },
    page: "pr-review",
    route: {
      pathname: "/pr-review",
      search: "?reviewSessionId=session-1",
    },
    viewport: {
      kind: "element",
      key: "pr-review-diff",
      xRatio: 1,
      yRatio: 0,
    },
  });
  assert.equal(JSON.stringify(location).includes("raw diff"), false);
});

test("inspector 위치는 스크롤 가능한 범위의 ratio를 계산한다", () => {
  const location = createPrReviewDiffLocation({
    metrics,
    reviewFileId: "file-2",
    reviewSessionId: "session-1",
    surface: "pr-review-inspector",
  });

  assert.equal(location?.viewport.key, "pr-review-inspector");
  assert.equal(location?.viewport.xRatio, 0.25);
  assert.equal(location?.viewport.yRatio, 0.5);
});

test("빈 session/file과 알 수 없는 surface는 위치를 만들지 않는다", () => {
  assert.equal(
    createPrReviewDiffLocation({
      metrics,
      reviewFileId: " ",
      reviewSessionId: "session-1",
      surface: "pr-review-diff",
    }),
    null,
  );
  assert.equal(
    createPrReviewDiffLocation({
      metrics,
      reviewFileId: "file-1",
      reviewSessionId: " ",
      surface: "pr-review-diff",
    }),
    null,
  );
  assert.equal(
    createPrReviewDiffLocation({
      metrics,
      reviewFileId: "file-1",
      reviewSessionId: "session-1",
      surface: "unknown",
    }),
    null,
  );
});

test("element target은 session/file/surface/finite ratio를 모두 검증한다", () => {
  const location = createPrReviewDiffLocation({
    metrics,
    reviewFileId: "file-1",
    reviewSessionId: "session-1",
    surface: "pr-review-diff",
  });

  assert.deepEqual(readPrReviewDiffTarget(location, "session-1"), {
    reviewFileId: "file-1",
    surface: "pr-review-diff",
    viewport: location.viewport,
  });
  assert.equal(readPrReviewDiffTarget(location, "other-session"), null);
  assert.equal(
    readPrReviewDiffTarget(
      { ...location, context: { ...location.context, reviewFileId: " " } },
      "session-1",
    ),
    null,
  );
  assert.equal(
    readPrReviewDiffTarget(
      { ...location, viewport: { ...location.viewport, key: "unknown" } },
      "session-1",
    ),
    null,
  );
  assert.equal(
    readPrReviewDiffTarget(
      { ...location, viewport: { ...location.viewport, yRatio: Number.NaN } },
      "session-1",
    ),
    null,
  );
});

test("ratio는 현재 scroll metrics의 offset으로 복원된다", () => {
  assert.deepEqual(
    getPrReviewScrollOffset(
      { kind: "element", key: "pr-review-diff", xRatio: 0.25, yRatio: 0.5 },
      {
        clientHeight: 300,
        clientWidth: 500,
        scrollHeight: 1_300,
        scrollWidth: 1_300,
      },
    ),
    { left: 200, top: 500 },
  );
});

test("scroll target은 matching file과 surface가 mount될 때까지 기다린다", async () => {
  const stale = {
    element: { id: "stale" },
    reviewFileId: "file-old",
    surface: "pr-review-diff",
  };
  const current = {
    element: { id: "current" },
    reviewFileId: "file-new",
    surface: "pr-review-diff",
  };
  let candidate = stale;
  setTimeout(() => {
    candidate = current;
  }, 5);

  const target = await waitForPrReviewScrollTarget({
    findTarget: () => candidate,
    intervalMs: 1,
    reviewFileId: "file-new",
    signal: new AbortController().signal,
    surface: "pr-review-diff",
    timeoutMs: 100,
  });

  assert.equal(target, current.element);
});

test("scroll target 대기는 abort 이후 stale target을 적용하지 않는다", async () => {
  const controller = new AbortController();
  let candidate = null;
  setTimeout(() => controller.abort(), 3);
  setTimeout(() => {
    candidate = {
      element: { id: "late" },
      reviewFileId: "file-1",
      surface: "pr-review-inspector",
    };
  }, 8);

  const target = await waitForPrReviewScrollTarget({
    findTarget: () => candidate,
    intervalMs: 1,
    reviewFileId: "file-1",
    signal: controller.signal,
    surface: "pr-review-inspector",
    timeoutMs: 100,
  });

  assert.equal(target, null);
});
