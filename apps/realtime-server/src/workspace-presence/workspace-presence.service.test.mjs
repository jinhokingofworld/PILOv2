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

function prReviewLocation(overrides = {}) {
  return {
    context: { reviewSessionId: "session-1" },
    page: "pr-review",
    route: {
      pathname: "/pr-review",
      search: "?reviewSessionId=session-1",
    },
    viewport: { kind: "camera", x: 0, y: 0, z: 1 },
    ...overrides,
  };
}

function presenceUpdate(location) {
  return {
    focused: true,
    location,
    visible: true,
    workspaceId,
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

test("기존 PR camera payload는 누락된 reviewFileId를 null로 정규화한다", () => {
  const parsed = readWorkspacePresenceUpdatePayload(
    presenceUpdate(prReviewLocation()),
  );

  assert.deepEqual(parsed?.location?.context, {
    reviewFileId: null,
    reviewSessionId: "session-1",
  });
});

test("PR diff payload는 opaque ID를 보존하고 scroll ratio를 clamp한다", () => {
  const parsed = readWorkspacePresenceUpdatePayload(
    presenceUpdate(
      prReviewLocation({
        context: {
          reviewFileId: " file-opaque-1 ",
          reviewSessionId: " session-1 ",
        },
        viewport: {
          kind: "element",
          key: "pr-review-diff",
          xRatio: 0.25,
          yRatio: 1.4,
        },
      }),
    ),
  );

  assert.deepEqual(parsed?.location?.context, {
    reviewFileId: "file-opaque-1",
    reviewSessionId: "session-1",
  });
  assert.deepEqual(parsed?.location?.viewport, {
    kind: "element",
    key: "pr-review-diff",
    xRatio: 0.25,
    yRatio: 1,
  });
});

test("PR inspector payload를 허용한다", () => {
  const parsed = readWorkspacePresenceUpdatePayload(
    presenceUpdate(
      prReviewLocation({
        context: {
          reviewFileId: "file-1",
          reviewSessionId: "session-1",
        },
        viewport: {
          kind: "element",
          key: "pr-review-inspector",
          xRatio: 0,
          yRatio: 0.5,
        },
      }),
    ),
  );

  assert.equal(parsed?.location?.viewport.kind, "element");
  assert.equal(parsed?.location?.viewport.key, "pr-review-inspector");
});

test("PR file ID에 대응하는 session ID가 없으면 거부한다", () => {
  const parsed = readWorkspacePresenceUpdatePayload(
    presenceUpdate(
      prReviewLocation({
        context: { reviewFileId: "file-1", reviewSessionId: null },
        viewport: {
          kind: "element",
          key: "pr-review-diff",
          xRatio: 0,
          yRatio: 0,
        },
      }),
    ),
  );

  assert.equal(parsed, null);
});

test("PR element viewport에 file ID가 없으면 거부한다", () => {
  for (const context of [
    { reviewFileId: null, reviewSessionId: "session-1" },
    { reviewSessionId: "session-1" },
  ]) {
    const parsed = readWorkspacePresenceUpdatePayload(
      presenceUpdate(
        prReviewLocation({
          context,
          viewport: {
            kind: "element",
            key: "pr-review-diff",
            xRatio: 0,
            yRatio: 0,
          },
        }),
      ),
    );

    assert.equal(parsed, null);
  }
});

test("PR element key를 다른 page에서 사용하면 거부한다", () => {
  for (const location of [
    homeLocation({
      viewport: {
        kind: "element",
        key: "pr-review-diff",
        xRatio: 0,
        yRatio: 0,
      },
    }),
    homeLocation({
      context: { boardId: "board-1" },
      page: "board",
      route: { pathname: "/board", search: "" },
      viewport: {
        kind: "element",
        key: "pr-review-inspector",
        xRatio: 0,
        yRatio: 0,
      },
    }),
  ]) {
    assert.equal(
      readWorkspacePresenceUpdatePayload(presenceUpdate(location)),
      null,
    );
  }
});

test("PR context의 잘못된 identifier를 거부한다", () => {
  for (const context of [
    { reviewFileId: "a".repeat(257), reviewSessionId: "session-1" },
    { reviewFileId: " ", reviewSessionId: "session-1" },
    { reviewFileId: "file-1", reviewSessionId: " " },
  ]) {
    assert.equal(
      readWorkspacePresenceUpdatePayload(
        presenceUpdate(prReviewLocation({ context })),
      ),
      null,
    );
  }
});

test("PR element viewport의 non-finite ratio를 거부한다", () => {
  const parsed = readWorkspacePresenceUpdatePayload(
    presenceUpdate(
      prReviewLocation({
        context: {
          reviewFileId: "file-1",
          reviewSessionId: "session-1",
        },
        viewport: {
          kind: "element",
          key: "pr-review-diff",
          xRatio: Number.NaN,
          yRatio: 0,
        },
      }),
    ),
  );

  assert.equal(parsed, null);
});

test("page context의 허용되지 않은 추가 key를 거부한다", () => {
  for (const context of [
    { rawDiff: "secret", reviewFileId: "file-1", reviewSessionId: "session-1" },
    { content: "secret", reviewFileId: "file-1", reviewSessionId: "session-1" },
    { draft: "unsaved", reviewFileId: "file-1", reviewSessionId: "session-1" },
    { comment: "private", reviewFileId: "file-1", reviewSessionId: "session-1" },
  ]) {
    assert.equal(
      readWorkspacePresenceUpdatePayload(
        presenceUpdate(prReviewLocation({ context })),
      ),
      null,
    );
  }
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

function elementViewport(key) {
  return { kind: "element", key, xRatio: 0.25, yRatio: 0.5 };
}

test("Canvas selection 확장은 기존 camera-only payload와 함께 허용한다", () => {
  const legacy = readWorkspacePresenceUpdatePayload(
    presenceUpdate({
      context: { canvasId: "canvas-1" },
      page: "canvas",
      route: { pathname: "/canvas", search: "?canvasId=canvas-1" },
      viewport: { kind: "camera", x: 1, y: 2, z: 1.5 },
    }),
  );
  const selected = readWorkspacePresenceUpdatePayload(
    presenceUpdate({
      context: { canvasId: " canvas-1 " },
      page: "canvas",
      route: { pathname: "/canvas", search: "?canvasId=canvas-1" },
      viewport: {
        kind: "camera",
        selectedShapeIds: [" shape:one ", "shape:two"],
        x: 1,
        y: 2,
        z: 1.5,
      },
    }),
  );

  assert.deepEqual(legacy?.location?.viewport.selectedShapeIds, []);
  assert.deepEqual(selected?.location?.viewport.selectedShapeIds, [
    "shape:one",
    "shape:two",
  ]);
});

test("Canvas selection은 잘못된 ID와 transient 편집 상태를 거부한다", () => {
  for (const { context, selectedShapeIds } of [
    { context: { canvasId: "canvas-1" }, selectedShapeIds: ["shape:one", 2] },
    { context: { canvasId: "canvas-1" }, selectedShapeIds: [" "] },
    {
      context: { canvasId: "canvas-1", editingShapeId: "shape:one" },
      selectedShapeIds: [],
    },
    { context: { canvasId: "canvas-1", aiChatOpen: "true" }, selectedShapeIds: [] },
    { context: { canvasId: "canvas-1", popover: "color" }, selectedShapeIds: [] },
  ]) {
    assert.equal(
      readWorkspacePresenceUpdatePayload(
        presenceUpdate({
          context,
          page: "canvas",
          route: { pathname: "/canvas", search: "" },
          viewport: { kind: "camera", selectedShapeIds, x: 0, y: 0, z: 1 },
        }),
      ),
      null,
    );
  }
});

test("Meeting context는 생략 ID를 null로 정규화하고 두 route를 허용한다", () => {
  const meeting = readWorkspacePresenceUpdatePayload(
    presenceUpdate({
      context: { meetingRoomId: " room-1 " },
      page: "meeting",
      route: { pathname: "/meeting", search: "?meetingRoomId=room-1" },
      viewport: elementViewport("meeting-content"),
    }),
  );
  const report = readWorkspacePresenceUpdatePayload(
    presenceUpdate({
      context: { reportId: " report-1 " },
      page: "meeting",
      route: { pathname: "/report", search: "?reportId=report-1" },
      viewport: { kind: "document", xRatio: 0, yRatio: 0.5 },
    }),
  );

  assert.deepEqual(meeting?.location?.context, {
    meetingRoomId: "room-1",
    reportId: null,
  });
  assert.deepEqual(report?.location?.context, {
    meetingRoomId: null,
    reportId: "report-1",
  });
});

test("Meeting route와 context 조합이 어긋나면 거부한다", () => {
  for (const location of [
    {
      context: { meetingRoomId: null, reportId: "report-1" },
      page: "meeting",
      route: { pathname: "/meeting", search: "" },
      viewport: { kind: "document", xRatio: 0, yRatio: 0 },
    },
    {
      context: { meetingRoomId: "room-1", reportId: null },
      page: "meeting",
      route: { pathname: "/report", search: "" },
      viewport: elementViewport("meeting-content"),
    },
  ]) {
    assert.equal(readWorkspacePresenceUpdatePayload(presenceUpdate(location)), null);
  }
});

test("Chat message 위치와 message list viewport를 허용한다", () => {
  const parsed = readWorkspacePresenceUpdatePayload(
    presenceUpdate({
      context: { messageId: " message-1 " },
      page: "chat",
      route: { pathname: "/chat", search: "?messageId=message-1" },
      viewport: elementViewport("chat-messages"),
    }),
  );

  assert.deepEqual(parsed?.location?.context, {
    messageId: "message-1",
    threadId: null,
  });
  assert.equal(parsed?.location?.viewport.key, "chat-messages");
});

test("Chat은 다른 page의 element key와 transient draft를 거부한다", () => {
  for (const location of [
    {
      context: { messageId: "message-1", threadId: null, draft: "secret" },
      page: "chat",
      route: { pathname: "/chat", search: "" },
      viewport: elementViewport("chat-messages"),
    },
    {
      context: {},
      page: "home",
      route: { pathname: "/home", search: "" },
      viewport: elementViewport("chat-messages"),
    },
  ]) {
    assert.equal(readWorkspacePresenceUpdatePayload(presenceUpdate(location)), null);
  }
});

test("확인된 2차 surface key와 context 조합을 허용한다", () => {
  const locations = [
    {
      context: { boardId: "board-1", issueId: "issue-1" },
      page: "board",
      route: { pathname: "/board", search: "?boardId=board-1&issueId=issue-1" },
      viewport: elementViewport("board-issue-sheet"),
    },
    {
      context: { eventId: "event-1", selectedDate: "2026-07-18" },
      page: "calendar",
      route: { pathname: "/calendar", search: "?date=2026-07-18" },
      viewport: elementViewport("calendar-event-detail"),
    },
    {
      context: { eventId: null, selectedDate: "2026-07-18" },
      page: "calendar",
      route: { pathname: "/calendar", search: "?date=2026-07-18" },
      viewport: elementViewport("calendar-events-dialog"),
    },
    {
      context: {
        sessionId: "session-1",
        sqlErdInspectorOpen: "true",
        sqlErdSelectionId: "relation-1",
        sqlErdSelectionTableId: null,
        sqlErdSelectionType: "relation",
      },
      page: "sql-erd",
      route: { pathname: "/sql-erd/session", search: "?sessionId=session-1" },
      viewport: elementViewport("sql-erd-inspector"),
    },
    {
      context: {
        documentId: null,
        folderId: "folder-1",
        pdfFileId: "pdf-1",
        pdfPage: "3",
      },
      page: "drive",
      route: { pathname: "/files", search: "?folderId=folder-1" },
      viewport: elementViewport("drive-pdf"),
    },
  ];

  for (const location of locations) {
    assert.ok(readWorkspacePresenceUpdatePayload(presenceUpdate(location)));
  }
});
