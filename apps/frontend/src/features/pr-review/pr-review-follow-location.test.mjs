import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createPrReviewDiffLocation,
  createPrReviewReadyLocationReporter,
  getPrReviewScrollOffset,
  readPrReviewDiffTarget,
  reportPrReviewLocationWhenTargetReady,
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

test("late-mounted local drawer target reports its location exactly once", async () => {
  let candidate = null;
  let reportCount = 0;
  setTimeout(() => {
    candidate = {
      element: { id: "late-diff" },
      reviewFileId: "file-1",
      surface: "pr-review-diff",
    };
  }, 5);

  const reported = await reportPrReviewLocationWhenTargetReady({
    findTarget: () => candidate,
    intervalMs: 1,
    reportLocationChange: () => {
      reportCount += 1;
    },
    reviewFileId: "file-1",
    signal: new AbortController().signal,
    surface: "pr-review-diff",
    timeoutMs: 100,
  });

  assert.equal(reported, true);
  assert.equal(reportCount, 1);
});

test("aborted local drawer wait does not report a stale target", async () => {
  const controller = new AbortController();
  let candidate = null;
  let reportCount = 0;
  setTimeout(() => controller.abort(), 3);
  setTimeout(() => {
    candidate = {
      element: { id: "stale-inspector" },
      reviewFileId: "file-old",
      surface: "pr-review-inspector",
    };
  }, 8);

  const reported = await reportPrReviewLocationWhenTargetReady({
    findTarget: () => candidate,
    intervalMs: 1,
    reportLocationChange: () => {
      reportCount += 1;
    },
    reviewFileId: "file-old",
    signal: controller.signal,
    surface: "pr-review-inspector",
    timeoutMs: 100,
  });

  assert.equal(reported, false);
  assert.equal(reportCount, 0);
});

test("remote restore replacing a pending file reports only the latest late-mounted target", async () => {
  const reporter = createPrReviewReadyLocationReporter();
  const reports = [];
  let targetA = null;
  let targetB = null;
  const pendingA = reporter.reportWhenReady({
    findTarget: () => targetA,
    intervalMs: 1,
    reportLocationChange: () => reports.push("file-a:diff"),
    reviewFileId: "file-a",
    surface: "pr-review-diff",
    timeoutMs: 100,
  });
  const pendingB = reporter.reportWhenReady({
    findTarget: () => targetB,
    intervalMs: 1,
    reportLocationChange: () => reports.push("file-b:inspector"),
    reviewFileId: "file-b",
    surface: "pr-review-inspector",
    timeoutMs: 100,
  });
  setTimeout(() => {
    targetA = {
      element: { id: "stale-a" },
      reviewFileId: "file-a",
      surface: "pr-review-diff",
    };
    targetB = {
      element: { id: "ready-b" },
      reviewFileId: "file-b",
      surface: "pr-review-inspector",
    };
  }, 5);

  assert.deepEqual(await Promise.all([pendingA, pendingB]), [false, true]);
  assert.deepEqual(reports, ["file-b:inspector"]);
});

test("Strict Mode cleanup and remount cannot report the stale first invocation", async () => {
  const reporter = createPrReviewReadyLocationReporter();
  let target = null;
  let reportCount = 0;
  const input = {
    findTarget: () => target,
    intervalMs: 1,
    reportLocationChange: () => {
      reportCount += 1;
    },
    reviewFileId: "file-1",
    surface: "pr-review-diff",
    timeoutMs: 100,
  };
  const staleInvocation = reporter.reportWhenReady(input);
  reporter.cancel();
  const remountedInvocation = reporter.reportWhenReady(input);
  setTimeout(() => {
    target = {
      element: { id: "ready-after-remount" },
      reviewFileId: "file-1",
      surface: "pr-review-diff",
    };
  }, 5);

  assert.deepEqual(
    await Promise.all([staleInvocation, remountedInvocation]),
    [false, true],
  );
  assert.equal(reportCount, 1);
});

test("unmount cancellation and timeout leave pending reports at zero", async () => {
  const reporter = createPrReviewReadyLocationReporter();
  let target = null;
  let reportCount = 0;
  const cancelled = reporter.reportWhenReady({
    findTarget: () => target,
    intervalMs: 1,
    reportLocationChange: () => {
      reportCount += 1;
    },
    reviewFileId: "file-cancelled",
    surface: "pr-review-diff",
    timeoutMs: 100,
  });
  reporter.cancel();
  target = {
    element: { id: "mounted-after-unmount" },
    reviewFileId: "file-cancelled",
    surface: "pr-review-diff",
  };

  assert.equal(await cancelled, false);
  assert.equal(
    await reporter.reportWhenReady({
      findTarget: () => null,
      intervalMs: 1,
      reportLocationChange: () => {
        reportCount += 1;
      },
      reviewFileId: "file-timeout",
      surface: "pr-review-inspector",
      timeoutMs: 5,
    }),
    false,
  );
  assert.equal(reportCount, 0);
});

test("adapter uses readiness reporting without manual-interaction follow stop", async () => {
  const adapter = await readFile(
    new URL("./pr-review-workspace-location-adapter.tsx", import.meta.url),
    "utf8",
  );

  assert.match(adapter, /createPrReviewReadyLocationReporter/);
  assert.match(adapter, /reportLocationChange/);
  assert.doesNotMatch(adapter, /reportManualInteraction|stopFollowing/);
});
