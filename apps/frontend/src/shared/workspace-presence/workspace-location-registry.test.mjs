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
