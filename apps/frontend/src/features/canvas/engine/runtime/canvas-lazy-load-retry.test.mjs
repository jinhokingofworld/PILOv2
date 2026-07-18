import assert from "node:assert/strict";
import test from "node:test";
import {
  getCanvasLazyLoadRetryDelay,
  runCanvasLazyLoadWithRetry,
  shouldRetryCanvasLazyLoad,
} from "./canvas-lazy-load-retry.ts";

test("일시적인 Lazy Loading 실패는 성공할 때까지 순차 재시도한다", async () => {
  const attempts = [];
  const delays = [];

  const result = await runCanvasLazyLoadWithRetry({
    async load(attempt) {
      attempts.push(attempt);
      if (attempt < 3) {
        throw Object.assign(new Error("temporary failure"), { status: 503 });
      }

      return ["shape:loaded"];
    },
    wait: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(delays, [500, 1_000]);
  assert.deepEqual(result, ["shape:loaded"]);
});

test("권한 및 잘못된 요청 오류는 반복하지 않는다", async () => {
  let attempts = 0;

  await assert.rejects(
    runCanvasLazyLoadWithRetry({
      async load() {
        attempts += 1;
        throw Object.assign(new Error("forbidden"), { status: 403 });
      },
      wait: async () => {},
    }),
    /forbidden/,
  );

  assert.equal(attempts, 1);
  assert.equal(shouldRetryCanvasLazyLoad({ status: 404 }), false);
  assert.equal(shouldRetryCanvasLazyLoad({ status: 429 }), true);
});

test("더 이상 필요한 요청이 아니면 다음 시도 전에 중단한다", async () => {
  let active = true;
  let attempts = 0;

  await assert.rejects(
    runCanvasLazyLoadWithRetry({
      async load() {
        attempts += 1;
        throw new Error("offline");
      },
      shouldContinue: () => active,
      wait: async () => {
        active = false;
      },
    }),
    (error) => error instanceof Error && error.name === "AbortError",
  );

  assert.equal(attempts, 1);
});

test("Lazy Loading 재시도 간격은 최대 8초로 제한한다", () => {
  assert.equal(getCanvasLazyLoadRetryDelay(1), 500);
  assert.equal(getCanvasLazyLoadRetryDelay(2), 1_000);
  assert.equal(getCanvasLazyLoadRetryDelay(5), 8_000);
  assert.equal(getCanvasLazyLoadRetryDelay(20), 8_000);
});

test("자식 프레임 5개 중 한 분기가 실패해도 재시도 후 손자까지 로딩한다", async () => {
  const childrenByFrame = new Map([
    [
      "shape:parent",
      [
        "shape:child-1",
        "shape:child-2",
        "shape:child-3",
        "shape:child-4",
        "shape:child-5",
      ],
    ],
    ["shape:child-1", []],
    ["shape:child-2", []],
    ["shape:child-3", []],
    ["shape:child-4", []],
    ["shape:child-5", ["shape:grandchild"]],
    ["shape:grandchild", []],
  ]);
  const attemptsByFrame = new Map();
  const loadedFrames = [];

  async function visit(frameId) {
    const children = await runCanvasLazyLoadWithRetry({
      async load() {
        const attempt = (attemptsByFrame.get(frameId) ?? 0) + 1;

        attemptsByFrame.set(frameId, attempt);
        if (frameId === "shape:child-3" && attempt < 3) {
          throw Object.assign(new Error("temporary child failure"), {
            status: 503,
          });
        }

        return childrenByFrame.get(frameId) ?? [];
      },
      wait: async () => {},
    });

    loadedFrames.push(frameId);
    await Promise.all(children.map(visit));
  }

  await visit("shape:parent");

  assert.equal(attemptsByFrame.get("shape:child-3"), 3);
  assert.deepEqual(
    new Set(loadedFrames),
    new Set(childrenByFrame.keys()),
  );
});
