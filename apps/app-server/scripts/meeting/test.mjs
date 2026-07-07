import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MeetingService } = require("../../dist/modules/meeting/meeting.service.js");
const { badRequest } = require("../../dist/common/api-error.js");

const currentUserId = "11111111-1111-1111-1111-111111111111";
const workspaceId = "22222222-2222-2222-2222-222222222222";
const meetingId = "33333333-3333-3333-3333-333333333333";
const participantId = "44444444-4444-4444-4444-444444444444";
const recordingId = "55555555-5555-5555-5555-555555555555";
const secondRecordingId = "66666666-6666-6666-6666-666666666666";
const reportId = "77777777-7777-7777-7777-777777777777";
const otherUserId = "88888888-8888-8888-8888-888888888888";
const otherParticipantId = "99999999-9999-9999-9999-999999999999";
const startedAt = new Date("2026-07-05T00:00:00.000Z");
const createdAt = new Date("2026-07-05T00:00:01.000Z");
const updatedAt = new Date("2026-07-05T00:00:02.000Z");
const leftAt = new Date("2026-07-05T00:10:00.000Z");
const endedAt = new Date("2026-07-05T00:10:01.000Z");

class FakeDatabase {
  constructor({ queryOneRows = [], queryRows = [] } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queryRows = [...queryRows];
    this.queries = [];
    this.transactionCommitted = false;
    this.transactionRolledBack = false;
  }

  async query(text, values = []) {
    this.queries.push({ text, values });
    const next = this.queryRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? [];
  }

  async queryOne(text, values = []) {
    this.queries.push({ text, values });
    const next = this.queryOneRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
  }

  async transaction(callback) {
    try {
      const result = await callback(this);
      this.transactionCommitted = true;
      return result;
    } catch (error) {
      this.transactionRolledBack = true;
      throw error;
    }
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

class FakeLiveKitTokenService {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.calls = [];
  }

  async createJoinToken(input) {
    this.calls.push(input);

    if (this.shouldFail) {
      throw new Error("LiveKit token could not be issued");
    }

    return {
      livekitRoomName: input.livekitRoomName,
      livekitIdentity: input.livekitIdentity,
      livekitToken: `token-for-${input.livekitIdentity}`,
      livekitUrl: "wss://livekit.example.test",
      expiresAt: "2026-07-05T01:00:00.000Z"
    };
  }
}

class FakeLiveKitEgressService {
  constructor({ startShouldFail = false, stopShouldFail = false } = {}) {
    this.startShouldFail = startShouldFail;
    this.stopShouldFail = stopShouldFail;
    this.startCalls = [];
    this.stopCalls = [];
    this.stopResult = {
      status: "COMPLETED",
      audioFileKey: `recordings/meetings/workspaces/${workspaceId}/meetings/${meetingId}/recordings/${recordingId}.mp3`,
      durationSec: 180,
      fileSizeBytes: 8192,
      errorMessage: null
    };
  }

  async startRoomAudioOnlyEgress(input) {
    this.startCalls.push(input);

    if (this.startShouldFail) {
      throw new Error("LiveKit Egress could not be started");
    }

    return {
      livekitEgressId: "egress-1"
    };
  }

  async stopEgress(livekitEgressId) {
    this.stopCalls.push({ livekitEgressId });

    if (this.stopShouldFail) {
      throw new Error("LiveKit Egress could not be stopped");
    }

    return this.stopResult;
  }
}

class FakeMeetingReportJobService {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.calls = [];
  }

  async enqueueMeetingReportJob(payload) {
    this.calls.push(payload);

    if (this.shouldFail) {
      throw badRequest("Meeting report job could not be enqueued");
    }
  }
}

function createSubject(
  database = new FakeDatabase(),
  liveKitTokenService = new FakeLiveKitTokenService(),
  liveKitEgressService = new FakeLiveKitEgressService(),
  meetingReportJobService = new FakeMeetingReportJobService()
) {
  const workspaceService = new FakeWorkspaceService();
  const service = new MeetingService(
    database,
    workspaceService,
    liveKitTokenService,
    liveKitEgressService,
    meetingReportJobService
  );
  return {
    database,
    service,
    workspaceService,
    liveKitTokenService,
    liveKitEgressService,
    meetingReportJobService
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
    recording_livekit_egress_id: "egress-1",
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

function participantRow(overrides = {}) {
  return {
    id: participantId,
    meeting_id: meetingId,
    user_id: currentUserId,
    livekit_identity: `meeting-${meetingId}-user-${currentUserId}`,
    joined_at: startedAt,
    left_at: null,
    user_name: "Jinho",
    user_avatar_url: "https://example.com/avatar.png",
    ...overrides
  };
}

function recordingRow(overrides = {}) {
  return {
    id: recordingId,
    meeting_id: meetingId,
    livekit_egress_id: "egress-1",
    status: "RUNNING",
    audio_file_url: null,
    audio_file_key: null,
    duration_sec: null,
    file_size_bytes: null,
    started_at: startedAt,
    ended_at: null,
    error_message: null,
    ...overrides
  };
}

function meetingReportRow(overrides = {}) {
  return {
    id: reportId,
    meeting_id: meetingId,
    recording_id: recordingId,
    status: "COMPLETED",
    failed_step: null,
    error_message: null,
    summary: "요약",
    discussion_points: "논의사항",
    decisions: "결정사항",
    action_item_candidates: [{ title: "후속 작업" }],
    retry_count: 0,
    created_at: createdAt,
    updated_at: updatedAt,
    ...overrides
  };
}

function meetingReportRegenerationRow(overrides = {}) {
  return {
    ...meetingReportRow({
      status: "FAILED",
      failed_step: "STT",
      error_message: "STT failed safely",
      summary: "이전 요약",
      discussion_points: "이전 논의사항",
      decisions: "이전 결정사항",
      action_item_candidates: [{ title: "이전 후속 작업" }],
      retry_count: 1
    }),
    transcript_text: "이전 전문",
    recording_status: "COMPLETED",
    recording_audio_file_key: `recordings/meetings/workspaces/${workspaceId}/meetings/${meetingId}/recordings/${recordingId}.mp3`,
    ...overrides
  };
}

function activeParticipantCountRow(count) {
  return {
    active_participant_count: count
  };
}

function participantCountRow(participantCount, activeParticipantCount) {
  return {
    participant_count: participantCount,
    active_participant_count: activeParticipantCount
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

async function assertMeetingAlreadyInProgress(action) {
  await assert.rejects(action, (error) => {
    assert.equal(error.getStatus(), 400);
    assert.equal(
      error.getResponse().error.code,
      "MEETING_ALREADY_IN_PROGRESS"
    );
    assert.match(error.getResponse().error.message, /already in progress/);
    return true;
  });
}

async function assertNotFound(action, messagePattern) {
  await assert.rejects(action, (error) => {
    assert.equal(error.getStatus(), 404);
    assert.equal(error.getResponse().error.code, "NOT_FOUND");
    assert.match(error.getResponse().error.message, messagePattern);
    return true;
  });
}

async function assertError(action, messagePattern) {
  await assert.rejects(action, (error) => {
    assert.match(error.message, messagePattern);
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
  const { service, liveKitTokenService } = createSubject(database);

  const started = await service.startMeeting(currentUserId, workspaceId, {
    roomKey: "MAIN_MEETING_ROOM"
  });

  assert.equal(started.meeting.id, meetingId);
  assert.equal(started.meeting.livekitRoomName, `meeting-${meetingId}`);
  assert.equal(started.participant.user.id, currentUserId);
  assert.equal(started.participant.user.name, "Jinho");
  assert.equal(started.participant.isActive, true);
  assert.deepEqual(liveKitTokenService.calls, [
    {
      livekitRoomName: `meeting-${meetingId}`,
      livekitIdentity: `meeting-${meetingId}-user-${currentUserId}`,
      participantName: "Jinho"
    }
  ]);
  assert.deepEqual(started.livekit, {
    livekitRoomName: `meeting-${meetingId}`,
    livekitIdentity: `meeting-${meetingId}-user-${currentUserId}`,
    livekitToken: `token-for-meeting-${meetingId}-user-${currentUserId}`,
    livekitUrl: "wss://livekit.example.test",
    expiresAt: "2026-07-05T01:00:00.000Z"
  });
  assert.equal(started.currentRecording, null);
  assert.equal(database.transactionCommitted, true);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [currentMeetingRow()]
    })
  );

  await assertMeetingAlreadyInProgress(() =>
    service.startMeeting(currentUserId, workspaceId, {})
  );
}

{
  const database = new FakeDatabase({
    queryOneRows: [null, startMeetingRow()]
  });
  const { service, liveKitTokenService } = createSubject(
    database,
    new FakeLiveKitTokenService({ shouldFail: true })
  );

  await assertError(
    () => service.startMeeting(currentUserId, workspaceId, {}),
    /LiveKit token could not be issued/
  );
  assert.equal(database.transactionRolledBack, true);
  assert.equal(liveKitTokenService.calls.length, 1);
  assert.equal(
    database.queries.some(({ values }) =>
      values.some((value) => typeof value === "string" && value.includes("token"))
    ),
    false
  );
}

{
  const { service, workspaceService, liveKitTokenService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        (text, values) => {
          assert.match(text, /WHERE meetings\.workspace_id = \$1/);
          assert.match(text, /AND meetings\.id = \$2/);
          assert.match(text, /FOR UPDATE OF meetings/);
          assert.deepEqual(values, [workspaceId, meetingId]);
          return currentMeetingRow({
            recording_id: null,
            recording_meeting_id: null,
            recording_status: null,
            recording_started_at: null
          });
        },
        (text, values) => {
          assert.match(text, /ON CONFLICT \(meeting_id, user_id\)/);
          assert.match(text, /left_at = NULL/);
          assert.deepEqual(values, [meetingId, currentUserId]);
          return participantRow();
        }
      ]
    })
  );

  const joined = await service.joinMeeting(currentUserId, workspaceId, meetingId);

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.equal(joined.meeting.id, meetingId);
  assert.equal(joined.participant.id, participantId);
  assert.equal(joined.participant.isActive, true);
  assert.deepEqual(liveKitTokenService.calls, [
    {
      livekitRoomName: `meeting-${meetingId}`,
      livekitIdentity: `meeting-${meetingId}-user-${currentUserId}`,
      participantName: "Jinho"
    }
  ]);
  assert.deepEqual(joined.livekit, {
    livekitRoomName: `meeting-${meetingId}`,
    livekitIdentity: `meeting-${meetingId}-user-${currentUserId}`,
    livekitToken: `token-for-meeting-${meetingId}-user-${currentUserId}`,
    livekitUrl: "wss://livekit.example.test",
    expiresAt: "2026-07-05T01:00:00.000Z"
  });
  assert.equal(joined.currentRecording, null);
}

{
  const { service, workspaceService, liveKitTokenService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        (text, values) => {
          assert.match(text, /WHERE meetings\.workspace_id = \$1/);
          assert.match(text, /AND meetings\.id = \$2/);
          assert.match(text, /FOR UPDATE OF meetings/);
          assert.deepEqual(values, [workspaceId, meetingId]);
          return currentMeetingRow({
            created_by_id: currentUserId,
            recording_id: null,
            recording_meeting_id: null,
            recording_status: null,
            recording_started_at: null
          });
        },
        (text, values) => {
          assert.match(text, /ON CONFLICT \(meeting_id, user_id\)/);
          assert.match(text, /left_at = NULL/);
          assert.deepEqual(values, [meetingId, otherUserId]);
          return participantRow({
            id: otherParticipantId,
            user_id: otherUserId,
            livekit_identity: `meeting-${meetingId}-user-${otherUserId}`,
            user_name: "Teammate",
            user_avatar_url: null
          });
        }
      ]
    })
  );

  const joined = await service.joinMeeting(otherUserId, workspaceId, meetingId);

  assert.deepEqual(workspaceService.calls, [{ userId: otherUserId, workspaceId }]);
  assert.equal(joined.meeting.id, meetingId);
  assert.equal(joined.meeting.createdById, currentUserId);
  assert.equal(joined.meeting.livekitRoomName, `meeting-${meetingId}`);
  assert.equal(joined.participant.id, otherParticipantId);
  assert.equal(joined.participant.user.id, otherUserId);
  assert.equal(joined.participant.isActive, true);
  assert.deepEqual(liveKitTokenService.calls, [
    {
      livekitRoomName: `meeting-${meetingId}`,
      livekitIdentity: `meeting-${meetingId}-user-${otherUserId}`,
      participantName: "Teammate"
    }
  ]);
  assert.deepEqual(joined.livekit, {
    livekitRoomName: `meeting-${meetingId}`,
    livekitIdentity: `meeting-${meetingId}-user-${otherUserId}`,
    livekitToken: `token-for-meeting-${meetingId}-user-${otherUserId}`,
    livekitUrl: "wss://livekit.example.test",
    expiresAt: "2026-07-05T01:00:00.000Z"
  });
  assert.notEqual(joined.livekit.livekitIdentity, `meeting-${meetingId}-user-${currentUserId}`);
  assert.equal(joined.currentRecording, null);
}

{
  const { service, liveKitTokenService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow({
          ended_at: endedAt
        })
      ]
    })
  );

  await assertBadRequest(
    () => service.joinMeeting(currentUserId, workspaceId, meetingId),
    /already ended/
  );
  assert.deepEqual(liveKitTokenService.calls, []);
}

{
  const database = new FakeDatabase();
  const liveKitTokenService = new FakeLiveKitTokenService();
  const service = new MeetingService(
    database,
    {
      async assertWorkspaceAccess() {
        throw new Error("workspace denied");
      }
    },
    liveKitTokenService,
    new FakeLiveKitEgressService(),
    new FakeMeetingReportJobService()
  );

  await assertError(
    () => service.startMeeting(currentUserId, workspaceId, {}),
    /workspace denied/
  );
  assert.deepEqual(liveKitTokenService.calls, []);
  assert.equal(database.queries.length, 0);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [null]
    })
  );

  await assertNotFound(
    () => service.joinMeeting(currentUserId, workspaceId, meetingId),
    /Meeting not found/
  );
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow(),
        participantRow(),
        activeParticipantCountRow(2),
        participantRow({
          left_at: leftAt
        })
      ]
    })
  );

  const left = await service.leaveMeeting(currentUserId, workspaceId, meetingId);

  assert.equal(left.participant.id, participantId);
  assert.equal(left.participant.isActive, false);
  assert.equal(left.participant.leftAt, "2026-07-05T00:10:00.000Z");
  assert.equal(left.meetingEnded, false);
  assert.equal(left.meeting.endedAt, null);
}

{
  const { database, service, liveKitEgressService, meetingReportJobService } =
    createSubject(
      new FakeDatabase({
        queryOneRows: [
          currentMeetingRow(),
          participantRow(),
          activeParticipantCountRow(1),
          (text, values) => {
            assert.match(text, /FROM meeting_recordings/);
            assert.match(text, /status = 'RUNNING'/);
            assert.match(text, /FOR UPDATE/);
            assert.deepEqual(values, [meetingId]);
            return recordingRow();
          },
          (text, values) => {
            assert.match(text, /UPDATE meeting_recordings/);
            assert.match(text, /status = 'COMPLETED'/);
            assert.deepEqual(values, [
              recordingId,
              `recordings/meetings/workspaces/${workspaceId}/meetings/${meetingId}/recordings/${recordingId}.mp3`,
              180,
              8192
            ]);
            return recordingRow({
              status: "COMPLETED",
              audio_file_key: values[1],
              duration_sec: values[2],
              file_size_bytes: values[3],
              ended_at: endedAt
            });
          },
          (text, values) => {
            assert.match(text, /FROM meeting_reports/);
            assert.match(text, /recording_id = \$2/);
            assert.deepEqual(values, [meetingId, recordingId]);
            return null;
          },
          (text, values) => {
            assert.match(text, /INSERT INTO meeting_reports/);
            assert.match(text, /'PROCESSING'/);
            assert.deepEqual(values, [meetingId, recordingId]);
            return meetingReportRow({
              status: "PROCESSING",
              summary: null,
              discussion_points: null,
              decisions: null,
              action_item_candidates: [],
              retry_count: 0
            });
          },
          participantRow({
            left_at: leftAt
          }),
          currentMeetingRow({
            ended_at: endedAt
          })
        ]
      })
    );

  const left = await service.leaveMeeting(currentUserId, workspaceId, meetingId);

  assert.equal(left.meetingEnded, true);
  assert.equal(left.meeting.endedAt, "2026-07-05T00:10:01.000Z");
  assert.equal(left.currentRecording, null);
  assert.deepEqual(liveKitEgressService.stopCalls, [
    {
      livekitEgressId: "egress-1"
    }
  ]);
  assert.equal(
    database.queries.some(({ text }) => text.includes("meeting_reports")),
    true
  );
  assert.deepEqual(meetingReportJobService.calls, [
    {
      jobType: "meeting_report",
      reportId,
      meetingId,
      recordingId,
      audioFileKey: `recordings/meetings/workspaces/${workspaceId}/meetings/${meetingId}/recordings/${recordingId}.mp3`,
      retryCount: 0
    }
  ]);
  assert.match(database.queries.at(-1).text, /UPDATE meetings/);
  assert.match(database.queries.at(-1).text, /AND ended_at IS NULL/);
}

{
  const { database, service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow(),
        participantRow({
          left_at: leftAt
        }),
        activeParticipantCountRow(0),
        participantRow({
          left_at: leftAt
        })
      ]
    })
  );

  const left = await service.leaveMeeting(currentUserId, workspaceId, meetingId);

  assert.equal(left.meetingEnded, false);
  assert.equal(left.participant.leftAt, "2026-07-05T00:10:00.000Z");
  assert.equal(database.queries.length, 4);
}

{
  const { database, service, liveKitEgressService, meetingReportJobService } =
    createSubject(
      new FakeDatabase({
        queryOneRows: [
          currentMeetingRow(),
          participantRow(),
          activeParticipantCountRow(1),
          recordingRow(),
          (text, values) => {
            assert.match(text, /UPDATE meeting_recordings/);
            assert.match(text, /status = 'FAILED'/);
            assert.deepEqual(values, [recordingId, "LiveKit Egress stop failed"]);
            return recordingRow({
              status: "FAILED",
              ended_at: endedAt,
              error_message: "LiveKit Egress stop failed"
            });
          }
        ]
      }),
      new FakeLiveKitTokenService(),
      new FakeLiveKitEgressService({ stopShouldFail: true }),
      new FakeMeetingReportJobService()
    );

  await assertBadRequest(
    () => service.leaveMeeting(currentUserId, workspaceId, meetingId),
    /Running recording could not be completed before leaving/
  );

  assert.equal(database.transactionRolledBack, true);
  assert.equal(
    database.queries.some(({ text }) => text.includes("UPDATE meeting_participants")),
    false
  );
  assert.deepEqual(liveKitEgressService.stopCalls, [
    {
      livekitEgressId: "egress-1"
    }
  ]);
  assert.deepEqual(meetingReportJobService.calls, []);
}

{
  const { database, service, meetingReportJobService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow(),
        participantRow(),
        activeParticipantCountRow(1),
        recordingRow(),
        (text, values) => {
          assert.match(text, /UPDATE meeting_recordings/);
          assert.match(text, /status = 'COMPLETED'/);
          assert.deepEqual(values, [
            recordingId,
            `recordings/meetings/workspaces/${workspaceId}/meetings/${meetingId}/recordings/${recordingId}.mp3`,
            180,
            8192
          ]);
          return recordingRow({
            status: "COMPLETED",
            audio_file_key: values[1],
            duration_sec: values[2],
            file_size_bytes: values[3],
            ended_at: endedAt
          });
        },
        null,
        meetingReportRow({
          status: "PROCESSING",
          summary: null,
          discussion_points: null,
          decisions: null,
          action_item_candidates: [],
          retry_count: 0
        }),
        participantRow({
          left_at: leftAt
        }),
        currentMeetingRow({
          ended_at: endedAt
        }),
        (text, values) => {
          assert.match(text, /UPDATE meeting_reports/);
          assert.match(text, /status = 'FAILED'/);
          assert.match(text, /failed_step = 'STT'/);
          assert.match(text, /Meeting report job could not be enqueued/);
          assert.deepEqual(values, [reportId]);
          return { id: reportId };
        },
        (text, values) => {
          assert.match(text, /UPDATE meeting_participants/);
          assert.match(text, /left_at = NULL/);
          assert.deepEqual(values, [meetingId, currentUserId]);
          return { id: participantId };
        },
        (text, values) => {
          assert.match(text, /UPDATE meetings/);
          assert.match(text, /ended_at = NULL/);
          assert.deepEqual(values, [workspaceId, meetingId]);
          return { id: meetingId };
        }
      ]
    }),
    new FakeLiveKitTokenService(),
    new FakeLiveKitEgressService(),
    new FakeMeetingReportJobService({ shouldFail: true })
  );

  await assertBadRequest(
    () => service.leaveMeeting(currentUserId, workspaceId, meetingId),
    /Meeting report job could not be enqueued/
  );

  assert.deepEqual(meetingReportJobService.calls, [
    {
      jobType: "meeting_report",
      reportId,
      meetingId,
      recordingId,
      audioFileKey: `recordings/meetings/workspaces/${workspaceId}/meetings/${meetingId}/recordings/${recordingId}.mp3`,
      retryCount: 0
    }
  ]);
  assert.equal(
    database.queries.some(
      ({ text }) => text.includes("status = 'FAILED'") && text.includes("failed_step")
    ),
    true
  );
  assert.equal(
    database.queries.some(
      ({ text }) => text.includes("UPDATE meeting_participants") && text.includes("left_at = NULL")
    ),
    true
  );
  assert.equal(
    database.queries.some(
      ({ text }) => text.includes("UPDATE meetings") && text.includes("ended_at = NULL")
    ),
    true
  );
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [currentMeetingRow(), null]
    })
  );

  await assertNotFound(
    () => service.leaveMeeting(currentUserId, workspaceId, meetingId),
    /Participant not found/
  );
}

{
  const expectedAudioFileKey = `recordings/meetings/workspaces/${workspaceId}/meetings/${meetingId}/recordings/${recordingId}.mp3`;
  const database = new FakeDatabase({
    queryOneRows: [
      currentMeetingRow({
        recording_id: null,
        recording_meeting_id: null,
        recording_livekit_egress_id: null,
        recording_status: null,
        recording_started_at: null
      }),
      participantRow(),
      null,
      { id: recordingId },
      (text, values) => {
        assert.match(text, /INSERT INTO meeting_recordings/);
        assert.match(text, /status,\s*audio_file_url,\s*audio_file_key/s);
        assert.deepEqual(values, [
          recordingId,
          meetingId,
          null,
          expectedAudioFileKey
        ]);
        return recordingRow({
          livekit_egress_id: null,
          audio_file_key: expectedAudioFileKey
        });
      },
      (text, values) => {
        assert.match(text, /UPDATE meeting_recordings/);
        assert.match(text, /livekit_egress_id = \$2/);
        assert.deepEqual(values, [recordingId, "egress-1"]);
        return recordingRow({
          audio_file_key: expectedAudioFileKey
        });
      }
    ]
  });
  const { service, liveKitEgressService } = createSubject(database);

  const result = await service.startRecording(
    currentUserId,
    workspaceId,
    meetingId
  );

  assert.equal(result.meeting.id, meetingId);
  assert.equal(result.recording.id, recordingId);
  assert.equal(result.recording.status, "RUNNING");
  assert.equal(result.recording.audioFileKey, expectedAudioFileKey);
  assert.equal(result.recording.audioFileUrl, null);
  assert.deepEqual(liveKitEgressService.startCalls, [
    {
      livekitRoomName: `meeting-${meetingId}`,
      audioFileKey: expectedAudioFileKey
    }
  ]);
}

{
  const expectedAudioFileKey = `recordings/meetings/workspaces/${workspaceId}/meetings/${meetingId}/recordings/${recordingId}.mp3`;
  const database = new FakeDatabase({
    queryOneRows: [
      currentMeetingRow({
        recording_id: null,
        recording_meeting_id: null,
        recording_livekit_egress_id: null,
        recording_status: null,
        recording_started_at: null
      }),
      participantRow(),
      null,
      { id: recordingId },
      recordingRow({
        livekit_egress_id: null,
        audio_file_key: expectedAudioFileKey
      }),
      () => {
        throw new Error("persist egress id failed");
      },
      (text, values) => {
        assert.match(text, /UPDATE meeting_recordings/);
        assert.match(text, /status = 'FAILED'/);
        assert.deepEqual(values, [recordingId, "LiveKit Egress start failed"]);
        return recordingRow({
          livekit_egress_id: null,
          status: "FAILED",
          audio_file_key: expectedAudioFileKey,
          ended_at: endedAt,
          error_message: "LiveKit Egress start failed"
        });
      }
    ]
  });
  const { service, liveKitEgressService } = createSubject(database);

  await assert.rejects(
    () => service.startRecording(currentUserId, workspaceId, meetingId),
    /persist egress id failed/
  );
  assert.equal(liveKitEgressService.startCalls.length, 1);
  assert.deepEqual(liveKitEgressService.stopCalls, [
    {
      livekitEgressId: "egress-1"
    }
  ]);
}

{
  const { service, liveKitEgressService } = createSubject(
    new FakeDatabase({
      queryOneRows: [currentMeetingRow(), participantRow(), recordingRow()]
    })
  );

  const result = await service.startRecording(
    currentUserId,
    workspaceId,
    meetingId
  );

  assert.equal(result.recording.id, recordingId);
  assert.equal(result.recording.status, "RUNNING");
  assert.deepEqual(liveKitEgressService.startCalls, []);
}

{
  const expectedAudioFileKey = `recordings/meetings/workspaces/${workspaceId}/meetings/${meetingId}/recordings/${recordingId}.mp3`;
  const { database, service, liveKitEgressService, meetingReportJobService } =
    createSubject(
      new FakeDatabase({
        queryOneRows: [
          currentMeetingRow({
            recording_id: null,
            recording_meeting_id: null,
            recording_livekit_egress_id: null,
            recording_status: null,
            recording_started_at: null
          }),
          participantRow(),
          null,
          { id: recordingId },
          (text, values) => {
            assert.match(text, /INSERT INTO meeting_recordings/);
            assert.match(text, /'RUNNING'/);
            assert.deepEqual(values, [
              recordingId,
              meetingId,
              null,
              expectedAudioFileKey
            ]);
            return recordingRow({
              livekit_egress_id: null,
              audio_file_key: expectedAudioFileKey
            });
          },
          (text, values) => {
            assert.match(text, /UPDATE meeting_recordings/);
            assert.match(text, /status = 'FAILED'/);
            assert.deepEqual(values, [recordingId, "LiveKit Egress start failed"]);
            return recordingRow({
              livekit_egress_id: null,
              status: "FAILED",
              audio_file_key: expectedAudioFileKey,
              ended_at: endedAt,
              error_message: "LiveKit Egress start failed"
            });
          }
        ]
      }),
      new FakeLiveKitTokenService(),
      new FakeLiveKitEgressService({ startShouldFail: true })
    );

  const result = await service.startRecording(
    currentUserId,
    workspaceId,
    meetingId
  );

  assert.equal(result.recording.status, "FAILED");
  assert.equal(result.recording.errorMessage, "LiveKit Egress start failed");
  assert.equal(liveKitEgressService.startCalls.length, 1);
  assert.equal(
    database.queries.some(({ text }) => text.includes("meeting_reports")),
    false
  );
  assert.deepEqual(meetingReportJobService.calls, []);
}

{
  const { service, liveKitEgressService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow({
          recording_id: null,
          recording_meeting_id: null,
          recording_livekit_egress_id: null,
          recording_status: null,
          recording_started_at: null
        }),
        participantRow({
          left_at: leftAt
        })
      ]
    })
  );

  await assert.rejects(
    () => service.startRecording(currentUserId, workspaceId, meetingId),
    (error) => {
      assert.equal(error.getStatus(), 403);
      assert.equal(error.getResponse().error.code, "FORBIDDEN");
      return true;
    }
  );
  assert.deepEqual(liveKitEgressService.startCalls, []);
}

{
  const expectedAudioFileKey = `recordings/meetings/workspaces/${workspaceId}/meetings/${meetingId}/recordings/${recordingId}.mp3`;
  const { service, liveKitEgressService, meetingReportJobService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow(),
        participantRow(),
        recordingRow(),
        (text, values) => {
          assert.match(text, /UPDATE meeting_recordings/);
          assert.match(text, /status = 'COMPLETED'/);
          assert.match(text, /audio_file_url = NULL/);
          assert.deepEqual(values, [
            recordingId,
            expectedAudioFileKey,
            180,
            8192
          ]);
          return recordingRow({
            status: "COMPLETED",
            audio_file_key: expectedAudioFileKey,
            duration_sec: 180,
            file_size_bytes: "8192",
            ended_at: endedAt
          });
        },
        (text, values) => {
          assert.match(text, /FROM meeting_reports/);
          assert.match(text, /recording_id = \$2/);
          assert.deepEqual(values, [meetingId, recordingId]);
          return null;
        },
        (text, values) => {
          assert.match(text, /INSERT INTO meeting_reports/);
          assert.match(text, /'PROCESSING'/);
          assert.deepEqual(values, [meetingId, recordingId]);
          return meetingReportRow({
            status: "PROCESSING"
          });
        }
      ]
    })
  );

  const result = await service.endRecordingAndCreateReport(
    currentUserId,
    workspaceId,
    meetingId,
    recordingId
  );

  assert.equal(result.recording.status, "COMPLETED");
  assert.equal(result.recording.audioFileKey, expectedAudioFileKey);
  assert.equal(result.recording.audioFileUrl, null);
  assert.equal(result.recording.durationSec, 180);
  assert.equal(result.recording.fileSizeBytes, 8192);
  assert.equal(result.report.id, reportId);
  assert.equal(result.report.status, "PROCESSING");
  assert.deepEqual(liveKitEgressService.stopCalls, [
    {
      livekitEgressId: "egress-1"
    }
  ]);
  assert.deepEqual(meetingReportJobService.calls, [
    {
      jobType: "meeting_report",
      reportId,
      meetingId,
      recordingId,
      audioFileKey: expectedAudioFileKey,
      retryCount: 0
    }
  ]);
}

{
  const expectedAudioFileKey = `recordings/meetings/workspaces/${workspaceId}/meetings/${meetingId}/recordings/${recordingId}.mp3`;
  const { database, service, liveKitEgressService, meetingReportJobService } =
    createSubject(
      new FakeDatabase({
        queryOneRows: [
          currentMeetingRow(),
          participantRow(),
          recordingRow(),
          (text, values) => {
            assert.match(text, /UPDATE meeting_recordings/);
            assert.match(text, /status = 'COMPLETED'/);
            assert.deepEqual(values, [
              recordingId,
              expectedAudioFileKey,
              60,
              8192
            ]);
            return recordingRow({
              status: "COMPLETED",
              audio_file_key: expectedAudioFileKey,
              duration_sec: 60,
              file_size_bytes: "8192",
              ended_at: endedAt
            });
          }
        ]
      }),
      new FakeLiveKitTokenService(),
      (() => {
        const egress = new FakeLiveKitEgressService();
        egress.stopResult = {
          status: "COMPLETED",
          audioFileKey: expectedAudioFileKey,
          durationSec: 60,
          fileSizeBytes: 8192,
          errorMessage: null
        };
        return egress;
      })()
    );

  const result = await service.endRecordingAndCreateReport(
    currentUserId,
    workspaceId,
    meetingId,
    recordingId
  );

  assert.equal(result.recording.status, "COMPLETED");
  assert.equal(result.recording.durationSec, 60);
  assert.equal(result.report, null);
  assert.deepEqual(liveKitEgressService.stopCalls, [
    {
      livekitEgressId: "egress-1"
    }
  ]);
  assert.equal(
    database.queries.some(({ text }) => text.includes("meeting_reports")),
    false
  );
  assert.deepEqual(meetingReportJobService.calls, []);
}

{
  const { database, service, liveKitEgressService, meetingReportJobService } =
    createSubject(
      new FakeDatabase({
        queryOneRows: [
          currentMeetingRow(),
          participantRow(),
          recordingRow({
            status: "FAILED",
            ended_at: endedAt,
            error_message: "LiveKit Egress stop failed"
          })
        ]
      })
    );

  const result = await service.endRecordingAndCreateReport(
    currentUserId,
    workspaceId,
    meetingId,
    recordingId
  );

  assert.equal(result.recording.status, "FAILED");
  assert.equal(result.report, null);
  assert.deepEqual(liveKitEgressService.stopCalls, []);
  assert.equal(
    database.queries.some(({ text }) => text.includes("meeting_reports")),
    false
  );
  assert.deepEqual(meetingReportJobService.calls, []);
}

{
  const { service, liveKitEgressService, meetingReportJobService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow(),
        participantRow(),
        recordingRow({
          status: "COMPLETED",
          duration_sec: 120,
          ended_at: endedAt
        }),
        meetingReportRow({
          status: "PROCESSING"
        })
      ]
    })
  );

  const result = await service.endRecordingAndCreateReport(
    currentUserId,
    workspaceId,
    meetingId,
    recordingId
  );

  assert.equal(result.recording.status, "COMPLETED");
  assert.equal(result.report.id, reportId);
  assert.deepEqual(liveKitEgressService.stopCalls, []);
  assert.deepEqual(meetingReportJobService.calls, []);
}

{
  const { service, liveKitEgressService, meetingReportJobService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow(),
        participantRow(),
        recordingRow(),
        (text, values) => {
          assert.match(text, /UPDATE meeting_recordings/);
          assert.match(text, /status = 'FAILED'/);
          assert.deepEqual(values, [recordingId, "LiveKit Egress stop failed"]);
          return recordingRow({
            status: "FAILED",
            ended_at: endedAt,
            error_message: "LiveKit Egress stop failed"
          });
        }
      ]
    }),
    new FakeLiveKitTokenService(),
    new FakeLiveKitEgressService({ stopShouldFail: true })
  );

  const result = await service.endRecordingAndCreateReport(
    currentUserId,
    workspaceId,
    meetingId,
    recordingId
  );

  assert.equal(result.recording.status, "FAILED");
  assert.equal(result.recording.errorMessage, "LiveKit Egress stop failed");
  assert.equal(liveKitEgressService.stopCalls.length, 1);
  assert.deepEqual(meetingReportJobService.calls, []);
}

{
  const { service, workspaceService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        (text, values) => {
          assert.match(text, /WHERE meetings\.workspace_id = \$1/);
          assert.match(text, /AND meetings\.id = \$2/);
          assert.deepEqual(values, [workspaceId, meetingId]);
          return currentMeetingRow({
            recording_id: null,
            recording_meeting_id: null,
            recording_status: null,
            recording_started_at: null,
            active_participant_count: 0
          });
        },
        (text, values) => {
          assert.match(text, /COUNT\(\*\)::int AS participant_count/);
          assert.match(text, /left_at IS NULL/);
          assert.deepEqual(values, [meetingId]);
          return participantCountRow("0", "0");
        },
        (text, values) => {
          assert.match(text, /meeting_participants\.user_id = \$2/);
          assert.deepEqual(values, [meetingId, currentUserId]);
          return null;
        }
      ],
      queryRows: [
        (text, values) => {
          assert.match(text, /FROM meeting_recordings/);
          assert.match(text, /ORDER BY started_at DESC, id ASC/);
          assert.deepEqual(values, [meetingId]);
          return [];
        },
        (text, values) => {
          assert.match(text, /FROM meeting_reports/);
          assert.doesNotMatch(text, /transcript_text/);
          assert.deepEqual(values, [meetingId]);
          return [];
        }
      ]
    })
  );

  const detail = await service.getMeeting(currentUserId, workspaceId, meetingId);

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.equal(detail.meeting.id, meetingId);
  assert.equal(detail.currentRecording, null);
  assert.deepEqual(detail.recordings, []);
  assert.deepEqual(detail.reports, []);
  assert.equal(detail.participantCount, 0);
  assert.equal(detail.activeParticipantCount, 0);
  assert.equal(detail.currentUserParticipant, null);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow(),
        participantCountRow(2, 1),
        participantRow()
      ],
      queryRows: [
        [
          recordingRow({
            id: secondRecordingId,
            status: "COMPLETED",
            audio_file_key: "recordings/meeting.wav",
            duration_sec: 120,
            file_size_bytes: "4096",
            ended_at: endedAt
          }),
          recordingRow()
        ],
        [
          meetingReportRow({
            action_item_candidates: JSON.stringify([{ title: "문서 정리" }]),
            retry_count: "1"
          })
        ]
      ]
    })
  );

  const detail = await service.getMeeting(currentUserId, workspaceId, meetingId);

  assert.equal(detail.currentRecording.id, recordingId);
  assert.equal(detail.recordings.length, 2);
  assert.equal(detail.recordings[0].id, secondRecordingId);
  assert.equal(detail.recordings[0].fileSizeBytes, 4096);
  assert.equal(detail.reports.length, 1);
  assert.equal(detail.reports[0].id, reportId);
  assert.equal(detail.reports[0].retryCount, 1);
  assert.deepEqual(detail.reports[0].actionItemCandidates, [
    { title: "문서 정리" }
  ]);
  assert.equal("transcriptText" in detail.reports[0], false);
  assert.equal(detail.participantCount, 2);
  assert.equal(detail.activeParticipantCount, 1);
  assert.equal(detail.currentUserParticipant.user.id, currentUserId);
}

{
  const { database, service, workspaceService } = createSubject(
    new FakeDatabase({
      queryRows: [
        (text, values) => {
          assert.match(text, /FROM meeting_reports/);
          assert.match(text, /JOIN meetings/);
          assert.match(text, /meetings\.workspace_id = \$1/);
          assert.match(text, /ORDER BY meeting_reports\.created_at DESC/);
          assert.match(text, /LIMIT \$2/);
          assert.doesNotMatch(text, /transcript_text/);
          assert.deepEqual(values, [workspaceId, 20]);
          return [
            meetingReportRow({
              status: "FAILED",
              failed_step: "STT",
              error_message: "STT failed safely",
              retry_count: "2"
            })
          ];
        }
      ]
    })
  );

  const result = await service.listReports(currentUserId, workspaceId, {});

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.equal(database.queries.length, 1);
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].status, "FAILED");
  assert.equal(result.reports[0].failedStep, "STT");
  assert.equal(result.reports[0].retryCount, 2);
  assert.equal("transcriptText" in result.reports[0], false);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryRows: [
        (text, values) => {
          assert.match(text, /meeting_reports\.status = \$2/);
          assert.match(text, /LIMIT \$3/);
          assert.deepEqual(values, [workspaceId, "FAILED", 100]);
          return [];
        }
      ]
    })
  );

  const result = await service.listReports(currentUserId, workspaceId, {
    status: "FAILED",
    limit: "101"
  });

  assert.deepEqual(result.reports, []);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryRows: [
        (text, values) => {
          assert.match(text, /LIMIT \$2/);
          assert.deepEqual(values, [workspaceId, 20]);
          return [];
        }
      ]
    })
  );

  const result = await service.listReports(currentUserId, workspaceId, {
    limit: ["20", "30"]
  });

  assert.deepEqual(result.reports, []);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryRows: [
        (text, values) => {
          assert.match(text, /LIMIT \$2/);
          assert.deepEqual(values, [workspaceId, 100]);
          return [];
        }
      ]
    })
  );

  const result = await service.listReports(currentUserId, workspaceId, {
    limit: "100"
  });

  assert.deepEqual(result.reports, []);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryRows: [
        (text, values) => {
          assert.match(text, /LIMIT \$2/);
          assert.deepEqual(values, [workspaceId, 20]);
          return [];
        }
      ]
    })
  );

  const result = await service.listReports(currentUserId, workspaceId, {
    limit: "not-a-number"
  });

  assert.deepEqual(result.reports, []);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryRows: [
        (text, values) => {
          assert.match(text, /LIMIT \$2/);
          assert.deepEqual(values, [workspaceId, 20]);
          return [];
        }
      ]
    })
  );

  const result = await service.listReports(currentUserId, workspaceId, {
    limit: "10"
  });

  assert.deepEqual(result.reports, []);
}

{
  const { service } = createSubject();

  await assertBadRequest(
    () =>
      service.listReports(currentUserId, workspaceId, {
        status: "DONE"
      }),
    /Invalid meeting report status/
  );
}

{
  const { service } = createSubject();

  await assertBadRequest(
    () =>
      service.listReports(currentUserId, workspaceId, {
        status: ["FAILED", "COMPLETED"]
      }),
    /Invalid meeting report status/
  );
}

{
  const { service, workspaceService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        (text, values) => {
          assert.match(text, /FROM meeting_reports/);
          assert.match(text, /JOIN meetings/);
          assert.match(text, /meeting_reports\.transcript_text/);
          assert.match(text, /meeting_reports\.id = \$2/);
          assert.deepEqual(values, [workspaceId, reportId]);
          return meetingReportRow({
            transcript_text: "회의 원문",
            action_item_candidates: JSON.stringify([{ title: "후속 작업" }])
          });
        }
      ]
    })
  );

  const result = await service.getReport(currentUserId, workspaceId, reportId);

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.equal(result.report.id, reportId);
  assert.equal(result.report.transcriptText, "회의 원문");
  assert.deepEqual(result.report.actionItemCandidates, [{ title: "후속 작업" }]);
}

{
  const { service } = createSubject();

  await assertNotFound(
    () => service.getReport(currentUserId, workspaceId, "not-a-uuid"),
    /Meeting report not found/
  );
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        () => {
          return null;
        }
      ]
    })
  );

  await assertNotFound(
    () => service.getReport(currentUserId, workspaceId, reportId),
    /Meeting report not found/
  );
}

{
  const { service, workspaceService } = createSubject(
    new FakeDatabase({
      queryOneRows: [currentMeetingRow()],
      queryRows: [
        (text, values) => {
          assert.match(text, /FROM meeting_reports/);
          assert.match(text, /WHERE meeting_id = \$1/);
          assert.match(text, /ORDER BY created_at DESC, id ASC/);
          assert.doesNotMatch(text, /transcript_text/);
          assert.deepEqual(values, [meetingId]);
          return [meetingReportRow()];
        }
      ]
    })
  );

  const result = await service.listMeetingReports(
    currentUserId,
    workspaceId,
    meetingId
  );

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].id, reportId);
  assert.equal("transcriptText" in result.reports[0], false);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [currentMeetingRow()],
      queryRows: [[]]
    })
  );

  const result = await service.listMeetingReports(
    currentUserId,
    workspaceId,
    meetingId
  );

  assert.deepEqual(result.reports, []);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [null]
    })
  );

  await assertNotFound(
    () => service.listMeetingReports(currentUserId, workspaceId, meetingId),
    /Meeting not found/
  );
}

{
  const meetingReportJobService = new FakeMeetingReportJobService();
  const { database, service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        (text, values) => {
          assert.match(text, /FROM meeting_reports/);
          assert.match(text, /JOIN meetings/);
          assert.match(text, /JOIN meeting_recordings/);
          assert.match(text, /meetings\.workspace_id = \$1/);
          assert.match(text, /meeting_reports\.id = \$2/);
          assert.match(text, /FOR UPDATE OF meeting_reports/);
          assert.deepEqual(values, [workspaceId, reportId]);
          return meetingReportRegenerationRow();
        },
        (text, values) => {
          assert.match(text, /UPDATE meeting_reports/);
          assert.match(text, /status = 'PROCESSING'/);
          assert.match(text, /failed_step = NULL/);
          assert.match(text, /error_message = NULL/);
          assert.match(text, /transcript_text = NULL/);
          assert.match(text, /action_item_candidates = '\[\]'::jsonb/);
          assert.match(text, /retry_count = retry_count \+ 1/);
          assert.deepEqual(values, [reportId]);
          return meetingReportRow({
            status: "PROCESSING",
            failed_step: null,
            error_message: null,
            summary: null,
            discussion_points: null,
            decisions: null,
            action_item_candidates: [],
            retry_count: "2"
          });
        }
      ]
    }),
    new FakeLiveKitTokenService(),
    new FakeLiveKitEgressService(),
    meetingReportJobService
  );

  const result = await service.requestReportRegeneration(
    currentUserId,
    workspaceId,
    reportId
  );

  assert.equal(database.transactionCommitted, true);
  assert.equal(result.report.status, "PROCESSING");
  assert.equal(result.report.retryCount, 2);
  assert.equal(result.report.failedStep, null);
  assert.equal(result.report.summary, null);
  assert.equal("transcriptText" in result.report, false);
  assert.deepEqual(meetingReportJobService.calls, [
    {
      jobType: "meeting_report",
      reportId,
      meetingId,
      recordingId,
      audioFileKey: `recordings/meetings/workspaces/${workspaceId}/meetings/${meetingId}/recordings/${recordingId}.mp3`,
      retryCount: 2
    }
  ]);
}

{
  const meetingReportJobService = new FakeMeetingReportJobService();
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        meetingReportRegenerationRow({
          status: "PROCESSING",
          failed_step: null,
          error_message: null
        })
      ]
    }),
    new FakeLiveKitTokenService(),
    new FakeLiveKitEgressService(),
    meetingReportJobService
  );

  await assertBadRequest(
    () => service.requestReportRegeneration(currentUserId, workspaceId, reportId),
    /already processing/
  );

  assert.deepEqual(meetingReportJobService.calls, []);
}

{
  const meetingReportJobService = new FakeMeetingReportJobService();
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        meetingReportRegenerationRow({
          status: "COMPLETED",
          failed_step: null,
          error_message: null
        })
      ]
    }),
    new FakeLiveKitTokenService(),
    new FakeLiveKitEgressService(),
    meetingReportJobService
  );

  await assertBadRequest(
    () => service.requestReportRegeneration(currentUserId, workspaceId, reportId),
    /Completed meeting report/
  );

  assert.deepEqual(meetingReportJobService.calls, []);
}

{
  const meetingReportJobService = new FakeMeetingReportJobService();
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        meetingReportRegenerationRow({
          recording_status: "FAILED",
          recording_audio_file_key: null,
          failed_step: "RECORDING"
        })
      ]
    }),
    new FakeLiveKitTokenService(),
    new FakeLiveKitEgressService(),
    meetingReportJobService
  );

  await assertBadRequest(
    () => service.requestReportRegeneration(currentUserId, workspaceId, reportId),
    /audio file is unavailable/
  );

  assert.deepEqual(meetingReportJobService.calls, []);
}

{
  const meetingReportJobService = new FakeMeetingReportJobService();
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [null]
    }),
    new FakeLiveKitTokenService(),
    new FakeLiveKitEgressService(),
    meetingReportJobService
  );

  await assertNotFound(
    () => service.requestReportRegeneration(currentUserId, workspaceId, reportId),
    /Meeting report not found/
  );

  assert.deepEqual(meetingReportJobService.calls, []);
}

{
  const previousReport = meetingReportRegenerationRow({
    retry_count: "3"
  });
  const meetingReportJobService = new FakeMeetingReportJobService({
    shouldFail: true
  });
  const { database, service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        previousReport,
        meetingReportRow({
          status: "PROCESSING",
          failed_step: null,
          error_message: null,
          summary: null,
          discussion_points: null,
          decisions: null,
          action_item_candidates: [],
          retry_count: "4"
        }),
        (text, values) => {
          assert.match(text, /UPDATE meeting_reports/);
          assert.match(text, /status = \$2::meeting_report_status/);
          assert.match(text, /failed_step = \$3::meeting_report_failed_step/);
          assert.match(text, /action_item_candidates = \$9::jsonb/);
          assert.match(text, /retry_count = \$10/);
          assert.match(text, /AND status = 'PROCESSING'/);
          assert.deepEqual(values, [
            reportId,
            "FAILED",
            "STT",
            "STT failed safely",
            "이전 전문",
            "이전 요약",
            "이전 논의사항",
            "이전 결정사항",
            JSON.stringify([{ title: "이전 후속 작업" }]),
            3
          ]);
          return meetingReportRow(previousReport);
        }
      ]
    }),
    new FakeLiveKitTokenService(),
    new FakeLiveKitEgressService(),
    meetingReportJobService
  );

  await assertBadRequest(
    () => service.requestReportRegeneration(currentUserId, workspaceId, reportId),
    /Meeting report job could not be enqueued/
  );

  assert.equal(database.queryOneRows.length, 0);
  assert.equal(meetingReportJobService.calls.length, 1);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [null]
    })
  );

  await assertNotFound(
    () => service.getMeeting(currentUserId, workspaceId, meetingId),
    /Meeting not found/
  );
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [currentMeetingRow()],
      queryRows: [
        (text, values) => {
          assert.match(text, /FROM meeting_recordings/);
          assert.match(text, /ORDER BY started_at DESC, id ASC/);
          assert.deepEqual(values, [meetingId]);
          return [
            recordingRow({
              status: "COMPLETED",
              audio_file_url: "https://example.com/recording.wav",
              audio_file_key: "recordings/meeting.wav",
              duration_sec: 180,
              file_size_bytes: "8192",
              ended_at: endedAt
            })
          ];
        }
      ]
    })
  );

  const result = await service.listRecordings(currentUserId, workspaceId, meetingId);

  assert.equal(result.recordings.length, 1);
  assert.equal(result.recordings[0].audioFileUrl, "https://example.com/recording.wav");
  assert.equal(result.recordings[0].fileSizeBytes, 8192);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [null]
    })
  );

  await assertNotFound(
    () => service.listRecordings(currentUserId, workspaceId, meetingId),
    /Meeting not found/
  );
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow({
          recording_id: null,
          recording_meeting_id: null,
          recording_status: null,
          recording_started_at: null
        })
      ]
    })
  );

  const result = await service.getCurrentRecording(
    currentUserId,
    workspaceId,
    meetingId
  );

  assert.equal(result.recording, null);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [currentMeetingRow()],
      queryRows: [
        (text, values) => {
          assert.match(text, /FROM meeting_participants/);
          assert.match(text, /JOIN users/);
          assert.match(text, /ORDER BY meeting_participants\.joined_at ASC/);
          assert.doesNotMatch(text, /email|token|secret/i);
          assert.deepEqual(values, [meetingId]);
          return [
            participantRow(),
            participantRow({
              id: otherParticipantId,
              user_id: otherUserId,
              left_at: leftAt,
              user_name: "Other",
              user_avatar_url: null
            })
          ];
        }
      ]
    })
  );

  const result = await service.listParticipants(
    currentUserId,
    workspaceId,
    meetingId
  );

  assert.equal(result.participants.length, 2);
  assert.equal(result.participants[0].isActive, true);
  assert.equal(result.participants[0].user.id, currentUserId);
  assert.equal("email" in result.participants[0].user, false);
  assert.equal(result.participants[1].isActive, false);
  assert.equal(result.participants[1].user.id, otherUserId);
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

  await assertMeetingAlreadyInProgress(() =>
    service.startMeeting(currentUserId, workspaceId, {})
  );
}
