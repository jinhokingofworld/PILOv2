import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MeetingService } = require("../../dist/modules/meeting/meeting.service.js");
const {
  MeetingReportEventGuard
} = require("../../dist/modules/meeting/meeting-report-event.guard.js");
const {
  MeetingReportInternalController
} = require("../../dist/modules/meeting/meeting-report-internal.controller.js");
const {
  MeetingRecordingRetentionService
} = require("../../dist/modules/meeting/meeting-recording-retention.service.js");
const { badRequest } = require("../../dist/common/api-error.js");
const meetingStateRealtimePublisher = await readFile(
  new URL(
    "../../src/modules/meeting/meeting-state-realtime-publisher.service.ts",
    import.meta.url
  ),
  "utf8"
);
const meetingServiceSource = await readFile(
  new URL("../../src/modules/meeting/meeting.service.ts", import.meta.url),
  "utf8"
);
const participantSessionMigration = await readFile(
  new URL(
    "../../../../db/migrations/072_convert_meeting_participants_to_session_history.sql",
    import.meta.url
  ),
  "utf8"
);

assert.match(meetingStateRealtimePublisher, /MEETING_STATE_REDIS_CHANNEL = "meeting:state-events"/);
assert.match(meetingStateRealtimePublisher, /event: "meeting:state:updated"/);
assert.match(meetingStateRealtimePublisher, /publishStateUpdatedSafely/);
assert.match(meetingStateRealtimePublisher, /recording_started/);
assert.match(meetingStateRealtimePublisher, /recording_failed/);
assert.match(meetingServiceSource, /WITH active_participant AS/);
assert.match(
  meetingServiceSource,
  /active_participant AS \(\s+SELECT meeting_participants\.\*/s
);
assert.match(meetingServiceSource, /ON CONFLICT DO NOTHING/);
assert.match(meetingServiceSource, /pg_advisory_xact_lock/);
assert.match(meetingServiceSource, /legacy_participant AS/);
assert.match(meetingServiceSource, /ORDER BY joined_at DESC, id DESC\s+LIMIT 1/s);
assert.match(meetingServiceSource, /WHERE id = \(SELECT id FROM legacy_participant\)/);
assert.match(meetingServiceSource, /AND meeting_participants\.left_at IS NULL/);
assert.match(
  meetingServiceSource,
  /WHERE id = \$1\s+AND left_at IS NULL/
);
assert.match(meetingServiceSource, /COUNT\(DISTINCT user_id\)::int/);
assert.match(meetingServiceSource, /SELECT DISTINCT ON \(meeting_participants\.user_id\)/);
assert.match(participantSessionMigration, /is_legacy_session boolean NOT NULL DEFAULT false/);
assert.match(participantSessionMigration, /UPDATE meeting_participants\s+SET is_legacy_session = true/s);
assert.match(participantSessionMigration, /DROP CONSTRAINT IF EXISTS unique_meeting_participant/);
assert.match(participantSessionMigration, /unique_active_meeting_participant/);
assert.match(participantSessionMigration, /unique_active_meeting_livekit_identity/);

const currentUserId = "11111111-1111-1111-1111-111111111111";
const workspaceId = "22222222-2222-2222-2222-222222222222";
const meetingId = "33333333-3333-3333-3333-333333333333";
const participantId = "44444444-4444-4444-4444-444444444444";
const recordingId = "55555555-5555-5555-5555-555555555555";
const secondRecordingId = "66666666-6666-6666-6666-666666666666";
const reportId = "77777777-7777-7777-7777-777777777777";
const actionItemId = "12121212-1212-1212-1212-121212121212";
const otherUserId = "88888888-8888-8888-8888-888888888888";
const otherParticipantId = "99999999-9999-9999-9999-999999999999";
const startedAt = new Date("2026-07-05T00:00:00.000Z");
const createdAt = new Date("2026-07-05T00:00:01.000Z");
const updatedAt = new Date("2026-07-05T00:00:02.000Z");
const leftAt = new Date("2026-07-05T00:10:00.000Z");
const endedAt = new Date("2026-07-05T00:10:01.000Z");

function meetingReportEventContext(token) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: token === undefined ? {} : { "x-meeting-report-event-token": token }
      })
    })
  };
}

{
  const originalToken = process.env.MEETING_REPORT_EVENT_TOKEN;
  const guard = new MeetingReportEventGuard();

  delete process.env.MEETING_REPORT_EVENT_TOKEN;
  assert.throws(
    () => guard.canActivate(meetingReportEventContext("configured")),
    error => error.getStatus() === 503
  );

  process.env.MEETING_REPORT_EVENT_TOKEN = "configured";
  assert.equal(guard.canActivate(meetingReportEventContext("configured")), true);
  assert.throws(
    () => guard.canActivate(meetingReportEventContext("wrong")),
    error => error.getStatus() === 401
  );
  assert.throws(
    () => guard.canActivate(meetingReportEventContext()),
    error => error.getStatus() === 401
  );

  if (originalToken === undefined) delete process.env.MEETING_REPORT_EVENT_TOKEN;
  else process.env.MEETING_REPORT_EVENT_TOKEN = originalToken;
}

{
  const publishedReportIds = [];
  const controller = new MeetingReportInternalController({
    publishReportUpdatedSafely: async reportId => publishedReportIds.push(reportId)
  });

  await controller.publish({ reportId: ` ${reportId} ` });
  assert.deepEqual(publishedReportIds, [reportId]);
  await assert.rejects(
    () => controller.publish({ reportId: "" }),
    error => error.getStatus() === 400
  );
  await assert.rejects(
    () => controller.publish({ reportId: "not-a-uuid" }),
    error => error.getStatus() === 400
  );
}

class FakeDatabase {
  constructor({
    queryOneRows = [],
    queryRows = [],
    hasWorkspaceRecordingConsent = true,
    activeMeetingParticipant = null
  } = {}) {
    this.queryOneRows = [...queryOneRows];
    this.queryRows = [...queryRows];
    this.queries = [];
    this.transactionCommitted = false;
    this.transactionRolledBack = false;
    this.hasWorkspaceRecordingConsent = hasWorkspaceRecordingConsent;
    this.activeMeetingParticipant = activeMeetingParticipant;
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

    if (/SELECT meeting_participants\.user_id/.test(text)) {
      return null;
    }

    if (/SELECT meeting_participants\.meeting_id[\s\S]*JOIN meetings/.test(text)) {
      return this.activeMeetingParticipant;
    }

    if (/SELECT id[\s\S]*FROM meeting_rooms[\s\S]*ORDER BY created_at ASC, id ASC/.test(text)) {
      const next = this.queryOneRows.shift();
      if (typeof next === "function") {
        return next(text, values);
      }

      return next ?? { id: "00000000-0000-0000-0000-000000000000" };
    }

    if (/FROM workspace_recording_consents/.test(text)) {
      return this.hasWorkspaceRecordingConsent
        ? {
            workspace_id: workspaceId,
            user_id: values[1],
            policy_version: "v1",
            accepted_at: createdAt
          }
        : null;
    }

    if (/INSERT INTO workspace_recording_consents/.test(text)) {
      this.hasWorkspaceRecordingConsent = true;
      return {
        workspace_id: workspaceId,
        user_id: values[1],
        policy_version: "v1",
        accepted_at: createdAt
      };
    }

    if (/INSERT INTO meeting_report_outbox/.test(text)) {
      return { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
    }

    if (/SELECT id\s+FROM meeting_report_outbox/.test(text)) {
      return { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
    }

    if (/UPDATE meeting_report_outbox/.test(text)) {
      return { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
    }

    const next = this.queryOneRows.shift();
    if (typeof next === "function") {
      return next(text, values);
    }

    return next ?? null;
  }

  async execute(text, values = []) {
    this.queries.push({ text, values });
    return { rows: [] };
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
    this.ownerCalls = [];
  }

  async assertWorkspaceAccess(userId, targetWorkspaceId) {
    this.calls.push({ userId, workspaceId: targetWorkspaceId });
    return { id: targetWorkspaceId };
  }

  async assertWorkspaceOwnerAccess(userId, targetWorkspaceId) {
    this.ownerCalls.push({ userId, workspaceId: targetWorkspaceId });
    return { id: targetWorkspaceId, role: "owner" };
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

function meetingRoomRow(overrides = {}) {
  return {
    id: "abababab-abab-abab-abab-abababababab",
    workspace_id: workspaceId,
    room_key: "ROOM_abababab-abab-abab-abab-abababababab",
    name: "디자인 회의",
    created_by_id: currentUserId,
    created_at: createdAt,
    updated_at: updatedAt,
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

function meetingReportActionItemRow(overrides = {}) {
  return {
    id: actionItemId,
    meeting_report_id: reportId,
    source_index: 0,
    title: "문서 정리",
    description: "회의 문서를 정리한다",
    priority: "MEDIUM",
    assignee_user_id: currentUserId,
    assignee_name: "Jinho",
    assignee_avatar_url: "https://example.com/avatar.png",
    status: "PENDING",
    updated_by_user_id: null,
    approved_by_user_id: null,
    approved_at: null,
    dismissed_by_user_id: null,
    dismissed_at: null,
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

async function assertConflict(action, messagePattern) {
  await assert.rejects(action, (error) => {
    assert.equal(error.getStatus(), 409);
    assert.equal(error.getResponse().error.code, "CONFLICT");
    assert.match(error.getResponse().error.message, messagePattern);
    return true;
  });
}

async function assertWorkspaceRecordingConsentRequired(action) {
  await assert.rejects(action, (error) => {
    assert.equal(error.getStatus(), 409);
    assert.equal(
      error.getResponse().error.code,
      "WORKSPACE_RECORDING_CONSENT_REQUIRED"
    );
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
  const { service } = createSubject(
    new FakeDatabase({
      hasWorkspaceRecordingConsent: false,
      queryOneRows: [null]
    })
  );

  await assertWorkspaceRecordingConsentRequired(() =>
    service.startMeeting(currentUserId, workspaceId, {})
  );
}

{
  const { service } = createSubject(
    new FakeDatabase({
      activeMeetingParticipant: { meeting_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }
    })
  );

  await assertConflict(
    () => service.startMeeting(currentUserId, workspaceId, {}),
    /already participating/
  );
}

{
  const activeRoomId = "abababab-abab-abab-abab-abababababab";
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow({
          meeting_room_id: activeRoomId,
          meeting_room_name: "기본 회의실",
          meeting_room_created_by_id: currentUserId,
          meeting_room_created_at: createdAt,
          meeting_room_updated_at: updatedAt
        }),
        { id: activeRoomId }
      ]
    })
  );

  const active = await service.getCurrentUserActiveMeeting(currentUserId);

  assert.equal(active.meeting.id, meetingId);
  assert.equal(active.meetingRoom.id, activeRoomId);
  assert.equal(active.meetingRoom.isDefault, true);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      hasWorkspaceRecordingConsent: false,
      queryOneRows: [null, startMeetingRow()]
    })
  );

  const started = await service.startMeeting(currentUserId, workspaceId, {
    recordingConsent: { accepted: true, policyVersion: "v1" }
  });

  assert.equal(started.meeting.id, meetingId);
}

{
  const { service } = createSubject();

  await assertBadRequest(
    () =>
      service.startMeeting(currentUserId, workspaceId, {
        recordingConsent: { accepted: true, policyVersion: "v0" }
      }),
    /recordingConsent\.policyVersion/
  );
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        (text, values) => {
          assert.doesNotMatch(text, /meeting_participants\.user_id = \$3/);
          assert.deepEqual(values, [workspaceId, otherUserId, reportId]);
          return meetingReportRow({ transcript_text: "다른 멤버도 조회 가능" });
        }
      ]
    })
  );

  const result = await service.getReport(otherUserId, workspaceId, reportId);

  assert.equal(result.report.id, reportId);
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
        assert.match(text, /\$1::uuid/);
        assert.match(text, /\$3::uuid/);
        assert.match(text, /\(\$3::uuid\)::text/);
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
  const { service, workspaceService } = createSubject(
    new FakeDatabase({
      queryRows: [
        [
          meetingRoomRow({
            room_key: "MAIN_MEETING_ROOM",
            name: "기본 회의실",
            created_by_id: null
          }),
          meetingRoomRow()
        ]
      ]
    })
  );

  const result = await service.listMeetingRooms(currentUserId, workspaceId);

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.equal(result.rooms.length, 2);
  assert.equal(result.rooms[0].isDefault, true);
  assert.equal(result.rooms[0].createdById, null);
  assert.equal(result.rooms[1].name, "디자인 회의");
}

{
  const { service, workspaceService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        (text, values) => {
          assert.match(text, /INSERT INTO meeting_rooms/);
          assert.match(text, /'ROOM_' \|\| generated\.id::text/);
          assert.deepEqual(values, [workspaceId, "디자인 회의", currentUserId]);
          return meetingRoomRow();
        }
      ]
    })
  );

  const result = await service.createMeetingRoom(currentUserId, workspaceId, {
    name: "  디자인   회의  "
  });

  assert.deepEqual(workspaceService.ownerCalls, [
    { userId: currentUserId, workspaceId }
  ]);
  assert.equal(result.room.name, "디자인 회의");
  assert.equal(result.room.isDefault, false);
}

{
  const uniqueViolation = new Error("duplicate active meeting room name");
  uniqueViolation.code = "23505";
  uniqueViolation.constraint = "unique_active_meeting_room_name";
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [() => { throw uniqueViolation; }]
    })
  );

  await assertConflict(
    () => service.createMeetingRoom(currentUserId, workspaceId, { name: "디자인 회의" }),
    /already exists/
  );
}

{
  const roomId = "abababab-abab-abab-abab-abababababab";
  const { service, liveKitTokenService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        meetingRoomRow({ id: roomId }),
        null,
        startMeetingRow({
          meeting_room_key: "ROOM_abababab-abab-abab-abab-abababababab"
        })
      ]
    })
  );

  const started = await service.startMeetingInRoom(
    currentUserId,
    workspaceId,
    roomId
  );

  assert.equal(started.meeting.roomKey, "ROOM_abababab-abab-abab-abab-abababababab");
  assert.equal(liveKitTokenService.calls.length, 1);
}

{
  const firstRoomId = "abababab-abab-abab-abab-abababababab";
  const secondRoomId = "cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd";
  const firstRoomKey = "ROOM_abababab-abab-abab-abab-abababababab";
  const secondRoomKey = "ROOM_cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd";
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        meetingRoomRow({ id: firstRoomId, room_key: firstRoomKey }),
        null,
        startMeetingRow({ meeting_room_key: firstRoomKey }),
        meetingRoomRow({ id: secondRoomId, room_key: secondRoomKey }),
        null,
        startMeetingRow({
          meeting_id: "dededede-dede-dede-dede-dededededede",
          meeting_room_key: secondRoomKey,
          meeting_livekit_room_name: "meeting-dededede-dede-dede-dede-dededededede",
          participant_meeting_id: "dededede-dede-dede-dede-dededededede",
          participant_livekit_identity: `meeting-dededede-dede-dede-dede-dededededede-user-${currentUserId}`
        })
      ]
    })
  );

  const first = await service.startMeetingInRoom(
    currentUserId,
    workspaceId,
    firstRoomId
  );
  const second = await service.startMeetingInRoom(
    currentUserId,
    workspaceId,
    secondRoomId
  );

  assert.equal(first.meeting.roomKey, firstRoomKey);
  assert.equal(second.meeting.roomKey, secondRoomKey);
  assert.notEqual(first.meeting.id, second.meeting.id);
}

{
  const roomId = "abababab-abab-abab-abab-abababababab";
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        meetingRoomRow({ id: roomId, room_key: "MAIN_MEETING_ROOM" }),
        { id: roomId }
      ]
    })
  );

  await assertBadRequest(
    () => service.deleteMeetingRoom(currentUserId, workspaceId, roomId),
    /cannot be deleted/
  );
}

{
  const roomId = "abababab-abab-abab-abab-abababababab";
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        meetingRoomRow({ id: roomId }),
        { id: "00000000-0000-0000-0000-000000000000" },
        currentMeetingRow({
          room_key: "ROOM_abababab-abab-abab-abab-abababababab"
        })
      ]
    })
  );

  await assertConflict(
    () => service.deleteMeetingRoom(currentUserId, workspaceId, roomId),
    /active meeting/
  );
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
          assert.match(text, /WITH[\s\S]*active_participant AS/);
          assert.match(text, /ON CONFLICT DO NOTHING/);
          assert.match(text, /\$1::uuid/);
          assert.match(text, /\$2::uuid/);
          assert.match(text, /\(\$1::uuid\)::text/);
          assert.match(text, /\(\$2::uuid\)::text/);
          assert.match(text, /AND left_at IS NULL/);
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
          recording_id: null,
          recording_meeting_id: null,
          recording_status: null,
          recording_started_at: null
        }),
        text => {
          assert.match(text, /CROSS JOIN participant_lock/);
          assert.match(text, /ON CONFLICT DO NOTHING/);
          return null;
        },
        text => {
          assert.match(text, /legacy_participant AS/);
          assert.match(text, /ORDER BY joined_at DESC, id DESC\s+LIMIT 1/s);
          assert.match(text, /WHERE id = \(SELECT id FROM legacy_participant\)/);
          assert.doesNotMatch(
            text,
            /reactivated_participant AS \([\s\S]*WHERE meeting_id = \$1::uuid/s
          );
          return participantRow();
        }
      ]
    })
  );

  const joined = await service.joinMeeting(currentUserId, workspaceId, meetingId);

  assert.equal(joined.participant.id, participantId);
  assert.equal(liveKitTokenService.calls.length, 1);
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
          assert.match(text, /WITH[\s\S]*active_participant AS/);
          assert.match(text, /ON CONFLICT DO NOTHING/);
          assert.match(text, /\$1::uuid/);
          assert.match(text, /\$2::uuid/);
          assert.match(text, /\(\$1::uuid\)::text/);
          assert.match(text, /\(\$2::uuid\)::text/);
          assert.match(text, /AND left_at IS NULL/);
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
  const { database, service, liveKitEgressService, meetingReportJobService } =
    createSubject(
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
  assert.deepEqual(liveKitEgressService.stopCalls, []);
  assert.deepEqual(meetingReportJobService.calls, []);
  assert.equal(
    database.queries.some(({ text }) => text.includes("UPDATE meeting_recordings")),
    false
  );
  assert.equal(
    database.queries.some(({ text }) => text.includes("INSERT INTO meeting_reports")),
    false
  );
  assert.equal(
    database.queries.some(({ text }) => text.includes("UPDATE meetings")),
    false
  );
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
            assert.match(text, /'QUEUED'/);
            assert.deepEqual(values, [meetingId, recordingId]);
            return meetingReportRow({
              status: "QUEUED",
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
  assert.equal(
    database.queries.some(({ text }) =>
      /UPDATE meetings/.test(text) && /AND ended_at IS NULL/.test(text)
    ),
    true
  );
  assert.equal(
    database.queries.some(({ text }) => /UPDATE meeting_report_outbox/.test(text)),
    true
  );
}

{
  const liveKitEgressService = new FakeLiveKitEgressService();
  liveKitEgressService.stopResult = {
    ...liveKitEgressService.stopResult,
    durationSec: 60
  };
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
            60,
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
        participantRow({
          left_at: leftAt
        }),
        currentMeetingRow({
          ended_at: endedAt
        })
      ]
    }),
    new FakeLiveKitTokenService(),
    liveKitEgressService
  );

  const left = await service.leaveMeeting(currentUserId, workspaceId, meetingId);

  assert.equal(left.meetingEnded, true);
  assert.equal(left.currentRecording, null);
  assert.deepEqual(liveKitEgressService.stopCalls, [
    {
      livekitEgressId: "egress-1"
    }
  ]);
  assert.deepEqual(meetingReportJobService.calls, []);
  assert.equal(
    database.queries.some(({ text }) => text.includes("meeting_reports")),
    false
  );
}

{
  const { database, service, liveKitEgressService, meetingReportJobService } =
    createSubject(
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
  assert.deepEqual(liveKitEgressService.stopCalls, []);
  assert.deepEqual(meetingReportJobService.calls, []);
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
          status: "QUEUED",
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

  const left = await service.leaveMeeting(currentUserId, workspaceId, meetingId);
  assert.equal(left.meetingEnded, true);

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
    database.queries.some(({ text }) => text.includes("status = 'FAILED'")),
    false
  );
  assert.equal(
    database.queries.some(
      ({ text }) => text.includes("UPDATE meeting_participants") && text.includes("left_at = NULL")
    ),
    false
  );
  assert.equal(
    database.queries.some(
      ({ text }) => text.includes("UPDATE meetings") && text.includes("ended_at = NULL")
    ),
    false
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
          assert.match(text, /'QUEUED'/);
          assert.deepEqual(values, [meetingId, recordingId]);
          return meetingReportRow({
            status: "QUEUED"
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
  assert.equal(result.report.status, "QUEUED");
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
          status: "QUEUED"
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
          assert.match(text, /COUNT\(DISTINCT user_id\)::int AS participant_count/);
          assert.match(text, /left_at IS NULL/);
          assert.deepEqual(values, [meetingId]);
          return participantCountRow("0", "0");
        },
        (text, values) => {
          assert.match(text, /AND user_id = \$2/);
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
          assert.match(text, /LIMIT \$3/);
          assert.doesNotMatch(text, /transcript_text/);
          assert.deepEqual(values, [workspaceId, currentUserId, 21]);
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
          assert.match(text, /meeting_reports\.status = \$3/);
          assert.match(text, /LIMIT \$4/);
          assert.deepEqual(values, [workspaceId, currentUserId, "FAILED", 101]);
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
          assert.match(text, /LIMIT \$3/);
          assert.deepEqual(values, [workspaceId, currentUserId, 21]);
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
          assert.match(text, /LIMIT \$3/);
          assert.deepEqual(values, [workspaceId, currentUserId, 101]);
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
          assert.match(text, /LIMIT \$3/);
          assert.deepEqual(values, [workspaceId, currentUserId, 21]);
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
          assert.match(text, /LIMIT \$3/);
          assert.deepEqual(values, [workspaceId, currentUserId, 21]);
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
  const cursorCreatedAt = "2026-07-05T00:00:01.000Z";
  const cursorId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const cursor = Buffer.from(
    JSON.stringify({ createdAt: cursorCreatedAt, id: cursorId })
  ).toString("base64url");
  const { database, service } = createSubject(
    new FakeDatabase({
      queryRows: [
        (text, values) => {
          assert.match(text, /to_tsvector\('simple'/);
          assert.match(text, /websearch_to_tsquery\('simple', \$3\)/);
          assert.match(text, /meeting_reports\.created_at >= \$4::timestamptz/);
          assert.match(text, /meeting_reports\.created_at < \$5::timestamptz/);
          assert.match(text, /meeting_reports\.id > \$7::uuid/);
          assert.match(text, /LIMIT \$8/);
          assert.deepEqual(values, [
            workspaceId,
            currentUserId,
            "회의록 검색",
            "2026-07-01T00:00:00.000Z",
            "2026-08-01T00:00:00.000Z",
            cursorCreatedAt,
            cursorId,
            21
          ]);
          return [];
        }
      ]
    })
  );

  const result = await service.listReports(currentUserId, workspaceId, {
    cursor,
    from: "2026-07-01T00:00:00.000Z",
    q: " 회의록 검색 ",
    to: "2026-08-01T00:00:00.000Z"
  });

  assert.equal(database.queries.length, 1);
  assert.deepEqual(result, { nextCursor: null, reports: [] });
}

{
  const rows = Array.from({ length: 21 }, (_, index) =>
    meetingReportRow({
      id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`
    })
  );
  const { service } = createSubject(new FakeDatabase({ queryRows: [rows] }));

  const result = await service.listReports(currentUserId, workspaceId, {});

  assert.equal(result.reports.length, 20);
  assert.deepEqual(
    JSON.parse(Buffer.from(result.nextCursor, "base64url").toString("utf8")),
    {
      createdAt: "2026-07-05T00:00:01.000Z",
      id: "00000000-0000-0000-0000-000000000020"
    }
  );
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
    () => service.listReports(currentUserId, workspaceId, { cursor: "not-a-cursor" }),
    /Invalid meeting report cursor/
  );
  await assertBadRequest(
    () => service.listReports(currentUserId, workspaceId, { from: "not-a-date" }),
    /Invalid meeting report from/
  );
  await assertBadRequest(
    () =>
      service.listReports(currentUserId, workspaceId, {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-01T00:00:00.000Z"
      }),
    /from must be before to/
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
          assert.match(text, /meeting_reports\.id = \$3/);
          assert.deepEqual(values, [workspaceId, currentUserId, reportId]);
          return meetingReportRow({
            transcript_text: "회의 원문 전체",
            action_item_candidates: JSON.stringify([{ title: "후속 작업" }])
          });
        }
      ]
    })
  );

  const result = await service.getReport(currentUserId, workspaceId, reportId);

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.equal(result.report.id, reportId);
  assert.equal(result.report.transcriptText, "회의 원문 전체");
  assert.deepEqual(result.report.evidenceSegments, []);
  assert.deepEqual(result.report.evidence, []);
  assert.deepEqual(result.report.activityEvidence, []);
  assert.deepEqual(result.report.actionItems, []);
  assert.deepEqual(result.report.actionItemAssignees, []);
  assert.deepEqual(result.report.actionItemCandidates, [{ title: "후속 작업" }]);
}

assert.match(meetingServiceSource, /FROM meeting_report_activity_evidence/);
assert.match(meetingServiceSource, /activityEvidence/);
assert.match(meetingServiceSource, /AS activity_references/);
assert.doesNotMatch(meetingServiceSource, /AS references\b/);

{
  const { database, service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        (text, values) => {
          assert.match(text, /workspace_members\.role = 'owner'/);
          assert.match(text, /FROM meeting_participants/);
          assert.match(text, /FOR UPDATE OF meeting_reports/);
          assert.deepEqual(values, [workspaceId, currentUserId, reportId]);
          return { id: reportId, status: "COMPLETED", can_delete: true };
        },
        (text, values) => {
          assert.match(text, /DELETE FROM meeting_reports/);
          assert.deepEqual(values, [reportId]);
          return { id: reportId };
        }
      ]
    })
  );

  const result = await service.deleteReport(currentUserId, workspaceId, reportId);

  assert.deepEqual(result, { deletedReportId: reportId });
  assert.equal(database.transactionCommitted, true);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [{ id: reportId, status: "COMPLETED", can_delete: false }]
    })
  );

  await assert.rejects(
    () => service.deleteReport(currentUserId, workspaceId, reportId),
    error => error.getStatus() === 403
  );
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [{ id: reportId, status: "SUMMARIZING", can_delete: true }]
    })
  );

  await assertBadRequest(
    () => service.deleteReport(currentUserId, workspaceId, reportId),
    /still processing/
  );
}

{
  const { service, workspaceService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        (text, values) => {
          assert.match(text, /FROM meeting_report_action_items/);
          assert.match(text, /FOR UPDATE OF action_items/);
          assert.deepEqual(values, [workspaceId, reportId, actionItemId]);
          return meetingReportActionItemRow();
        },
        (text, values) => {
          assert.match(text, /SELECT user_id FROM workspace_members/);
          assert.deepEqual(values, [workspaceId, currentUserId]);
          return { user_id: currentUserId };
        },
        (text, values) => {
          assert.match(text, /UPDATE meeting_report_action_items/);
          assert.match(text, /status = 'PENDING'/);
          assert.deepEqual(values, [
            actionItemId,
            "수정된 문서 정리",
            "수정된 설명",
            "HIGH",
            currentUserId,
            currentUserId
          ]);
          return { id: actionItemId };
        }
      ]
    })
  );

  const result = await service.updateMeetingReportActionItem(
    currentUserId,
    workspaceId,
    reportId,
    actionItemId,
    {
      title: "수정된 문서 정리",
      description: "수정된 설명",
      priority: "HIGH",
      assigneeUserId: currentUserId
    }
  );

  assert.deepEqual(workspaceService.calls, [{ userId: currentUserId, workspaceId }]);
  assert.equal(result.actionItem.status, "PENDING");
  assert.equal(result.actionItem.title, "수정된 문서 정리");
  assert.equal(result.actionItem.assignee?.userId, currentUserId);
}

{
  const { service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        () => meetingReportActionItemRow(),
        (text, values) => {
          assert.match(text, /status = 'APPROVED'/);
          assert.deepEqual(values, [actionItemId, currentUserId]);
          return { id: actionItemId };
        },
        () => meetingReportActionItemRow({
          status: "APPROVED",
          approved_by_user_id: currentUserId,
          approved_at: updatedAt,
          updated_by_user_id: currentUserId
        })
      ]
    })
  );

  const result = await service.approveMeetingReportActionItem(
    currentUserId,
    workspaceId,
    reportId,
    actionItemId
  );

  assert.equal(result.actionItem.status, "APPROVED");
  assert.equal(result.actionItem.approvedByUserId, currentUserId);
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
          assert.match(text, /WHERE meeting_reports\.meeting_id = \$1/);
          assert.match(text, /ORDER BY meeting_reports\.created_at DESC, meeting_reports\.id ASC/);
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
          assert.match(text, /FOR UPDATE OF meeting_reports, meeting_recordings/);
          assert.deepEqual(values, [workspaceId, reportId]);
          return meetingReportRegenerationRow();
        },
        (text, values) => {
          assert.match(text, /UPDATE meeting_reports/);
          assert.match(text, /status = 'QUEUED'/);
          assert.match(text, /failed_step = NULL/);
          assert.match(text, /error_message = NULL/);
          assert.match(text, /transcript_text = NULL/);
          assert.match(text, /action_item_candidates = '\[\]'::jsonb/);
          assert.match(text, /retry_count = retry_count \+ 1/);
          assert.deepEqual(values, [reportId]);
          return meetingReportRow({
            status: "QUEUED",
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
  assert.equal(result.report.status, "QUEUED");
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
          status: "QUEUED",
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
          status: "QUEUED",
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
          assert.match(text, /AND status IN/);
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
          assert.match(text, /WITH participant_summaries AS/);
          assert.match(text, /MIN\(joined_at\) AS joined_at/);
          assert.match(text, /BOOL_OR\(left_at IS NULL\)/);
          assert.match(text, /ORDER BY participant_summaries\.joined_at ASC/);
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

{
  const { database, service, liveKitEgressService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow({ active_participant_count: 2 }),
        participantRow(),
        activeParticipantCountRow(2),
        participantRow({ left_at: leftAt })
      ]
    })
  );

  const result = await service.reconcileLiveKitParticipantDeparture(database, {
    roomName: `meeting-${meetingId}`,
    participantIdentity: `meeting-${meetingId}-user-${currentUserId}`,
    eventCreatedAt: new Date("2026-07-05T00:05:00.000Z")
  });

  assert.equal(result.job, null);
  assert.equal(liveKitEgressService.stopCalls.length, 0);
  assert.equal(
    database.queries.some(({ text }) => /UPDATE meetings/.test(text)),
    false
  );
}

{
  const liveKitEgressService = new FakeLiveKitEgressService({
    stopShouldFail: true
  });
  const { database, service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow(),
        participantRow(),
        activeParticipantCountRow(1),
        recordingRow(),
        recordingRow({
          status: "FAILED",
          ended_at: endedAt,
          error_message: "LiveKit recording could not be stopped safely"
        }),
        participantRow({ left_at: leftAt }),
        currentMeetingRow({ ended_at: endedAt })
      ]
    }),
    new FakeLiveKitTokenService(),
    liveKitEgressService
  );

  const result = await service.reconcileLiveKitParticipantDeparture(database, {
    roomName: `meeting-${meetingId}`,
    participantIdentity: `meeting-${meetingId}-user-${currentUserId}`,
    eventCreatedAt: new Date("2026-07-05T00:05:00.000Z")
  });

  assert.equal(result.job, null);
  assert.equal(liveKitEgressService.stopCalls.length, 1);
  assert.equal(
    database.queries.some(({ text }) => /UPDATE meeting_participants/.test(text)),
    true
  );
  assert.equal(
    database.queries.some(({ text }) => /UPDATE meetings/.test(text)),
    true
  );
}

{
  const { database, service, liveKitEgressService } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        currentMeetingRow(),
        participantRow()
      ]
    })
  );

  const result = await service.reconcileLiveKitParticipantDeparture(database, {
    roomName: `meeting-${meetingId}`,
    participantIdentity: `meeting-${meetingId}-user-${currentUserId}`,
    eventCreatedAt: new Date("2026-07-05T00:00:00.000Z")
  });

  assert.equal(result.job, null);
  assert.equal(liveKitEgressService.stopCalls.length, 0);
  assert.equal(database.queries.length, 2);
}

{
  const meetingReportJobService = new FakeMeetingReportJobService({
    shouldFail: true
  });
  const { database, service } = createSubject(
    new FakeDatabase({
      queryOneRows: [
        (text, values) => {
          assert.match(text, /UPDATE meeting_reports/);
          assert.match(text, /status = 'FAILED'/);
          assert.match(text, /AND status IN/);
          assert.deepEqual(values, [reportId]);
          return { id: reportId };
        }
      ]
    }),
    new FakeLiveKitTokenService(),
    new FakeLiveKitEgressService(),
    meetingReportJobService
  );

  await service.enqueueReconciledMeetingReportJob({
    jobType: "meeting_report",
    reportId,
    meetingId,
    recordingId,
    audioFileKey: "recordings/meeting.mp3",
    retryCount: 0
  });

  assert.equal(meetingReportJobService.calls.length, 1);
  assert.equal(database.queryOneRows.length, 1);
  assert.equal(
    database.queries.some(({ text }) => /UPDATE meeting_reports/.test(text)),
    false
  );
}

class RetentionDatabase {
  constructor({ dueJobs = [], claim = null, finalized = true, hasActiveReport = false } = {}) {
    this.dueJobs = dueJobs;
    this.claim = claim;
    this.finalized = finalized;
    this.hasActiveReport = hasActiveReport;
    this.calls = [];
  }

  async query(text, values = []) {
    this.calls.push({ method: "query", text, values });
    return this.dueJobs;
  }

  async execute(text, values = []) {
    this.calls.push({ method: "execute", text, values });
    return { rowCount: 1 };
  }

  async transaction(callback) {
    let finalizedRecording = false;
    return callback({
      queryOne: async (text, values = []) => {
        this.calls.push({ method: "transaction.queryOne", text, values });
        if (text.includes("WITH candidate")) return this.claim;
        if (text.includes("SELECT id, audio_file_key, audio_deleted_at")) {
          return this.finalized
            ? {
                id: recordingId,
                audio_file_key: this.claim?.audio_file_key ?? null,
                audio_deleted_at: null
              }
            : null;
        }
        if (text.includes("FROM meeting_reports")) {
          return this.hasActiveReport ? { id: reportId } : null;
        }
        if (text.includes("FROM meeting_report_outbox")) return null;
        if (text.includes("UPDATE meeting_recordings")) {
          finalizedRecording = true;
          return this.finalized ? { id: recordingId } : null;
        }
        if (text.includes("SET status = 'completed'")) {
          return finalizedRecording && this.finalized ? { id: this.claim?.id } : null;
        }
        return null;
      }
    });
  }
}

class FakeRetentionS3Client {
  constructor({ shouldFail = false } = {}) {
    this.shouldFail = shouldFail;
    this.commands = [];
    this.destroyCalls = 0;
  }

  async send(command) {
    this.commands.push(command);
    if (this.shouldFail) throw new Error("S3 unavailable");
  }

  destroy() {
    this.destroyCalls += 1;
  }
}

class TestMeetingRecordingRetentionService extends MeetingRecordingRetentionService {
  constructor(database, client) {
    super(database);
    this.client = client;
    this.configs = [];
  }

  createS3Client(config) {
    this.configs.push(config);
    return this.client;
  }
}

{
  const originalEnv = {
    AWS_REGION: process.env.AWS_REGION,
    S3_UPLOADS_BUCKET: process.env.S3_UPLOADS_BUCKET,
    S3_ENDPOINT: process.env.S3_ENDPOINT
  };
  process.env.AWS_REGION = "ap-northeast-2";
  process.env.S3_UPLOADS_BUCKET = "pilo-test-uploads";
  process.env.S3_ENDPOINT = "http://localhost:4566";

  const purgeClaim = {
    id: "13131313-1313-1313-1313-131313131313",
    workspace_id: workspaceId,
    meeting_id: meetingId,
    recording_id: recordingId,
    audio_file_key: "recordings/meetings/audio.mp3",
    attempt_count: 1,
    claim_token: "14141414-1414-1414-1414-141414141414"
  };
  const database = new RetentionDatabase({
    dueJobs: [{ id: purgeClaim.id }],
    claim: purgeClaim
  });
  const client = new FakeRetentionS3Client();
  const service = new TestMeetingRecordingRetentionService(database, client);

  await service.purgeDueRecordings();

  const seed = database.calls.find(
    ({ method, text }) => method === "execute" && text.includes("INSERT INTO meeting_recording_purge_jobs")
  );
  assert.match(seed.text, /meeting\.ended_at <= now\(\) - \(\$1 \* INTERVAL '1 day'\)/);
  assert.match(seed.text, /recording\.audio_deleted_at IS NULL/);
  assert.match(seed.text, /meeting_reports AS report/);
  assert.match(seed.text, /meeting_report_outbox AS outbox/);
  assert.deepEqual(seed.values, [30]);
  const claimQuery = database.calls.find(
    ({ text }) => text.includes("WITH candidate")
  );
  assert.match(claimQuery.text, /FOR UPDATE SKIP LOCKED/);
  const lockedRecording = database.calls.find(
    ({ text }) => text.includes("SELECT id, audio_file_key, audio_deleted_at")
  );
  assert.match(lockedRecording.text, /FOR UPDATE/);
  assert.equal(
    database.calls.some(({ text }) => text.includes("FROM meeting_reports") && text.includes("TRANSCRIBING")),
    true
  );
  assert.equal(
    database.calls.some(({ text }) => text.includes("FROM meeting_report_outbox") && text.includes("publishing")),
    true
  );
  assert.equal(client.commands.length, 1);
  assert.equal(client.commands[0].constructor.name, "DeleteObjectCommand");
  assert.deepEqual(client.commands[0].input, {
    Bucket: "pilo-test-uploads",
    Key: purgeClaim.audio_file_key
  });
  assert.deepEqual(service.configs, [{
    awsRegion: "ap-northeast-2",
    bucket: "pilo-test-uploads",
    endpoint: "http://localhost:4566"
  }]);
  const recordingUpdate = database.calls.find(
    ({ text }) => text.includes("audio_deleted_at = COALESCE(audio_deleted_at, now())")
  );
  assert.match(recordingUpdate.text, /audio_file_key = NULL/);
  assert.match(recordingUpdate.text, /audio_file_url = NULL/);
  assert.deepEqual(recordingUpdate.values, [recordingId, purgeClaim.audio_file_key]);
  assert.equal(
    database.calls.some(({ text }) => /DELETE FROM meeting_reports|DELETE FROM meeting_report/.test(text)),
    false
  );
  service.onModuleDestroy();
  assert.equal(client.destroyCalls, 1);

  const retryDatabase = new RetentionDatabase({
    dueJobs: [{ id: purgeClaim.id }],
    claim: purgeClaim
  });
  const failingService = new TestMeetingRecordingRetentionService(
    retryDatabase,
    new FakeRetentionS3Client({ shouldFail: true })
  );
  await failingService.purgeDueRecordings();
  const retry = retryDatabase.calls.find(
    ({ method, text }) => method === "execute" && text.includes("next_attempt_at = $3")
  );
  assert.match(retry.text, /error_code = \$4/);
  assert.deepEqual(retry.values.slice(0, 2), [purgeClaim.id, purgeClaim.claim_token]);
  assert.ok(retry.values[2] instanceof Date);
  assert.equal(retry.values[3], "S3_DELETE_FAILED");
  failingService.onModuleDestroy();

  const blockedDatabase = new RetentionDatabase({
    dueJobs: [{ id: purgeClaim.id }],
    claim: purgeClaim,
    hasActiveReport: true
  });
  const blockedClient = new FakeRetentionS3Client();
  const blockedService = new TestMeetingRecordingRetentionService(blockedDatabase, blockedClient);
  await blockedService.purgeDueRecordings();
  assert.equal(blockedClient.commands.length, 0);
  const deferred = blockedDatabase.calls.find(
    ({ method, text }) => method === "execute" && text.includes("RETENTION_BLOCKED_BY_ACTIVE_REPORT")
  );
  assert.match(deferred.text, /status = 'pending'/);
  assert.deepEqual(deferred.values, [purgeClaim.id, purgeClaim.claim_token]);
  blockedService.onModuleDestroy();

  if (originalEnv.AWS_REGION === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = originalEnv.AWS_REGION;
  if (originalEnv.S3_UPLOADS_BUCKET === undefined) delete process.env.S3_UPLOADS_BUCKET;
  else process.env.S3_UPLOADS_BUCKET = originalEnv.S3_UPLOADS_BUCKET;
  if (originalEnv.S3_ENDPOINT === undefined) delete process.env.S3_ENDPOINT;
  else process.env.S3_ENDPOINT = originalEnv.S3_ENDPOINT;
}
