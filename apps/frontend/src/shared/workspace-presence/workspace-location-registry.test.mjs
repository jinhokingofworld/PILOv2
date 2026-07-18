import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKSPACE_JUMP_ERROR_MESSAGE,
  createWorkspaceJumpCoordinator,
  createWorkspaceLocationRegistry,
} from "./workspace-location-registry.ts";
import {
  createWorkspaceFollowController,
  createWorkspaceFollowSession,
} from "./workspace-follow-controller.ts";

function location(page, pathname = `/${page}`) {
  return {
    context: {},
    page,
    route: { pathname, search: "" },
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

test("registry는 mounted adapter의 capture와 restore를 사용한다", async () => {
  const restored = [];
  const restoreContexts = [];
  const registry = createWorkspaceLocationRegistry();
  const unregister = registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: async (target, context) => {
      restored.push(target);
      restoreContexts.push(context);
      return true;
    },
  });
  const controller = new AbortController();

  assert.equal(registry.capture()?.page, "home");
  assert.equal(
    await registry.restore(location("home"), {
      signal: controller.signal,
      source: "jump",
    }),
    true,
  );
  assert.equal(restored.length, 1);
  assert.deepEqual(restoreContexts, [
    { signal: controller.signal, source: "jump" },
  ]);
  unregister();
  assert.equal(registry.capture(), null);
});

test("같은 route는 즉시 한 번 restore하고 cross route는 ready까지 보류한다", async () => {
  let currentHref = "/home";
  const navigated = [];
  const restored = [];
  const restoreContexts = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: async (target, context) => {
      restored.push(target.page);
      restoreContexts.push(context);
      return true;
    },
  });
  const coordinator = createWorkspaceJumpCoordinator({
    getCurrentHref: () => currentHref,
    navigate: (href) => {
      navigated.push(href);
      currentHref = href;
    },
    onError: () => {},
    registry,
    rollback: () => {},
  });

  await coordinator.jump(location("home"));
  assert.deepEqual(restored, ["home"]);
  assert.equal(restoreContexts[0].source, "jump");
  assert.equal(restoreContexts[0].signal.aborted, false);
  assert.deepEqual(navigated, []);

  await coordinator.jump(location("calendar"));
  assert.deepEqual(navigated, ["/calendar"]);
  assert.equal(coordinator.getPending()?.targetLocation.page, "calendar");
  assert.equal(await coordinator.destinationReady(), false);
  assert.equal(coordinator.getPending()?.targetLocation.page, "calendar");

  registry.register({
    capture: () => location("calendar"),
    page: "calendar",
    ready: true,
    restore: async (target, context) => {
      restored.push(target.page);
      restoreContexts.push(context);
      return true;
    },
  });
  await coordinator.destinationReady();
  assert.deepEqual(restored, ["home", "calendar"]);
  assert.equal(restoreContexts[1].source, "jump");
  assert.equal(restoreContexts[1].signal.aborted, false);
  assert.equal(coordinator.getPending(), null);
});

test("새 click은 pending jump를 교체하고 timeout은 rollback과 정확한 오류를 낸다", async () => {
  let timerCallback = null;
  const errors = [];
  const rolledBack = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: async () => true,
  });
  const coordinator = createWorkspaceJumpCoordinator({
    clearTimer: () => {
      timerCallback = null;
    },
    getCurrentHref: () => "/home",
    navigate: () => {},
    onError: (message) => errors.push(message),
    registry,
    rollback: (href) => rolledBack.push(href),
    setTimer: (callback) => {
      timerCallback = callback;
      return 1;
    },
  });

  await coordinator.jump(location("calendar"));
  await coordinator.jump(location("board"));
  assert.equal(coordinator.getPending()?.targetLocation.page, "board");

  await timerCallback();
  assert.deepEqual(rolledBack, ["/home"]);
  assert.deepEqual(errors, [WORKSPACE_JUMP_ERROR_MESSAGE]);
  assert.equal(coordinator.getPending(), null);
});

test("async restore 도중 재클릭하면 stale completion이 새 pending을 지우지 않는다", async () => {
  const restores = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: (target) => {
      const pendingRestore = deferred();
      restores.push({ pendingRestore, target });
      return pendingRestore.promise;
    },
  });
  const coordinator = createWorkspaceJumpCoordinator({
    clearTimer: () => {},
    getCurrentHref: () => "/home",
    navigate: () => {},
    onError: () => {},
    registry,
    rollback: () => {},
    setTimer: () => 1,
  });
  const firstTarget = {
    ...location("home"),
    context: { request: "first" },
  };
  const secondTarget = {
    ...location("home"),
    context: { request: "second" },
  };

  const firstJump = coordinator.jump(firstTarget);
  await Promise.resolve();
  const secondJump = coordinator.jump(secondTarget);
  await Promise.resolve();
  assert.equal(restores.length, 2);

  restores[0].pendingRestore.resolve(true);
  await firstJump;
  assert.equal(
    coordinator.getPending()?.targetLocation.context.request,
    "second",
  );

  restores[1].pendingRestore.resolve(true);
  await secondJump;
  assert.equal(coordinator.getPending(), null);
});

test("새 Follow 위치는 이전 restore를 abort하고 stale completion을 무시한다", async () => {
  let currentHref = "/home";
  const restores = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: (target, context) => {
      const pendingRestore = deferred();
      restores.push({ context, pendingRestore, target });
      return pendingRestore.promise;
    },
  });
  const coordinator = createWorkspaceJumpCoordinator({
    clearTimer: () => {},
    getCurrentHref: () => currentHref,
    navigate: (href) => {
      currentHref = href;
    },
    onError: () => {},
    onFollowError: () => {},
    registry,
    rollback: () => {},
    setTimer: () => 1,
  });
  const firstFollow = coordinator.follow({
    ...location("home"),
    route: { pathname: "/home", search: "?version=1" },
  });
  await Promise.resolve();
  const secondFollow = coordinator.follow({
    ...location("home"),
    route: { pathname: "/home", search: "?version=2" },
  });
  await Promise.resolve();

  assert.equal(restores.length, 2);
  assert.equal(restores[0].context.source, "follow");
  assert.equal(restores[0].context.signal.aborted, true);
  assert.equal(restores[1].context.signal.aborted, false);

  restores[0].pendingRestore.resolve(true);
  await firstFollow;
  assert.equal(
    coordinator.getPending()?.targetLocation.route.search,
    "?version=2",
  );

  restores[1].pendingRestore.resolve(true);
  await secondFollow;
  assert.equal(coordinator.getPending(), null);
});

test("cancelFollow는 진행 중인 restore를 abort하고 stale 오류를 무시한다", async () => {
  const restore = deferred();
  const contexts = [];
  const followErrors = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: (_target, context) => {
      contexts.push(context);
      return restore.promise;
    },
  });
  const coordinator = createWorkspaceJumpCoordinator({
    clearTimer: () => {},
    getCurrentHref: () => "/home",
    navigate: () => {},
    onError: () => {},
    onFollowError: () => followErrors.push("failed"),
    registry,
    rollback: () => {},
    setTimer: () => 1,
  });

  const pendingFollow = coordinator.follow(location("home"));
  await Promise.resolve();
  coordinator.cancelFollow();

  assert.equal(contexts[0].signal.aborted, true);
  assert.equal(coordinator.getPending(), null);
  restore.resolve(false);
  assert.equal(await pendingFollow, false);
  assert.deepEqual(followErrors, []);
});

test("cancelFollow는 진행 중인 jump를 취소하지 않는다", async () => {
  const restore = deferred();
  const contexts = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: (_target, context) => {
      contexts.push(context);
      return restore.promise;
    },
  });
  const coordinator = createWorkspaceJumpCoordinator({
    clearTimer: () => {},
    getCurrentHref: () => "/home",
    navigate: () => {},
    onError: () => {},
    registry,
    rollback: () => {},
    setTimer: () => 1,
  });

  const pendingJump = coordinator.jump(location("home"));
  await Promise.resolve();
  coordinator.cancelFollow();

  assert.equal(contexts[0].signal.aborted, false);
  assert.equal(coordinator.getPending()?.source, "jump");
  restore.resolve(true);
  assert.equal(await pendingJump, true);
  assert.equal(coordinator.getPending(), null);
});

test("cancelFollow는 지연된 Follow 시작 navigate 후 restore를 실행하지 않는다", async () => {
  let currentHref = "/home";
  const navigation = deferred();
  const restores = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("calendar"),
    page: "calendar",
    ready: true,
    restore: (target) => {
      restores.push(target);
      return true;
    },
  });
  const coordinator = createWorkspaceJumpCoordinator({
    getCurrentHref: () => currentHref,
    navigate: async (href) => {
      await navigation.promise;
      currentHref = href;
    },
    onError: () => {},
    registry,
    rollback: () => {},
  });

  const pendingStart = coordinator.jump(location("calendar"), {
    source: "follow-start",
  });
  await Promise.resolve();
  coordinator.cancelFollow();
  navigation.resolve();

  assert.equal(await pendingStart, false);
  assert.deepEqual(restores, []);
  assert.equal(coordinator.getPending(), null);
});

test("cross-route Follow 시작은 target restore 성공까지 완료되지 않는다", async () => {
  let currentHref = "/home";
  const restored = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: () => true,
  });
  const coordinator = createWorkspaceJumpCoordinator({
    clearTimer: () => {},
    getCurrentHref: () => currentHref,
    navigate: (href) => {
      currentHref = href;
    },
    onError: () => {},
    registry,
    rollback: () => {},
    setTimer: () => 1,
  });
  const pendingStart = coordinator.jump(location("calendar"), {
    source: "follow-start",
  });
  let startResult = "pending";
  void pendingStart.then((result) => {
    startResult = result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(startResult, "pending");

  registry.register({
    capture: () => location("calendar"),
    page: "calendar",
    ready: true,
    restore: (target) => {
      restored.push(target);
      return true;
    },
  });
  assert.equal(await coordinator.destinationReady(), true);
  assert.equal(await pendingStart, true);
  assert.deepEqual(restored, [location("calendar")]);
});

test("cross-route Follow 시작 restore 실패는 rollback과 오류 없이 false로 끝난다", async () => {
  let currentHref = "/home";
  const errors = [];
  const followErrors = [];
  const followingChanges = [];
  const rolledBack = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: () => true,
  });
  const coordinator = createWorkspaceJumpCoordinator({
    clearTimer: () => {},
    getCurrentHref: () => currentHref,
    navigate: (href) => {
      currentHref = href;
    },
    onError: (message) => errors.push(message),
    onFollowError: () => followErrors.push("failed"),
    registry,
    rollback: (href) => rolledBack.push(href),
    setTimer: () => 1,
  });
  const session = createWorkspaceFollowSession({
    cancelFollow: coordinator.cancelFollow,
    jump: coordinator.jump,
    onFollowingUserIdChange: (userId) => followingChanges.push(userId),
  });

  const pendingStart = session.toggle("user-2", location("calendar"));
  registry.register({
    capture: () => location("calendar"),
    page: "calendar",
    ready: true,
    restore: () => false,
  });
  assert.equal(await coordinator.destinationReady(), false);

  assert.equal(await pendingStart, false);
  assert.deepEqual(rolledBack, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(followErrors, []);
  assert.equal(followingChanges.includes("user-2"), false);
  assert.deepEqual(session.getState(), { status: "idle" });
  assert.equal(coordinator.getPending(), null);
});

test("cross-route Follow 시작 timeout은 rollback과 오류 없이 false로 끝난다", async () => {
  let currentHref = "/home";
  let timerCallback = null;
  const errors = [];
  const followErrors = [];
  const rolledBack = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: () => true,
  });
  const coordinator = createWorkspaceJumpCoordinator({
    clearTimer: () => {
      timerCallback = null;
    },
    getCurrentHref: () => currentHref,
    navigate: (href) => {
      currentHref = href;
    },
    onError: (message) => errors.push(message),
    onFollowError: () => followErrors.push("failed"),
    registry,
    rollback: (href) => rolledBack.push(href),
    setTimer: (callback) => {
      timerCallback = callback;
      return 1;
    },
  });

  const pendingStart = coordinator.jump(location("calendar"), {
    source: "follow-start",
  });
  await Promise.resolve();
  timerCallback();

  assert.equal(await pendingStart, false);
  assert.deepEqual(rolledBack, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(followErrors, []);
  assert.equal(coordinator.getPending(), null);
});

test("Follow 시작 restore 취소 후 stale 완료는 following을 활성화하지 않는다", async () => {
  const restore = deferred();
  const restoreContexts = [];
  const controller = createWorkspaceFollowController();
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: (_target, context) => {
      restoreContexts.push(context);
      return restore.promise;
    },
  });
  const coordinator = createWorkspaceJumpCoordinator({
    getCurrentHref: () => "/home",
    navigate: () => {},
    onError: () => {},
    registry,
    rollback: () => {},
  });
  const requestId = controller.start("user-2");
  const pendingStart = coordinator.jump(location("home"), {
    source: "follow-start",
  });
  await Promise.resolve();

  controller.stop("escape");
  coordinator.cancelFollow();
  assert.equal(restoreContexts[0].signal.aborted, true);
  restore.resolve(true);

  assert.equal(await pendingStart, false);
  assert.equal(controller.confirm(requestId), false);
  assert.deepEqual(controller.getState(), { status: "idle" });
});

test("Follow restore가 false를 반환하면 rollback 없이 오류 처리한다", async () => {
  const followErrors = [];
  const rolledBack = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: () => false,
  });
  const coordinator = createWorkspaceJumpCoordinator({
    getCurrentHref: () => "/home",
    navigate: () => {},
    onError: () => {},
    onFollowError: () => followErrors.push("failed"),
    registry,
    rollback: (href) => rolledBack.push(href),
  });

  assert.equal(await coordinator.follow(location("home")), false);
  assert.deepEqual(rolledBack, []);
  assert.deepEqual(followErrors, ["failed"]);
  assert.equal(coordinator.getPending(), null);
});

test("Follow restore가 throw하면 rollback 없이 오류 처리한다", async () => {
  const followErrors = [];
  const rolledBack = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: () => {
      throw new Error("restore failed");
    },
  });
  const coordinator = createWorkspaceJumpCoordinator({
    getCurrentHref: () => "/home",
    navigate: () => {},
    onError: () => {},
    onFollowError: () => followErrors.push("failed"),
    registry,
    rollback: (href) => rolledBack.push(href),
  });

  assert.equal(await coordinator.follow(location("home")), false);
  assert.deepEqual(rolledBack, []);
  assert.deepEqual(followErrors, ["failed"]);
  assert.equal(coordinator.getPending(), null);
});

test("Follow timeout은 rollback 없이 오류 처리하고 pending을 비운다", async () => {
  let currentHref = "/home";
  let timerCallback = null;
  const followErrors = [];
  const rolledBack = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: () => true,
  });
  const coordinator = createWorkspaceJumpCoordinator({
    clearTimer: () => {
      timerCallback = null;
    },
    getCurrentHref: () => currentHref,
    navigate: (href) => {
      currentHref = href;
    },
    onError: () => {},
    onFollowError: () => followErrors.push("failed"),
    registry,
    rollback: (href) => rolledBack.push(href),
    setTimer: (callback) => {
      timerCallback = callback;
      return 1;
    },
  });

  await coordinator.follow(location("calendar"));
  assert.equal(coordinator.getPending()?.targetLocation.page, "calendar");
  await timerCallback();

  assert.deepEqual(rolledBack, []);
  assert.deepEqual(followErrors, ["failed"]);
  assert.equal(coordinator.getPending(), null);
});

test("jump rollback restore timeout은 진행 중인 restore를 abort한다", async () => {
  let currentHref = "/home";
  let timerCallback = null;
  const errors = [];
  const rollbackRestore = deferred();
  const rollbackContexts = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: (_target, context) => {
      rollbackContexts.push(context);
      return rollbackRestore.promise;
    },
  });
  const coordinator = createWorkspaceJumpCoordinator({
    clearTimer: () => {
      timerCallback = null;
    },
    getCurrentHref: () => currentHref,
    navigate: (href) => {
      currentHref = href;
    },
    onError: (message) => errors.push(message),
    registry,
    rollback: (href) => {
      currentHref = href;
    },
    setTimer: (callback) => {
      timerCallback = callback;
      return 1;
    },
  });

  await coordinator.jump(location("calendar"));
  registry.register({
    capture: () => location("calendar"),
    page: "calendar",
    ready: true,
    restore: () => false,
  });
  const failedJump = coordinator.destinationReady();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(rollbackContexts.length, 1);
  assert.equal(rollbackContexts[0].signal.aborted, false);
  timerCallback();
  assert.equal(rollbackContexts[0].signal.aborted, true);
  assert.deepEqual(errors, [WORKSPACE_JUMP_ERROR_MESSAGE]);

  rollbackRestore.resolve(true);
  assert.equal(await failedJump, false);
  assert.equal(coordinator.getPending(), null);
});

test("같은 request의 destinationReady 중복 호출은 restore를 한 번만 실행한다", async () => {
  let currentHref = "/home";
  const restore = deferred();
  let restoreCount = 0;
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: async () => true,
  });
  const coordinator = createWorkspaceJumpCoordinator({
    clearTimer: () => {},
    getCurrentHref: () => currentHref,
    navigate: (href) => {
      currentHref = href;
    },
    onError: () => {},
    registry,
    rollback: () => {},
    setTimer: () => 1,
  });

  await coordinator.jump(location("calendar"));
  registry.register({
    capture: () => location("calendar"),
    page: "calendar",
    ready: true,
    restore: () => {
      restoreCount += 1;
      return restore.promise;
    },
  });

  const firstReady = coordinator.destinationReady();
  const duplicateReady = coordinator.destinationReady();
  assert.equal(restoreCount, 1);
  restore.resolve(true);
  await Promise.all([firstReady, duplicateReady]);
  assert.equal(coordinator.getPending(), null);
});

test("target 실패는 source route의 camera와 element viewport를 정확히 한 번 복원한다", async () => {
  const sources = [
    {
      context: { canvasId: "canvas-1" },
      page: "canvas",
      route: { pathname: "/canvas", search: "?canvasId=canvas-1" },
      viewport: { kind: "camera", x: 10, y: 20, z: 1.5 },
    },
    {
      context: { boardId: "board-1" },
      page: "board",
      route: { pathname: "/board", search: "" },
      viewport: {
        kind: "element",
        key: "board-kanban",
        xRatio: 0.75,
        yRatio: 0.25,
      },
    },
  ];

  for (const source of sources) {
    let currentHref = `${source.route.pathname}${source.route.search}`;
    const restoredSources = [];
    const errors = [];
    const registry = createWorkspaceLocationRegistry();
    registry.register({
      capture: () => source,
      page: source.page,
      ready: true,
      restore: (target) => {
        restoredSources.push(target);
        return true;
      },
    });
    const coordinator = createWorkspaceJumpCoordinator({
      clearTimer: () => {},
      getCurrentHref: () => currentHref,
      navigate: (href) => {
        currentHref = href;
      },
      onError: (message) => errors.push(message),
      registry,
      rollback: (href) => {
        currentHref = href;
      },
      setTimer: () => 1,
    });

    await coordinator.jump(location("calendar"));
    registry.register({
      capture: () => location("calendar"),
      page: "calendar",
      ready: true,
      restore: () => false,
    });
    await coordinator.destinationReady();

    assert.equal(currentHref, `${source.route.pathname}${source.route.search}`);
    assert.deepEqual(restoredSources, [source]);
    assert.deepEqual(errors, [WORKSPACE_JUMP_ERROR_MESSAGE]);
    assert.equal(coordinator.getPending(), null);
  }
});

test("trailing slash만 다른 같은 route는 navigate 없이 즉시 복원한다", async () => {
  const navigated = [];
  const restored = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: async (target) => {
      restored.push(target.page);
      return true;
    },
  });
  const coordinator = createWorkspaceJumpCoordinator({
    getCurrentHref: () => "/home/",
    navigate: (href) => navigated.push(href),
    onError: () => {},
    registry,
    rollback: () => {},
  });

  assert.equal(await coordinator.jump(location("home", "/home")), true);
  assert.deepEqual(navigated, []);
  assert.deepEqual(restored, ["home"]);
  assert.equal(coordinator.getPending(), null);
});

test("trailing slash가 붙은 target route도 destination ready로 인정한다", async () => {
  let currentHref = "/home/";
  const restored = [];
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: async () => true,
  });
  const coordinator = createWorkspaceJumpCoordinator({
    getCurrentHref: () => currentHref,
    navigate: (href) => {
      currentHref = `${href}/`;
    },
    onError: () => {},
    registry,
    rollback: () => {},
  });

  await coordinator.jump(location("calendar", "/calendar"));
  registry.register({
    capture: () => location("calendar"),
    page: "calendar",
    ready: true,
    restore: async (target) => {
      restored.push(target.page);
      return true;
    },
  });

  assert.equal(await coordinator.destinationReady(), true);
  assert.deepEqual(restored, ["calendar"]);
  assert.equal(coordinator.getPending(), null);
});

test("trailing slash를 정규화해도 query string이 다르면 target route로 인정하지 않는다", async () => {
  let currentHref = "/home/";
  let restoreCount = 0;
  const target = {
    ...location("calendar", "/calendar"),
    route: { pathname: "/calendar", search: "?date=2026-07-16" },
  };
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: async () => true,
  });
  const coordinator = createWorkspaceJumpCoordinator({
    clearTimer: () => {},
    getCurrentHref: () => currentHref,
    navigate: () => {
      currentHref = "/calendar/?date=2026-07-17";
    },
    onError: () => {},
    registry,
    rollback: () => {},
    setTimer: () => 1,
  });

  await coordinator.jump(target);
  registry.register({
    capture: () => target,
    page: "calendar",
    ready: true,
    restore: async () => {
      restoreCount += 1;
      return true;
    },
  });

  assert.equal(await coordinator.destinationReady(), false);
  assert.equal(restoreCount, 0);
  assert.equal(coordinator.getPending()?.phase, "target");
});

test("rollback 후 source route에 붙은 trailing slash를 허용하고 source 위치를 복원한다", async () => {
  let currentHref = "/home";
  const errors = [];
  const restoredSources = [];
  const source = location("home", "/home");
  const registry = createWorkspaceLocationRegistry();
  registry.register({
    capture: () => source,
    page: "home",
    ready: true,
    restore: async (target) => {
      restoredSources.push(target);
      return true;
    },
  });
  const coordinator = createWorkspaceJumpCoordinator({
    clearTimer: () => {},
    getCurrentHref: () => currentHref,
    navigate: (href) => {
      currentHref = href;
    },
    onError: (message) => errors.push(message),
    registry,
    rollback: (href) => {
      currentHref = `${href}/`;
    },
    setTimer: () => 1,
  });

  await coordinator.jump(location("calendar", "/calendar"));
  registry.register({
    capture: () => location("calendar"),
    page: "calendar",
    ready: true,
    restore: async () => false,
  });
  await coordinator.destinationReady();

  assert.deepEqual(restoredSources, [source]);
  assert.deepEqual(errors, [WORKSPACE_JUMP_ERROR_MESSAGE]);
  assert.equal(coordinator.getPending(), null);
});
