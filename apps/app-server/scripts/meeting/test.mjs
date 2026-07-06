import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MeetingService } = require("../../dist/modules/meeting/meeting.service.js");

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

function createSubject(
  database = new FakeDatabase(),
  liveKitTokenService = new FakeLiveKitTokenService()
) {
  const workspaceService = new FakeWorkspaceService();
  const service = new MeetingService(
    database,
    workspaceService,
    liveKitTokenService
  );
  return {
    database,
    service,
    workspaceService,
    liveKitTokenService
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

  await assertBadRequest(
    () => service.startMeeting(currentUserId, workspaceId, {}),
    /already in progress/
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
    liveKitTokenService
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
        participantRow({
          left_at: leftAt
        }),
        activeParticipantCountRow(1)
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
  const { database, service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow(),
        participantRow(),
        participantRow({
          left_at: leftAt
        }),
        activeParticipantCountRow(0),
        currentMeetingRow({
          ended_at: endedAt
        })
      ]
    })
  );

  const left = await service.leaveMeeting(currentUserId, workspaceId, meetingId);

  assert.equal(left.meetingEnded, true);
  assert.equal(left.meeting.endedAt, "2026-07-05T00:10:01.000Z");
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
        participantRow({
          left_at: leftAt
        }),
        activeParticipantCountRow(0)
      ]
    })
  );

  const left = await service.leaveMeeting(currentUserId, workspaceId, meetingId);

  assert.equal(left.meetingEnded, false);
  assert.equal(left.participant.leftAt, "2026-07-05T00:10:00.000Z");
  assert.equal(database.queries.length, 4);
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

  await assertBadRequest(
    () => service.startMeeting(currentUserId, workspaceId, {}),
    /already in progress/
  );
}
