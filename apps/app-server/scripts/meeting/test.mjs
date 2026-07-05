import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MeetingService } = require("../../dist/modules/meeting/meeting.service.js");

const currentUserId = "11111111-1111-1111-1111-111111111111";
const workspaceId = "22222222-2222-2222-2222-222222222222";
const meetingId = "33333333-3333-3333-3333-333333333333";
const participantId = "44444444-4444-4444-4444-444444444444";
const recordingId = "55555555-5555-5555-5555-555555555555";
const startedAt = new Date("2026-07-05T00:00:00.000Z");
const createdAt = new Date("2026-07-05T00:00:01.000Z");
const updatedAt = new Date("2026-07-05T00:00:02.000Z");

class FakeDatabase {
  constructor({ queryOneRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queries = [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ text, values });
    const next = this.queryOneRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
  }
}

class FakeWorkspaceService {
  constructor() {
    this.calls = [];
  }

  async assertWorkspaceAccess(userId, targetWorkspaceId) {
    this.calls.push({ userId, workspaceId: targetWorkspaceId });
    return { id: targetWorkspaceId };
  }
}

function createSubject(database = new FakeDatabase()) {
  const workspaceService = new FakeWorkspaceService();
  const service = new MeetingService(database, workspaceService);
  return {
    database,
    service,
    workspaceService
  };
}

function currentMeetingRow(overrides = {}) {
  return {
    id: meetingId,
    workspace_id: workspaceId,
    room_key: "MAIN_MEETING_ROOM",
    livekit_room_name: `meeting-${meetingId}`,
    created_by_id: currentUserId,
    ended_by_id: null,
    started_at: startedAt,
    ended_at: null,
    created_at: createdAt,
    updated_at: updatedAt,
    recording_id: recordingId,
    recording_meeting_id: meetingId,
    recording_status: "RUNNING",
    recording_audio_file_url: null,
    recording_audio_file_key: null,
    recording_duration_sec: null,
    recording_file_size_bytes: null,
    recording_started_at: startedAt,
    recording_ended_at: null,
    recording_error_message: null,
    active_participant_count: 1,
    ...overrides
  };
}

function startMeetingRow(overrides = {}) {
  return {
    meeting_id: meetingId,
    meeting_workspace_id: workspaceId,
    meeting_room_key: "MAIN_MEETING_ROOM",
    meeting_livekit_room_name: `meeting-${meetingId}`,
    meeting_created_by_id: currentUserId,
    meeting_ended_by_id: null,
    meeting_started_at: startedAt,
    meeting_ended_at: null,
    meeting_created_at: createdAt,
    meeting_updated_at: updatedAt,
    participant_id: participantId,
    participant_meeting_id: meetingId,
    participant_user_id: currentUserId,
    participant_livekit_identity: `meeting-${meetingId}-user-${currentUserId}`,
    participant_joined_at: startedAt,
    participant_left_at: null,
    participant_user_name: "Jinho",
    participant_user_avatar_url: "https://example.com/avatar.png",
    ...overrides
  };
}

async function assertBadRequest(action, messagePattern) {
  await assert.rejects(action, (error) => {
    assert.equal(error.getStatus(), 400);
    assert.equal(error.getResponse().error.code, "BAD_REQUEST");
    assert.match(error.getResponse().error.message, messagePattern);
    return true;
  });
}

{
  const { service, workspaceService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        (text, values) => {
          assert.match(text, /meetings\.room_key = \$2/);
          assert.match(text, /meetings\.ended_at IS NULL/);
          assert.match(text, /meeting_participants\.left_at IS NULL/);
          assert.deepEqual(values, [workspaceId, "MAIN_MEETING_ROOM"]);
          return null;
        }
      ]
    })
  );

  const current = await service.getCurrentMeeting(currentUserId, workspaceId);

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.deepEqual(current, {
    meeting: null,
    currentRecording: null,
    activeParticipantCount: 0
  });
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow({
          active_participant_count: "2"
        })
      ]
    })
  );

  const current = await service.getCurrentMeeting(currentUserId, workspaceId);

  assert.equal(current.meeting.id, meetingId);
  assert.equal(current.meeting.roomKey, "MAIN_MEETING_ROOM");
  assert.equal(current.currentRecording.id, recordingId);
  assert.equal(current.currentRecording.status, "RUNNING");
  assert.equal(current.activeParticipantCount, 2);
  assert.equal(current.meeting.startedAt, "2026-07-05T00:00:00.000Z");
}

{
  const database = new FakeDatabase({
    queryOneRows: [
      null,
      (text, values) => {
        assert.match(text, /WITH generated AS/);
        assert.match(text, /INSERT INTO meetings/);
        assert.match(text, /INSERT INTO meeting_participants/);
        assert.doesNotMatch(text, /INSERT INTO meeting_recordings/);
        assert.deepEqual(values, [
          workspaceId,
          "MAIN_MEETING_ROOM",
          currentUserId
        ]);
        return startMeetingRow();
      }
    ]
  });
  const { service } = createSubject(database);

  const started = await service.startMeeting(currentUserId, workspaceId, {
    roomKey: "MAIN_MEETING_ROOM"
  });

  assert.equal(started.meeting.id, meetingId);
  assert.equal(started.meeting.livekitRoomName, `meeting-${meetingId}`);
  assert.equal(started.participant.user.id, currentUserId);
  assert.equal(started.participant.user.name, "Jinho");
  assert.equal(started.participant.isActive, true);
  assert.equal(started.livekit, null);
  assert.equal(started.currentRecording, null);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [currentMeetingRow()]
    })
  );

  await assertBadRequest(
    () => service.startMeeting(currentUserId, workspaceId, {}),
    /already in progress/
  );
}

{
  const { service } = createSubject();

  await assertBadRequest(
    () =>
      service.startMeeting(currentUserId, workspaceId, {
        roomKey: "OTHER_ROOM"
      }),
    /MAIN_MEETING_ROOM/
  );
}

{
  const uniqueViolation = new Error("duplicate active meeting");
  uniqueViolation.code = "23505";
  uniqueViolation.constraint = "unique_active_meeting_per_room";

  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        null,
        () => {
          throw uniqueViolation;
        }
      ]
    })
  );

  await assertBadRequest(
    () => service.startMeeting(currentUserId, workspaceId, {}),
    /already in progress/
  );
}
