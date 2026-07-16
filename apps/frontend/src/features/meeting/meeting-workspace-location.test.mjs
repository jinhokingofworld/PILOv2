import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMeetingWorkspaceLocation, readMeetingRoomId } from "./meeting-workspace-location.ts";
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
