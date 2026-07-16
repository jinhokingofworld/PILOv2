import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { AgentToolRegistryService } = require(
  "../../dist/modules/agent/agent-tool-registry.service.js"
);
const { MeetingAgentToolsService } = require(
  "../../dist/modules/agent/tools/meeting-agent-tools.service.js"
);
const { MeetingActionItemDeliveryService } = require(
  "../../dist/modules/meeting/meeting-action-item-delivery.service.js"
);
const { HttpException, HttpStatus } = require("@nestjs/common");

const USER_ID = "11111111-1111-1111-1111-111111111111";
const WORKSPACE_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
const REPORT_ID = "44444444-4444-4444-8444-444444444444";
const SECOND_REPORT_ID = "77777777-7777-4777-8777-777777777777";
const THIRD_REPORT_ID = "88888888-8888-4888-8888-888888888888";
const MEETING_ID = "55555555-5555-5555-8555-555555555555";
const RECORDING_ID = "66666666-6666-6666-8666-666666666666";
const MEETING_ROOM_ID = "99999999-9999-4999-8999-999999999991";
const SECOND_MEETING_ROOM_ID = "99999999-9999-4999-8999-999999999992";

const meetingAgentWorkflowMigration = await readFile(
  new URL(
    "../../../../db/migrations/074_create_meeting_agent_workflow.sql",
    import.meta.url
  ),
  "utf8"
);
const deliveryTargetPreservationMigration = await readFile(
  new URL(
    "../../../../db/migrations/075_preserve_meeting_action_item_delivery_targets.sql",
    import.meta.url
  ),
  "utf8"
);
const deliveryAttemptAuditMigration = await readFile(
  new URL(
    "../../../../db/migrations/076_add_meeting_action_item_delivery_attempt_audit.sql",
    import.meta.url
  ),
  "utf8"
);
const deliveryAttemptActorIndexMigration = await readFile(
  new URL(
    "../../../../db/migrations/077_add_meeting_action_item_delivery_attempt_actor_index.sql",
    import.meta.url
  ),
  "utf8"
);
const meetingActionItemDeliverySource = await readFile(
  new URL(
    "../../src/modules/meeting/meeting-action-item-delivery.service.ts",
    import.meta.url
  ),
  "utf8"
);
const meetingServiceSource = await readFile(
  new URL("../../src/modules/meeting/meeting.service.ts", import.meta.url),
  "utf8"
);

assert.match(
  meetingAgentWorkflowMigration,
  /pilo_issue_id BIGINT[\s\S]*?REFERENCES public\.pilo_issues\(id\) ON DELETE RESTRICT/,
  "The applied 074 migration must keep the Board target FK type compatible"
);
assert.match(
  deliveryTargetPreservationMigration,
  /ADD COLUMN IF NOT EXISTS target_resource_id TEXT/,
  "The post-074 correction must apply safely to the shared dev schema"
);
assert.match(
  deliveryTargetPreservationMigration,
  /calendar_event_id_fkey[\s\S]*?ON DELETE SET NULL[\s\S]*?pilo_issue_id_fkey[\s\S]*?ON DELETE SET NULL/,
  "The post-074 correction must make both delivered targets deletable"
);
assert.match(
  deliveryTargetPreservationMigration,
  /status = 'COMPLETED'[\s\S]*?target_resource_id IS NOT NULL/,
  "The post-074 correction must reject completed deliveries without a target snapshot"
);
assert.match(
  deliveryTargetPreservationMigration,
  /target_resource_id ~ '[^']+'[\s\S]*?calendar_event_id IS NULL[\s\S]*?target_resource_id = calendar_event_id::text[\s\S]*?pilo_issue_id IS NULL[\s\S]*?target_resource_id = pilo_issue_id::text/,
  "Completed deliveries must match their snapshot to a live FK when present"
);
assert.match(
  deliveryAttemptAuditMigration,
  /last_attempted_by_user_id UUID[\s\S]*?REFERENCES public\.users\(id\) ON DELETE SET NULL/,
  "Delivery retries must retain a safe member audit reference"
);
assert.match(
  deliveryAttemptAuditMigration,
  /last_attempted_at TIMESTAMPTZ/,
  "Delivery retries must retain when the latest attempt was claimed"
);
assert.match(
  deliveryAttemptActorIndexMigration,
  /CREATE INDEX IF NOT EXISTS idx_meeting_report_action_item_deliveries_last_attempted_by_user[\s\S]*?\(last_attempted_by_user_id\)[\s\S]*?WHERE last_attempted_by_user_id IS NOT NULL/,
  "The delivery attempt actor foreign key needs a partial covering index"
);
assert.match(
  meetingActionItemDeliverySource,
  /await this\.normalizeDeliveryDraft\([\s\S]*?INSERT INTO meeting_report_action_item_deliveries/,
  "A user-invalid draft must be normalized and validated before a delivery row is created"
);
assert.match(
  meetingActionItemDeliverySource,
  /listBoardDeliveryOptions\([\s\S]*?workspaceId[\s\S]*?\)/,
  "Delivery options must use the joined Board and Column read path"
);
assert.doesNotMatch(
  meetingActionItemDeliverySource,
  /Promise\.all\([\s\S]*?listBoardColumns/,
  "Delivery options must not issue one Board-column query per Board"
);
assert.match(
  meetingActionItemDeliverySource,
  /GITHUB_PROJECT_OAUTH_RECONNECT_REQUIRED/,
  "Delivery failures must expose a safe reconnection action for ProjectV2 OAuth"
);
assert.match(
  meetingServiceSource,
  /approveMeetingReportActionItem[\s\S]*?transitionMeetingReportActionItem\([\s\S]*?"APPROVED"/,
  "The legacy approval endpoint must remain compatible during the delivery rollout"
);

function createMeeting(overrides = {}) {
  return {
    id: MEETING_ID,
    workspaceId: WORKSPACE_ID,
    roomKey: "MAIN_MEETING_ROOM",
    livekitRoomName: "meeting-room",
    createdById: USER_ID,
    endedById: null,
    startedAt: new Date(Date.now() - 90_000).toISOString(),
    endedAt: null,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides
  };
}

function createMeetingRoom(overrides = {}) {
  return {
    id: MEETING_ROOM_ID,
    workspaceId: WORKSPACE_ID,
    roomKey: "MAIN_MEETING_ROOM",
    name: "기본 회의실",
    isDefault: true,
    createdById: USER_ID,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides
  };
}

function createReport(overrides = {}) {
  return {
    id: REPORT_ID,
    meetingId: MEETING_ID,
    recordingId: RECORDING_ID,
    status: "COMPLETED",
    failedStep: null,
    errorMessage: null,
    transcriptText: "회의 원문은 Agent outputSummary에 저장하면 안 된다.",
    summary: "회의 요약",
    discussionPoints: "논의사항",
    decisions: "결정사항",
    actionItemCandidates: [
      {
        title: "문서 정리",
        description: "회의 보고서를 정리한다.",
        assigneeUserId: USER_ID,
        priority: "MEDIUM",
        rawIgnored: "저장하지 않는다."
      }
    ],
    retryCount: 0,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides
  };
}

function toSummaryReport(report) {
  const { transcriptText, ...summary } = report;
  return summary;
}

class FakeMeetingService {
  constructor() {
    this.calls = [];
    this.reports = [createReport()];
    this.rooms = [
      createMeetingRoom(),
      createMeetingRoom({
        id: SECOND_MEETING_ROOM_ID,
        roomKey: "ROOM_SECOND",
        name: "디자인 회의실",
        isDefault: false
      })
    ];
    this.currentMeetings = new Map([
      [
        MEETING_ROOM_ID,
        {
          meeting: createMeeting(),
          currentRecording: {
            id: RECORDING_ID,
            meetingId: MEETING_ID,
            status: "RUNNING",
            audioFileUrl: null,
            audioFileKey: null,
            durationSec: null,
            fileSizeBytes: null,
            startedAt: "2026-07-08T00:00:00.000Z",
            endedAt: null,
            errorMessage: null
          },
          activeParticipantCount: 2
        }
      ],
      [
        SECOND_MEETING_ROOM_ID,
        {
          meeting: null,
          currentRecording: null,
          activeParticipantCount: 0
        }
      ]
    ]);
    this.participants = [
      {
        id: "99999999-9999-4999-8999-999999999993",
        meetingId: MEETING_ID,
        userId: USER_ID,
        livekitIdentity: "user-1",
        joinedAt: "2026-07-08T00:00:00.000Z",
        leftAt: null,
        isActive: true,
        user: {
          id: USER_ID,
          name: "진호",
          avatarUrl: null
        }
      }
    ];
    this.activeMeeting = {
      meeting: createMeeting(),
      meetingRoom: createMeetingRoom()
    };
    this.recordingConsentAccepted = true;
  }

  async listMeetingRooms(currentUserId, workspaceId) {
    this.calls.push({ method: "listMeetingRooms", currentUserId, workspaceId });
    return { rooms: this.rooms };
  }

  async getCurrentMeetingForRoom(currentUserId, workspaceId, meetingRoomId) {
    this.calls.push({
      method: "getCurrentMeetingForRoom",
      currentUserId,
      workspaceId,
      meetingRoomId
    });
    return this.currentMeetings.get(meetingRoomId);
  }

  async getCurrentUserActiveMeeting(currentUserId) {
    this.calls.push({ method: "getCurrentUserActiveMeeting", currentUserId });
    return this.activeMeeting;
  }

  async getRecordingConsentStatus(currentUserId, workspaceId) {
    this.calls.push({ method: "getRecordingConsentStatus", currentUserId, workspaceId });
    return { accepted: this.recordingConsentAccepted, policyVersion: "v1" };
  }

  async getMeeting(currentUserId, workspaceId, meetingId) {
    this.calls.push({ method: "getMeeting", currentUserId, workspaceId, meetingId });
    return {
      meeting: createMeeting({ id: meetingId }),
      currentRecording: this.currentMeetings.get(MEETING_ROOM_ID).currentRecording,
      recordings: [],
      reports: [],
      participantCount: 2,
      activeParticipantCount: 2,
      currentUserParticipant: this.participants[0]
    };
  }

  async startMeetingInRoom(currentUserId, workspaceId, meetingRoomId, body) {
    this.calls.push({ method: "startMeetingInRoom", currentUserId, workspaceId, meetingRoomId, body });
    return { meeting: createMeeting(), participant: this.participants[0], livekit: { token: "must-not-persist" }, currentRecording: null };
  }

  async joinMeeting(currentUserId, workspaceId, meetingId, body) {
    this.calls.push({ method: "joinMeeting", currentUserId, workspaceId, meetingId, body });
    return { meeting: createMeeting({ id: meetingId }), participant: this.participants[0], livekit: { token: "must-not-persist" }, currentRecording: null };
  }

  async leaveMeeting(currentUserId, workspaceId, meetingId) {
    this.calls.push({ method: "leaveMeeting", currentUserId, workspaceId, meetingId });
    this.activeMeeting = { meeting: null, meetingRoom: null };
    return { participant: { ...this.participants[0], leftAt: new Date().toISOString(), isActive: false }, meetingEnded: false, meeting: createMeeting({ id: meetingId }), currentRecording: null };
  }

  async startRecording(currentUserId, workspaceId, meetingId) {
    this.calls.push({ method: "startRecording", currentUserId, workspaceId, meetingId });
    return { meeting: createMeeting({ id: meetingId }), recording: this.currentMeetings.get(MEETING_ROOM_ID).currentRecording };
  }

  async getCurrentRecording(currentUserId, workspaceId, meetingId) {
    this.calls.push({ method: "getCurrentRecording", currentUserId, workspaceId, meetingId });
    return { recording: this.currentMeetings.get(MEETING_ROOM_ID).currentRecording };
  }

  async endRecordingAndCreateReport(currentUserId, workspaceId, meetingId, recordingId) {
    this.calls.push({ method: "endRecordingAndCreateReport", currentUserId, workspaceId, meetingId, recordingId });
    return {
      meeting: createMeeting({ id: meetingId }),
      recording: { ...this.currentMeetings.get(MEETING_ROOM_ID).currentRecording, status: "COMPLETED", endedAt: new Date().toISOString() },
      report: toSummaryReport(this.reports[0])
    };
  }

  async listParticipants(currentUserId, workspaceId, meetingId) {
    this.calls.push({
      method: "listParticipants",
      currentUserId,
      workspaceId,
      meetingId
    });
    return { participants: this.participants };
  }

  async listReports(currentUserId, workspaceId, query) {
    this.calls.push({
      method: "listReports",
      currentUserId,
      workspaceId,
      query
    });

    return {
      reports: this.reports.map((report) => toSummaryReport(report))
    };
  }

  async getReport(currentUserId, workspaceId, reportId) {
    this.calls.push({
      method: "getReport",
      currentUserId,
      workspaceId,
      reportId
    });

    const report =
      this.reports.find((candidate) => candidate.id === reportId) ?? this.reports[0];

    return {
      report
    };
  }
}

class FakeMeetingTranscriptRagService {
  async search() {
    return [{ sourceId: "99999999-9999-4999-8999-999999999999", reportId: REPORT_ID, startedAtMs: 1000, endedAtMs: 2000, content: "원문은 output에 저장하지 않는다." }];
  }
}

function createRegistry() {
  const meetingService = new FakeMeetingService();
  const meetingTools = new MeetingAgentToolsService(meetingService, new FakeMeetingTranscriptRagService());
  const registry = new AgentToolRegistryService(undefined, meetingTools);

  return {
    meetingService,
    registry
  };
}

const context = {
  currentUserId: USER_ID,
  workspaceId: WORKSPACE_ID,
  runId: RUN_ID
};

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("search_meeting_transcript");
  const result = await tool.execute(context, tool.validateInput({ query: "일정 결론" }));
  assert.equal(tool.requiresGroundedAnswer, true);
  assert.equal(result.outputSummary.sourceCount, 1);
  assert.deepEqual(result.outputSummary.sourceIds, ["99999999-9999-4999-8999-999999999999"]);
  assert.doesNotMatch(JSON.stringify(result.outputSummary), /원문/);
}

function errorCode(error) {
  return error.getResponse().error.code;
}

{
  const { registry } = createRegistry();
  const names = registry.listDefinitions().map((definition) => definition.name);

  assert.deepEqual(names, [
    "list_meeting_rooms",
    "get_active_meeting",
    "get_meeting_participants",
    "start_meeting_in_room",
    "join_meeting",
    "leave_meeting",
    "start_meeting_recording",
    "end_meeting_recording",
    "list_meeting_reports",
    "get_meeting_report",
    "summarize_meeting_report",
    "search_meeting_transcript",
    "find_action_items",
    "get_meeting_decision_evidence",
    "update_meeting_report_action_item",
    "dismiss_meeting_report_action_item",
    "approve_meeting_report_action_item",
    "regenerate_meeting_report"
  ]);
}

{
  const { meetingService, registry } = createRegistry();
  const tool = registry.getDefinition("list_meeting_rooms");
  const result = await tool.execute(context, tool.validateInput({}));

  assert.equal(result.outputSummary.count, 2);
  assert.equal(result.outputSummary.hasMore, false);
  assert.deepEqual(result.outputSummary.rooms[0], {
    roomId: MEETING_ROOM_ID,
    name: "기본 회의실",
    isDefault: true,
    currentMeeting: {
      meetingId: MEETING_ID,
      startedAt: meetingService.currentMeetings.get(MEETING_ROOM_ID).meeting.startedAt,
      activeParticipantCount: 2,
      durationSec: result.outputSummary.rooms[0].currentMeeting.durationSec,
      recording: {
        status: "RUNNING",
        startedAt: "2026-07-08T00:00:00.000Z"
      }
    }
  });
  assert.equal(result.outputSummary.rooms[0].currentMeeting.durationSec >= 89, true);
  assert.equal(result.outputSummary.rooms[1].currentMeeting, null);
  assert.deepEqual(meetingService.calls.map((call) => call.method), [
    "listMeetingRooms",
    "getCurrentMeetingForRoom",
    "getCurrentMeetingForRoom"
  ]);
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("start_meeting_in_room");
  const input = tool.validateInput({ meetingRoomId: SECOND_MEETING_ROOM_ID });
  const plan = await tool.buildConfirmation(context, input);
  assert.equal(plan.toolName, "start_meeting_in_room");
  assert.match(plan.summary, /현재 회의에서 나간 뒤/);
}

{
  const { meetingService, registry } = createRegistry();
  meetingService.recordingConsentAccepted = false;
  const tool = registry.getDefinition("join_meeting");
  const clarification = await tool.buildConfirmation(
    context,
    tool.validateInput({ meetingId: MEETING_ID })
  );
  assert.equal(clarification.kind, "needs_clarification");
  assert.equal(clarification.outputSummary.policyVersion, "v1");
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("join_meeting");
  const result = await tool.execute(
    context,
    tool.validateInput({ meetingId: MEETING_ID })
  );
  assert.equal(result.outputSummary.clientAction.type, "connect_meeting");
  assert.equal(result.outputSummary.clientAction.expiresInSec, 20);
  assert.doesNotMatch(JSON.stringify(result), /must-not-persist/);
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("leave_meeting");
  const result = await tool.execute(
    context,
    tool.validateInput({ meetingId: MEETING_ID })
  );
  assert.equal(result.status, "left");
}

{
  const { registry } = createRegistry();
  const start = registry.getDefinition("start_meeting_recording");
  const end = registry.getDefinition("end_meeting_recording");
  const startResult = await start.execute(
    context,
    start.validateInput({ meetingId: MEETING_ID })
  );
  const endResult = await end.execute(
    context,
    end.validateInput({ meetingId: MEETING_ID })
  );
  assert.equal(startResult.status, "recording_started");
  assert.equal(endResult.status, "recording_ended");
  assert.equal(endResult.outputSummary.reportId, REPORT_ID);
}

{
  const { meetingService, registry } = createRegistry();
  const tool = registry.getDefinition("get_active_meeting");
  const result = await tool.execute(context, tool.validateInput({}));

  assert.equal(result.outputSummary.active, true);
  assert.deepEqual(result.outputSummary.meetingRoom, {
    roomId: MEETING_ROOM_ID,
    name: "기본 회의실",
    isDefault: true
  });
  assert.equal(result.outputSummary.meeting.meetingId, MEETING_ID);
  assert.equal(result.outputSummary.durationSec >= 89, true);
  assert.deepEqual(meetingService.calls, [
    {
      method: "getCurrentUserActiveMeeting",
      currentUserId: USER_ID
    }
  ]);
}

{
  const { meetingService, registry } = createRegistry();
  meetingService.activeMeeting = { meeting: null, meetingRoom: null };
  const tool = registry.getDefinition("get_active_meeting");
  const result = await tool.execute(context, tool.validateInput({}));

  assert.deepEqual(result.outputSummary, {
    active: false,
    meeting: null,
    meetingRoom: null,
    durationSec: null
  });
  assert.deepEqual(result.resourceRefs, []);
}

{
  const { meetingService, registry } = createRegistry();
  const tool = registry.getDefinition("get_meeting_participants");
  const result = await tool.execute(
    context,
    tool.validateInput({ meetingId: MEETING_ID })
  );

  assert.deepEqual(result.outputSummary, {
    meetingId: MEETING_ID,
    count: 1,
    hasMore: false,
    participants: [
      {
        userId: USER_ID,
        name: "진호",
        avatarUrl: null,
        joinedAt: "2026-07-08T00:00:00.000Z",
        leftAt: null,
        isActive: true
      }
    ]
  });
  assert.deepEqual(meetingService.calls, [
    {
      method: "listParticipants",
      currentUserId: USER_ID,
      workspaceId: WORKSPACE_ID,
      meetingId: MEETING_ID
    }
  ]);
}

{
  const { meetingService, registry } = createRegistry();
  const tool = registry.getDefinition("list_meeting_reports");
  const input = tool.validateInput({
    status: "COMPLETED",
    limit: 20
  });
  const result = await tool.execute(context, input);
  const report = result.outputSummary.reports[0];

  assert.equal(result.outputSummary.count, 1);
  assert.equal(report.reportId, REPORT_ID);
  assert.equal(report.status, "COMPLETED");
  assert.equal(report.createdAt, "2026-07-08T00:00:00.000Z");
  assert.deepEqual(
    report.sections.map((section) => section.key),
    ["summary", "discussionPoints", "decisions"]
  );
  assert.equal(report.transcript.available, false);
  assert.equal(report.transcript.stored, false);
  assert.equal(result.resourceRefs[0].domain, "meeting");
  assert.equal(result.resourceRefs[0].resourceType, "meeting_report");
  assert.deepEqual(meetingService.calls[0], {
    method: "listReports",
    currentUserId: USER_ID,
    workspaceId: WORKSPACE_ID,
    query: {
      status: "COMPLETED",
      limit: 20
    }
  });
}

{
  const { meetingService, registry } = createRegistry();
  meetingService.reports = [
    createReport(),
    createReport({
      id: SECOND_REPORT_ID,
      createdAt: "2026-07-07T00:00:00.000Z"
    })
  ];
  const tool = registry.getDefinition("list_meeting_reports");
  const input = tool.validateInput({ limit: 1 });
  const result = await tool.execute(context, input);

  assert.equal(result.outputSummary.count, 1);
  assert.equal(result.outputSummary.reports.length, 1);
  assert.equal(result.outputSummary.reports[0].reportId, REPORT_ID);
  assert.equal(result.resourceRefs.length, 1);
  assert.equal(result.resourceRefs[0].resourceId, REPORT_ID);
  assert.deepEqual(meetingService.calls[0].query, {
    status: undefined,
    limit: 1
  });
}

{
  const { meetingService, registry } = createRegistry();
  meetingService.reports = [
    createReport(),
    createReport({
      id: SECOND_REPORT_ID,
      createdAt: "2026-07-07T00:00:00.000Z"
    }),
    createReport({
      id: THIRD_REPORT_ID,
      createdAt: "2026-07-06T00:00:00.000Z"
    })
  ];
  const tool = registry.getDefinition("list_meeting_reports");
  const result = await tool.execute(context, tool.validateInput({ limit: 2 }));

  assert.equal(result.outputSummary.count, 2);
  assert.deepEqual(
    result.outputSummary.reports.map((report) => report.reportId),
    [REPORT_ID, SECOND_REPORT_ID]
  );
  assert.deepEqual(
    result.resourceRefs.map((ref) => ref.resourceId),
    [REPORT_ID, SECOND_REPORT_ID]
  );
}

await import("./meeting-evidence-rag.test.mjs");

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("summarize_meeting_report");
  const input = tool.validateInput({
    reportId: REPORT_ID
  });
  const result = await tool.execute(context, input);
  const report = result.outputSummary.report;
  const serialized = JSON.stringify(result.outputSummary);

  assert.equal(result.status, "summarized");
  assert.equal(report.reportId, REPORT_ID);
  assert.equal(report.meetingId, MEETING_ID);
  assert.equal(report.transcript.available, true);
  assert.equal(report.transcript.stored, false);
  assert.equal(report.transcript.length > 0, true);
  assert.equal(serialized.includes("회의 원문은 Agent outputSummary"), false);
  assert.deepEqual(report.actionItems[0], {
    title: "문서 정리",
    description: "회의 보고서를 정리한다.",
    assigneeUserId: USER_ID,
    priority: "MEDIUM"
  });
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("get_meeting_report");
  const input = tool.validateInput({
    reportId: REPORT_ID
  });
  const result = await tool.execute(context, input);

  assert.equal(result.status, "completed");
  assert.equal(result.outputSummary.report.sections[0].title, "요약");
}

{
  const { meetingService, registry } = createRegistry();
  meetingService.reports = [
    createReport({
      status: "PROCESSING",
      transcriptText: null,
      summary: null,
      discussionPoints: null,
      decisions: null,
      actionItemCandidates: []
    })
  ];
  const tool = registry.getDefinition("summarize_meeting_report");
  const result = await tool.execute(context, { reportId: REPORT_ID });
  const report = result.outputSummary.report;

  assert.equal(report.status, "PROCESSING");
  assert.deepEqual(report.sections, []);
  assert.deepEqual(report.actionItems, []);
  assert.deepEqual(report.transcript, {
    available: false,
    stored: false,
    length: 0
  });
}

{
  const { meetingService, registry } = createRegistry();
  meetingService.reports = [
    createReport({
      status: "FAILED",
      failedStep: "LLM",
      errorMessage: "provider raw error must not be stored",
      transcriptText: null,
      summary: null,
      discussionPoints: null,
      decisions: null,
      actionItemCandidates: []
    })
  ];
  const tool = registry.getDefinition("summarize_meeting_report");
  const result = await tool.execute(context, { reportId: REPORT_ID });
  const serialized = JSON.stringify(result.outputSummary);

  assert.equal(result.outputSummary.report.status, "FAILED");
  assert.deepEqual(result.outputSummary.report.failure, {
    failedStep: "LLM"
  });
  assert.equal(serialized.includes("provider raw error"), false);
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("get_meeting_report");

  assert.throws(
    () =>
      tool.validateInput({
        reportId: REPORT_ID,
        workspaceId: WORKSPACE_ID
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /workspaceId/);
      return true;
    }
  );
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("list_meeting_rooms");

  assert.throws(
    () => tool.validateInput({ workspaceId: WORKSPACE_ID }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /workspaceId/);
      return true;
    }
  );
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("get_meeting_participants");

  assert.throws(
    () => tool.validateInput({ meetingId: "not-a-uuid" }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /meetingId/);
      return true;
    }
  );
}

for (const limit of [1.9, "1.9"]) {
  const { registry } = createRegistry();
  const tool = registry.getDefinition("list_meeting_reports");

  assert.throws(
    () =>
      tool.validateInput({
        limit
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /positive integer/);
      return true;
    }
  );
}

class FakeActionItemDeliveryDatabase {
  constructor() {
    this.actionItem = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "원래 액션 아이템",
      description: "원래 설명",
      status: "DELIVERY_FAILED"
    };
    this.delivery = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      delivery_type: "pilo_issue",
      draft_json: {
        deliveryType: "pilo_issue",
        issue: {
          boardId: "board-original",
          columnId: "column-original",
          title: "처음 승인한 제목",
          body: "처음 승인한 본문"
        }
      },
      idempotency_key: "meeting-action-item:stable-operation",
      requested_by_user_id: USER_ID,
      status: "FAILED",
      locked_until: null,
      claim_token: null
    };
    this.calls = [];
  }

  async transaction(callback) {
    return callback({
      execute: this.execute.bind(this),
      queryOne: this.queryOne.bind(this)
    });
  }

  async query(text, values = []) {
    this.calls.push({ method: "query", text, values });
    return [{ id: this.actionItem.id }];
  }

  async execute(text, values = []) {
    this.calls.push({ method: "execute", text, values });
    if (text.includes("SET status = 'DELIVERING'")) {
      this.actionItem.status = "DELIVERING";
    }
    return { rows: [] };
  }

  async queryOne(text, values = []) {
    this.calls.push({ method: "queryOne", text, values });
    if (text.includes("SELECT action_items.id")) return { ...this.actionItem };
    if (text.includes("FROM meeting_report_action_item_deliveries")) {
      return { ...this.delivery };
    }
    if (text.includes("SET status = 'RUNNING'")) {
      assert.match(text, /last_attempted_by_user_id = \$3/);
      assert.equal(values[2], USER_ID);
      this.delivery.status = "RUNNING";
      this.delivery.claim_token = values[1];
      this.delivery.locked_until = new Date("2026-07-08T00:05:00.000Z");
      return { ...this.delivery };
    }
    if (text.includes("SET status = 'COMPLETED'")) {
      assert.equal(values[3], this.delivery.claim_token);
      assert.match(
        text,
        /target_resource_id = COALESCE\(\$2::bigint::text, \$3::bigint::text\)/,
        "Delivery completion must store the immutable target ID snapshot"
      );
      assert.equal(values[1], null);
      assert.equal(values[2], "42");
      this.delivery.status = "COMPLETED";
      this.delivery.claim_token = null;
      this.delivery.locked_until = null;
      return { id: this.delivery.id };
    }
    if (text.includes("SET status = 'APPROVED'")) {
      this.actionItem.status = "APPROVED";
      return { id: this.actionItem.id };
    }
    throw new Error(`Unhandled delivery queryOne: ${text}`);
  }
}

class FakeInvalidCalendarDeliveryDatabase {
  constructor() {
    this.actionItem = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      title: "Calendar 제목",
      description: "Calendar 설명",
      status: "PENDING"
    };
    this.insertedDelivery = false;
  }

  async transaction(callback) {
    return callback(this);
  }

  async execute(text) {
    if (text.includes("SET status = 'DELIVERING'")) {
      throw new Error("invalid draft must not claim an action item");
    }
    return { rows: [] };
  }

  async queryOne(text) {
    if (text.includes("SELECT action_items.id")) return { ...this.actionItem };
    if (text.includes("FROM meeting_report_action_item_deliveries")) return null;
    if (text.includes("INSERT INTO meeting_report_action_item_deliveries")) {
      this.insertedDelivery = true;
      throw new Error("invalid draft must not create a delivery");
    }
    throw new Error(`Unhandled invalid-calendar delivery query: ${text}`);
  }
}

{
  const database = new FakeActionItemDeliveryDatabase();
  const boardCalls = [];
  const service = new MeetingActionItemDeliveryService(
    database,
    { async assertWorkspaceAccess() {} },
    {},
    {
      async validateBoardIssueCreateInput() {},
      async createBoardIssue(userId, workspaceId, boardId, input, idempotencyKey) {
        boardCalls.push({ userId, workspaceId, boardId, input, idempotencyKey });
        return { issue: { id: "42" } };
      }
    }
  );

  const result = await service.deliver(
    USER_ID,
    WORKSPACE_ID,
    REPORT_ID,
    database.actionItem.id,
    {
      deliveryType: "pilo_issue",
      issue: {
        boardId: "99",
        columnId: "77",
        title: "재시도에서 바꾼 제목"
      }
    }
  );

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.piloIssueId, "42");
  assert.deepEqual(boardCalls, [
    {
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      boardId: "board-original",
      input: {
        columnId: "column-original",
        title: "처음 승인한 제목",
        body: "처음 승인한 본문"
      },
      idempotencyKey: "meeting-action-item:stable-operation"
    }
  ]);
}

{
  const service = new MeetingActionItemDeliveryService({}, {}, {}, {});
  const error = new HttpException(
    {
      success: false,
      error: {
        code: "BAD_REQUEST",
        message:
          "GitHub ProjectV2 OAuth connection must be reconnected with project and repo scopes"
      }
    },
    HttpStatus.BAD_REQUEST
  );

  assert.equal(
    service.toSafeErrorCode(error),
    "GITHUB_PROJECT_OAUTH_RECONNECT_REQUIRED"
  );
}

{
  const database = new FakeInvalidCalendarDeliveryDatabase();
  const service = new MeetingActionItemDeliveryService(
    database,
    { async assertWorkspaceAccess() {} },
    {
      normalizeCreateEventInput(input) {
        assert.equal(input.startDate, "2026-07-09");
        assert.equal(input.endDate, "2026-07-08");
        const error = new Error("endDate must be on or after startDate");
        error.getStatus = () => 400;
        throw error;
      }
    },
    {}
  );

  await assert.rejects(
    () =>
      service.deliver(USER_ID, WORKSPACE_ID, REPORT_ID, database.actionItem.id, {
        deliveryType: "calendar_event",
        calendar: {
          isAllDay: true,
          startDate: "2026-07-09",
          endDate: "2026-07-08"
        }
      }),
    error => error.getStatus() === 400
  );
  assert.equal(database.insertedDelivery, false);
}

{
  const database = new FakeActionItemDeliveryDatabase();
  const service = new MeetingActionItemDeliveryService(
    database,
    {},
    {},
    {}
  );

  assert.equal(await service.recoverStaleDeliveries(), 1);
  const recovery = database.calls.find((call) => call.method === "query");
  assert.match(recovery.text, /delivery\.locked_until <= now\(\)/);
  assert.match(recovery.text, /FOR UPDATE OF delivery, action_item SKIP LOCKED/);
  assert.match(recovery.text, /last_error_code = 'ACTION_ITEM_DELIVERY_STALE'/);
  assert.match(recovery.text, /SET status = 'DELIVERY_FAILED'/);
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("summarize_meeting_report");

  assert.throws(
    () =>
      tool.validateInput({
        reportId: "not-a-uuid"
      }),
    (error) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(errorCode(error), "BAD_REQUEST");
      assert.match(error.getResponse().error.message, /reportId/);
      return true;
    }
  );
}
