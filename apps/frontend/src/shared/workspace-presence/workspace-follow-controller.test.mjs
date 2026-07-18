import assert from "node:assert/strict";
import test from "node:test";

import * as followControllerModule from "./workspace-follow-controller.ts";

const { createWorkspaceFollowController } = followControllerModule;

function location(page = "home") {
  return {
    context: {},
    page,
    route: { pathname: `/${page}`, search: "" },
    viewport: { kind: "document", xRatio: 0, yRatio: 0 },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

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

test("같은 avatar 재선택은 지연된 Follow 시작의 stale 성공을 활성화하지 않는다", async () => {
  assert.equal(
    typeof followControllerModule.createWorkspaceFollowSession,
    "function",
  );
  const initialJump = deferred();
  const followingChanges = [];
  const session = followControllerModule.createWorkspaceFollowSession({
    cancelFollow: () => {},
    jump: () => initialJump.promise,
    onFollowingUserIdChange: (userId) => followingChanges.push(userId),
  });

  const firstToggle = session.toggle("user-a", location());
  await Promise.resolve();
  assert.equal(await session.toggle("user-a", location()), false);
  initialJump.resolve(true);

  assert.equal(await firstToggle, false);
  assert.deepEqual(session.getState(), { status: "idle" });
  assert.equal(followingChanges.includes("user-a"), false);
});

for (const reason of ["escape", "manual-interaction"]) {
  test(`${reason} 종료는 지연된 Follow 시작의 stale 성공을 활성화하지 않는다`, async () => {
    assert.equal(
      typeof followControllerModule.createWorkspaceFollowSession,
      "function",
    );
    const initialJump = deferred();
    const followingChanges = [];
    const session = followControllerModule.createWorkspaceFollowSession({
      cancelFollow: () => {},
      jump: () => initialJump.promise,
      onFollowingUserIdChange: (userId) => followingChanges.push(userId),
    });

    const toggle = session.toggle("user-a", location());
    await Promise.resolve();
    session.stop(reason);
    initialJump.resolve(true);

    assert.equal(await toggle, false);
    assert.deepEqual(session.getState(), { status: "idle" });
    assert.equal(followingChanges.includes("user-a"), false);
  });
}

test("Enter는 실제 link navigation에서만 수동 이동으로 분류한다", () => {
  assert.equal(
    typeof followControllerModule.isWorkspaceFollowManualKey,
    "function",
  );
  const isManualKey = followControllerModule.isWorkspaceFollowManualKey;

  assert.equal(
    isManualKey("Enter", {
      isFollowTrigger: false,
      isNavigationTarget: false,
    }),
    false,
  );
  assert.equal(
    isManualKey("Enter", {
      isFollowTrigger: false,
      isNavigationTarget: true,
    }),
    true,
  );
  assert.equal(
    isManualKey("ArrowDown", {
      isFollowTrigger: false,
      isNavigationTarget: false,
    }),
    true,
  );
  assert.equal(
    isManualKey(" ", {
      isFollowTrigger: true,
      isNavigationTarget: false,
    }),
    false,
  );
});

test("pointer는 link 이동 또는 누른 채 drag할 때만 수동 이동으로 분류한다", () => {
  assert.equal(
    typeof followControllerModule.isWorkspaceFollowManualPointer,
    "function",
  );
  const isManualPointer =
    followControllerModule.isWorkspaceFollowManualPointer;

  assert.equal(
    isManualPointer("down", {
      buttons: 1,
      isFollowTrigger: false,
      isNavigationTarget: false,
    }),
    false,
  );
  assert.equal(
    isManualPointer("down", {
      buttons: 1,
      isFollowTrigger: false,
      isNavigationTarget: true,
    }),
    true,
  );
  assert.equal(
    isManualPointer("move", {
      buttons: 1,
      isFollowTrigger: false,
      isNavigationTarget: false,
    }),
    true,
  );
  assert.equal(
    isManualPointer("move", {
      buttons: 1,
      isFollowTrigger: true,
      isNavigationTarget: false,
    }),
    false,
  );
});
