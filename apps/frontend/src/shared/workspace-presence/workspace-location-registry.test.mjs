import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKSPACE_JUMP_ERROR_MESSAGE,
  createWorkspaceJumpCoordinator,
  createWorkspaceLocationRegistry,
} from "./workspace-location-registry.ts";

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
  const registry = createWorkspaceLocationRegistry();
  const unregister = registry.register({
    capture: () => location("home"),
    page: "home",
    ready: true,
    restore: async (target) => {
      restored.push(target);
      return true;
    },
  });

  assert.equal(registry.capture()?.page, "home");
  assert.equal(await registry.restore(location("home")), true);
  assert.equal(restored.length, 1);
  unregister();
  assert.equal(registry.capture(), null);
});

test("같은 route는 즉시 한 번 restore하고 cross route는 ready까지 보류한다", async () => {
  let currentHref = "/home";
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
    restore: async (target) => {
      restored.push(target.page);
      return true;
    },
  });
  await coordinator.destinationReady();
  assert.deepEqual(restored, ["home", "calendar"]);
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
