import assert from "node:assert/strict";
import test from "node:test";

import {
  readWorkspacePresenceUpdatePayload,
} from "./workspace-presence-payload.ts";
import { createWorkspacePresenceService } from "./workspace-presence.service.ts";

const workspaceId = "00000000-0000-0000-0000-000000000001";

function homeLocation(overrides = {}) {
  return {
    context: {},
    page: "home",
    route: { pathname: "/home", search: "" },
    viewport: { kind: "document", xRatio: 0.25, yRatio: 0.5 },
    ...overrides,
  };
}

test("location parser는 허용된 route와 payload 제한을 적용한다", () => {
  const parsed = readWorkspacePresenceUpdatePayload({
    focused: true,
    location: homeLocation({
      viewport: { kind: "document", xRatio: -3, yRatio: 4 },
    }),
    visible: true,
    workspaceId,
  });

  assert.deepEqual(parsed?.location?.viewport, {
    kind: "document",
    xRatio: 0,
    yRatio: 1,
  });
  assert.equal(
    readWorkspacePresenceUpdatePayload({
      focused: true,
      location: homeLocation({
        route: { pathname: "/settings", search: "" },
      }),
      visible: true,
      workspaceId,
    }),
    null,
  );
  assert.equal(
    readWorkspacePresenceUpdatePayload({
      focused: true,
      location: homeLocation({
        route: { pathname: "/home", search: `?q=${"a".repeat(2047)}` },
      }),
      visible: true,
      workspaceId,
    }),
    null,
  );
  assert.equal(
    readWorkspacePresenceUpdatePayload({
      focused: true,
      location: {
        context: { canvasId: "a".repeat(257) },
        page: "canvas",
        route: { pathname: "/canvas", search: "" },
        viewport: { kind: "camera", x: 0, y: 0, z: 1 },
      },
      visible: true,
      workspaceId,
    }),
    null,
  );
  assert.equal(
    readWorkspacePresenceUpdatePayload({
      focused: true,
      location: {
        context: { sessionId: "session-1" },
        page: "sql-erd",
        route: { pathname: "/sql-erd/session", search: "?sessionId=session-1" },
        viewport: { kind: "camera", x: Number.NaN, y: 0, z: 1 },
      },
      visible: true,
      workspaceId,
    }),
    null,
  );
});

test("대표 탭은 focused+visible, visible, 최신 연결 순서로 선택된다", () => {
  let now = Date.parse("2026-07-16T00:00:00.000Z");
  const service = createWorkspacePresenceService({
    now: () => new Date(now),
  });
  const user = { displayName: "세인", userId: "user-1" };

  service.joinSocket("background", user, workspaceId);
  service.updateSocket("background", {
    focused: false,
    location: homeLocation(),
    visible: true,
    workspaceId,
  });
  now += 1_000;
  service.joinSocket("foreground", user, workspaceId);
  service.updateSocket("foreground", {
    focused: true,
    location: homeLocation({ page: "calendar", route: { pathname: "/calendar", search: "" } }),
    visible: true,
    workspaceId,
  });

  assert.equal(service.getWorkspacePresence(workspaceId)[0]?.location?.page, "calendar");

  now += 1_000;
  service.updateSocket("foreground", {
    focused: false,
    location: homeLocation({ page: "board", route: { pathname: "/board", search: "" }, context: { boardId: "board-1" }, viewport: { kind: "element", key: "board-kanban", xRatio: 0, yRatio: 0 } }),
    visible: false,
    workspaceId,
  });
  assert.equal(service.getWorkspacePresence(workspaceId)[0]?.location?.page, "home");
});

test("background update는 활성 시각을 전진시키지 않고 마지막 탭에서만 leave한다", () => {
  let now = Date.parse("2026-07-16T00:00:00.000Z");
  const service = createWorkspacePresenceService({ now: () => new Date(now) });
  const user = { displayName: "은재", userId: "user-2" };

  service.joinSocket("tab-a", user, workspaceId);
  service.updateSocket("tab-a", {
    focused: true,
    location: homeLocation(),
    visible: true,
    workspaceId,
  });
  const activeAt = service.getWorkspacePresence(workspaceId)[0]?.lastActiveAt;

  now += 1_000;
  service.updateSocket("tab-a", {
    focused: false,
    location: homeLocation(),
    visible: false,
    workspaceId,
  });
  assert.equal(service.getWorkspacePresence(workspaceId)[0]?.lastActiveAt, activeAt);

  now += 1_000;
  service.joinSocket("tab-b", user, workspaceId);
  service.updateSocket("tab-b", {
    focused: true,
    location: homeLocation({ page: "calendar", route: { pathname: "/calendar", search: "" } }),
    visible: true,
    workspaceId,
  });

  assert.equal(service.leaveSocket("tab-b", workspaceId)?.kind, "update");
  assert.deepEqual(service.leaveSocket("tab-a", workspaceId), {
    kind: "leave",
    payload: { userId: "user-2", workspaceId },
  });
});

test("joinSocket은 새 background 탭이 아니라 사용자 대표 foreground를 반환한다", () => {
  const service = createWorkspacePresenceService();
  const user = { displayName: "세인", userId: "user-1" };
  service.joinSocket("foreground", user, workspaceId);
  service.updateSocket("foreground", {
    focused: true,
    location: homeLocation(),
    visible: true,
    workspaceId,
  });

  const representative = service.joinSocket("background", user, workspaceId);

  assert.equal(representative.focused, true);
  assert.equal(representative.location?.page, "home");
});
