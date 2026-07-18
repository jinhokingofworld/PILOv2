import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceFollowController } from "./workspace-follow-controller.ts";

test("Follow 시작을 확인하면 대상 사용자를 following 상태로 유지한다", () => {
  const controller = createWorkspaceFollowController();

  assert.deepEqual(controller.getState(), { status: "idle" });
  const requestId = controller.start("user-a");
  assert.deepEqual(controller.getState(), {
    requestId,
    status: "starting",
    userId: "user-a",
  });
  assert.equal(controller.confirm(requestId), true);
  assert.deepEqual(controller.getState(), {
    status: "following",
    userId: "user-a",
  });
  assert.equal(controller.stop("manual-interaction"), "user-a");
  assert.deepEqual(controller.getState(), { status: "idle" });
});

test("Follow 대상을 바꾸면 이전 시작 요청의 확인을 무시한다", () => {
  const controller = createWorkspaceFollowController();
  const staleRequestId = controller.start("user-a");
  const currentRequestId = controller.start("user-b");

  assert.equal(controller.confirm(staleRequestId), false);
  assert.deepEqual(controller.getState(), {
    requestId: currentRequestId,
    status: "starting",
    userId: "user-b",
  });
  assert.equal(controller.confirm(currentRequestId), true);
  assert.deepEqual(controller.getState(), {
    status: "following",
    userId: "user-b",
  });
});

test("같은 avatar를 다시 선택하면 Follow를 종료한다", () => {
  const controller = createWorkspaceFollowController();
  const requestId = controller.start("user-a");
  controller.confirm(requestId);

  assert.equal(controller.stop("same-avatar"), "user-a");
  assert.deepEqual(controller.getState(), { status: "idle" });
  assert.equal(controller.confirm(requestId), false);
});

test("Follow 대상이 나가면 Follow를 종료한다", () => {
  const controller = createWorkspaceFollowController();
  controller.start("user-a");

  assert.equal(controller.stop("target-left"), "user-a");
  assert.deepEqual(controller.getState(), { status: "idle" });
  assert.equal(controller.stop("target-left"), null);
});
