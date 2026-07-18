import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createCalendarWorkspaceLocation,
  getCalendarScrollOffset,
  readCalendarWorkspaceTarget,
  waitForCalendarScrollTarget,
} from "./calendar-workspace-location.ts";

const metrics = {
  clientHeight: 300,
  clientWidth: 400,
  scrollHeight: 900,
  scrollLeft: 300,
  scrollTop: 300,
  scrollWidth: 1_000,
};

test("Calendar grid 위치는 선택 날짜와 양축 스크롤을 capture한다", () => {
  const location = createCalendarWorkspaceLocation(
    {
      eventId: null,
      selectedDate: "2026-07-16",
      surface: "calendar-grid",
    },
    metrics,
  );

  assert.deepEqual(location?.context, {
    eventId: null,
    selectedDate: "2026-07-16",
  });
  assert.equal(location?.route.search, "?date=2026-07-16");
  assert.deepEqual(location?.viewport, {
    kind: "element",
    key: "calendar-grid",
    xRatio: 0.5,
    yRatio: 0.5,
  });
});

test("Calendar event detail은 event ID와 활성 내부 세로 스크롤을 capture한다", () => {
  const location = createCalendarWorkspaceLocation(
    {
      eventId: "42",
      selectedDate: "2026-07-16",
      surface: "calendar-event-detail",
    },
    { ...metrics, scrollLeft: 0 },
  );

  assert.deepEqual(location?.context, {
    eventId: "42",
    selectedDate: "2026-07-16",
  });
  assert.deepEqual(location?.viewport, {
    kind: "element",
    key: "calendar-event-detail",
    xRatio: 0,
    yRatio: 0.5,
  });
});

test("Calendar events dialog은 선택 날짜와 활성 내부 세로 스크롤을 capture한다", () => {
  const location = createCalendarWorkspaceLocation(
    {
      eventId: null,
      selectedDate: "2026-07-20",
      surface: "calendar-events-dialog",
    },
    metrics,
  );

  assert.equal(location?.context.eventId, null);
  assert.equal(location?.viewport.key, "calendar-events-dialog");
  assert.equal(location?.viewport.yRatio, 0.5);
});

test("Calendar restore target은 surface별 context 조합을 검증한다", () => {
  const detail = createCalendarWorkspaceLocation(
    {
      eventId: "42",
      selectedDate: "2026-07-16",
      surface: "calendar-event-detail",
    },
    metrics,
  );
  assert.deepEqual(readCalendarWorkspaceTarget(detail), {
    eventId: "42",
    selectedDate: "2026-07-16",
    surface: "calendar-event-detail",
    viewport: detail?.viewport,
  });

  assert.equal(
    readCalendarWorkspaceTarget({
      ...detail,
      context: { eventId: null, selectedDate: "2026-07-16" },
    }),
    null,
  );
  assert.equal(
    readCalendarWorkspaceTarget({
      ...detail,
      context: { eventId: "42", selectedDate: "not-a-date" },
    }),
    null,
  );
});

test("Calendar scroll 복원은 비율을 안전 범위로 제한한다", () => {
  assert.deepEqual(
    getCalendarScrollOffset(
      { xRatio: 2, yRatio: -1 },
      {
        clientHeight: 300,
        clientWidth: 400,
        scrollHeight: 900,
        scrollWidth: 1_000,
      },
    ),
    { left: 600, top: 0 },
  );
});

test("Calendar restore는 dialog가 mount될 때까지 기다리고 abort를 존중한다", async () => {
  let target = null;
  const controller = new AbortController();
  const pending = waitForCalendarScrollTarget({
    eventId: "42",
    findTarget: () => target,
    intervalMs: 1,
    selectedDate: "2026-07-16",
    signal: controller.signal,
    surface: "calendar-event-detail",
    timeoutMs: 100,
  });
  target = {
    element: { id: "detail" },
    eventId: "42",
    selectedDate: "2026-07-16",
    surface: "calendar-event-detail",
  };
  assert.deepEqual(await pending, { id: "detail" });

  const abortedController = new AbortController();
  const aborted = waitForCalendarScrollTarget({
    eventId: null,
    findTarget: () => null,
    intervalMs: 1,
    selectedDate: "2026-07-16",
    signal: abortedController.signal,
    surface: "calendar-grid",
    timeoutMs: 100,
  });
  abortedController.abort();
  assert.equal(await aborted, null);
});

test("Calendar adapter는 공통 수동 취소를 재사용하고 읽기 dialog marker만 연결한다", async () => {
  const adapter = await readFile(
    new URL("./calendar-workspace-location-adapter.tsx", import.meta.url),
    "utf8",
  );
  const host = await readFile(
    new URL("./components/calendar-panel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(adapter, /waitForCalendarScrollTarget/);
  assert.match(adapter, /signal/);
  assert.doesNotMatch(adapter, /reportManualInteraction|stopFollowing/);
  assert.match(host, /calendar-event-detail/);
  assert.match(host, /calendar-events-dialog/);
  assert.match(host, /data-workspace-follow-surface/);
  assert.match(host, /onOpenEventById/);
  assert.match(host, /onOpenEventsByDate/);
});
