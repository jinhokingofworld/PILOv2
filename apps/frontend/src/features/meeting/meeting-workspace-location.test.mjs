import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createMeetingReportWorkspaceLocation,
  createMeetingReportRequestGuard,
  createMeetingWorkspaceLocation,
  readMeetingReportTarget,
  readMeetingRoomId,
  waitForMeetingContentTarget
} from "./meeting-workspace-location.ts";
import {
  consumeMeetingConnectionAction,
  enqueueMeetingConnectionAction
} from "./stores/meeting-connection-action-store.ts";

test("Meeting은 room 선택과 document 위치만 복원하고 회의에 입장하지 않는다", async () => {
  const location = createMeetingWorkspaceLocation("room-1", { clientHeight: 500, clientWidth: 800, scrollHeight: 1500, scrollLeft: 0, scrollTop: 250, scrollWidth: 800 });
  assert.equal(location.route.search, "?meetingRoomId=room-1");
  assert.equal(readMeetingRoomId(location, ["room-1", "room-2"]), "room-1");
  assert.equal(readMeetingRoomId(location, ["room-2"]), undefined);
  const adapter = await readFile(new URL("./meeting-workspace-location-adapter.tsx", import.meta.url), "utf8");
  assert.match(adapter, /selectMeetingRoom/);
  assert.doesNotMatch(adapter, /(joinMeeting|startMeeting|connectToMeeting)/);
  const host = await readFile(new URL("./components/meeting-panel.tsx", import.meta.url), "utf8");
  assert.match(host, /MeetingWorkspaceLocationAdapter/);
});

test("Meeting은 room 목록 load 후 null room target의 document 위치를 복원한다", async () => {
  const location = createMeetingWorkspaceLocation(null, { clientHeight: 500, clientWidth: 800, scrollHeight: 1500, scrollLeft: 0, scrollTop: 500, scrollWidth: 800 });
  assert.equal(location.route.search, "");
  assert.equal(readMeetingRoomId(location, []), null);
  const adapter = await readFile(new URL("./meeting-workspace-location-adapter.tsx", import.meta.url), "utf8");
  assert.match(adapter, /roomsReady/);
  assert.match(adapter, /roomId !== null/);
  assert.doesNotMatch(adapter, /(joinMeeting|startMeeting|connectToMeeting)/);
});

test("Meeting 회의록은 선택 dialog와 내부 scroll 위치를 capture한다", () => {
  const location = createMeetingReportWorkspaceLocation("report-1", {
    clientHeight: 400,
    clientWidth: 800,
    scrollHeight: 1200,
    scrollLeft: 0,
    scrollTop: 400,
    scrollWidth: 800
  });

  assert.deepEqual(location.context, {
    meetingRoomId: null,
    reportId: "report-1"
  });
  assert.deepEqual(location.route, {
    pathname: "/report",
    search: "?reportId=report-1"
  });
  assert.deepEqual(location.viewport, {
    kind: "element",
    key: "meeting-content",
    xRatio: 0,
    yRatio: 0.5
  });
  assert.deepEqual(readMeetingReportTarget(location), {
    reportId: "report-1",
    viewport: location.viewport
  });
  assert.equal(readMeetingReportTarget(createMeetingWorkspaceLocation("room-1", {
    clientHeight: 400,
    clientWidth: 800,
    scrollHeight: 1200,
    scrollLeft: 0,
    scrollTop: 400,
    scrollWidth: 800
  })), null);
});

test("Meeting 회의록 복원 대기는 abort된 stale dialog를 적용하지 않는다", async () => {
  const controller = new AbortController();
  const pendingTarget = waitForMeetingContentTarget({
    findTarget: () => null,
    intervalMs: 1,
    signal: controller.signal,
    timeoutMs: 100
  });

  controller.abort();
  assert.equal(await pendingTarget, null);

  const adapter = await readFile(new URL("./meeting-workspace-location-adapter.tsx", import.meta.url), "utf8");
  const reportSection = await readFile(new URL("./components/meeting-report-section.tsx", import.meta.url), "utf8");
  assert.match(adapter, /MeetingReportWorkspaceLocationAdapter/);
  assert.match(adapter, /signal/);
  assert.match(adapter, /target\.reportId !== selectedReportId/);
  assert.match(reportSection, /data-workspace-follow-surface="meeting-content"/);
  assert.match(reportSection, /MeetingReportWorkspaceLocationAdapter/);
});

test("Meeting 회의록 상세는 늦게 끝난 A가 최신 B를 덮지 않는다", async () => {
  const guard = createMeetingReportRequestGuard();
  const applied = [];
  let resolveReportA;
  const reportAGate = new Promise((resolve) => {
    resolveReportA = resolve;
  });
  const reportA = guard.begin("report-a");
  const reportARequest = reportAGate.then(() => {
    if (guard.isCurrent(reportA)) applied.push(reportA.reportId);
  });
  const reportB = guard.begin("report-b");

  if (guard.isCurrent(reportB)) applied.push(reportB.reportId);
  resolveReportA();
  await reportARequest;

  assert.deepEqual(applied, ["report-b"]);
});

test("Meeting 회의록 상세는 dialog를 닫은 뒤 A 응답을 무시한다", async () => {
  const guard = createMeetingReportRequestGuard();
  const applied = [];
  let resolveReportA;
  const reportAGate = new Promise((resolve) => {
    resolveReportA = resolve;
  });
  const reportA = guard.begin("report-a");
  const reportARequest = reportAGate.then(() => {
    if (guard.isCurrent(reportA)) applied.push(reportA.reportId);
  });

  guard.invalidate();
  resolveReportA();
  await reportARequest;

  assert.deepEqual(applied, []);
  const reportSection = await readFile(new URL("./components/meeting-report-section.tsx", import.meta.url), "utf8");
  assert.match(reportSection, /reportDetailRequestGuardRef\.current\.isCurrent/);
  assert.match(reportSection, /reportDetailRequestGuardRef\.current\.invalidate/);
});

test("Meeting Agent 연결 action은 메모리에서 한 번만 소비하고 만료를 거부한다", () => {
  const action = {
    actionId: "agent-step:step-1:connect_meeting",
    meetingId: "meeting-1",
    meetingRoomId: "room-1",
    expiresAtMs: 2_000,
    workspaceId: "workspace-1"
  };

  assert.equal(enqueueMeetingConnectionAction(action, 1_000), true);
  assert.equal(enqueueMeetingConnectionAction(action, 1_000), false);
  assert.deepEqual(consumeMeetingConnectionAction(1_000), action);
  assert.equal(consumeMeetingConnectionAction(1_000), null);
  assert.equal(
    enqueueMeetingConnectionAction(
      { ...action, actionId: "agent-step:step-2:connect_meeting" },
      2_000
    ),
    false
  );
});
