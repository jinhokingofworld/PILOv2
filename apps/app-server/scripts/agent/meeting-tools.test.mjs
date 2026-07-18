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
const { MeetingAgentResourceResolver } = require(
  "../../dist/modules/agent/tools/meeting-agent-resource-resolver.service.js"
);
const { AgentCandidateSelectionService } = require(
  "../../dist/modules/agent/agent-candidate-selection.service.js"
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
const CANDIDATE_STEP_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ACTION_ITEM_ID = "99999999-9999-4999-8999-999999999994";

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
const candidateSelectionMigration = await readFile(
  new URL(
    "../../../../db/migrations/099_create_agent_candidate_selections.sql",
    import.meta.url
  ),
  "utf8"
);

assert.match(
  meetingAgentWorkflowMigration,
  /pilo_issue_id BIGINT[\s\S]*?REFERENCES public\.pilo_issues\(id\) ON DELETE RESTRICT/,
  "The applied 074 migration must keep the Board target FK type compatible"
);
assert.match(
  candidateSelectionMigration,
  /CREATE TABLE public\.agent_candidate_selections[\s\S]*?run_id UUID NOT NULL REFERENCES public\.agent_runs\(id\) ON DELETE CASCADE[\s\S]*?tool_step_id UUID NOT NULL REFERENCES public\.agent_steps\(id\) ON DELETE CASCADE/,
  "Meeting candidate records must be bound to one Agent run and clarification step"
);
assert.match(
  candidateSelectionMigration,
  /expires_at TIMESTAMPTZ NOT NULL DEFAULT \(now\(\) \+ INTERVAL '15 minutes'\)[\s\S]*?consumed_at TIMESTAMPTZ/,
  "Meeting candidate records must be short-lived and one-time consumable"
);
assert.match(
  candidateSelectionMigration,
  /ALTER TABLE public\.agent_candidate_selections ENABLE ROW LEVEL SECURITY/,
  "Meeting candidate records must remain server-only behind all-deny RLS"
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
assert.match(
  meetingServiceSource,
  /async listMeetingsForAgent[\s\S]*?WHERE meetings\.workspace_id = \$1/,
  "Meeting resolver reads must scope every Meeting query to the current Workspace"
);
assert.match(
  meetingServiceSource,
  /async listActionItemsForAgent[\s\S]*?WHERE meetings\.workspace_id = \$1/,
  "Action item resolver reads must scope every query to the current Workspace"
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
    this.meetings = [
      {
        meeting: createMeeting(),
        roomName: "기본 회의실"
      }
    ];
    this.actionItems = [
      {
        id: "99999999-9999-4999-8999-999999999994",
        reportId: REPORT_ID,
        sourceIndex: 0,
        title: "문서 정리",
        status: "PENDING",
        assignee: { userId: USER_ID, name: "진호", avatarUrl: null },
        reportCreatedAt: "2026-07-08T00:00:00.000Z"
      }
    ];
    this.reports[0].actionItems = [
      {
        id: this.actionItems[0].id,
        title: this.actionItems[0].title,
        status: this.actionItems[0].status
      }
    ];
    this.staleMeetingIds = new Set();
    this.staleReportIds = new Set();
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
    if (this.staleMeetingIds.has(meetingId)) {
      throw new Error("Meeting no longer exists");
    }
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

  async listReportsForAgent(currentUserId, workspaceId, query) {
    this.calls.push({
      method: "listReportsForAgent",
      currentUserId,
      workspaceId,
      query
    });
    return {
      reports: this.reports.slice(0, query.limit ?? this.reports.length).map((report) =>
        toSummaryReport(report)
      )
    };
  }

  async listMeetingsForAgent(currentUserId, workspaceId, query) {
    this.calls.push({
      method: "listMeetingsForAgent",
      currentUserId,
      workspaceId,
      query
    });
    return { meetings: this.meetings };
  }

  async listActionItemsForAgent(currentUserId, workspaceId, query) {
    this.calls.push({
      method: "listActionItemsForAgent",
      currentUserId,
      workspaceId,
      query
    });
    return { actionItems: this.actionItems };
  }

  async getReport(currentUserId, workspaceId, reportId) {
    this.calls.push({
      method: "getReport",
      currentUserId,
      workspaceId,
      reportId
    });

    if (this.staleReportIds.has(reportId)) {
      throw new Error("Meeting report no longer exists");
    }

    const report =
      this.reports.find((candidate) => candidate.id === reportId) ?? this.reports[0];

    return {
      report
    };
  }
}

class FakeMeetingTranscriptRagService {
  constructor() {
    this.calls = [];
  }

  async search(currentUserId, workspaceId, input) {
    this.calls.push({ currentUserId, workspaceId, input });
    return [{ sourceId: "99999999-9999-4999-8999-999999999999", reportId: REPORT_ID, startedAtMs: 1000, endedAtMs: 2000, content: "원문은 output에 저장하지 않는다." }];
  }
}

class FakeWorkspaceService {
  constructor() {
    this.members = [
      {
        userId: USER_ID,
        role: "owner",
        user: { name: "진호", email: "jinho@example.com" }
      },
      {
        userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        role: "member",
        user: { name: "김진호", email: "jinho.one@example.com" }
      },
      {
        userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        role: "member",
        user: { name: "김진호", email: "jinho.two@example.com" }
      }
    ];
  }

  async assertWorkspaceAccess() {}

  async listMembers() {
    return this.members;
  }
}

function createRegistry() {
  const meetingService = new FakeMeetingService();
  const meetingTools = new MeetingAgentToolsService(
    meetingService,
    new FakeMeetingTranscriptRagService(),
    undefined,
    new MeetingAgentResourceResolver(meetingService, new FakeWorkspaceService())
  );
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

process.env.SESSION_SECRET ??= "meeting-agent-tools-test-secret";

{
  const meetingService = new FakeMeetingService();
  const ragService = new FakeMeetingTranscriptRagService();
  const registry = new AgentToolRegistryService(
    undefined,
    new MeetingAgentToolsService(
      meetingService,
      ragService,
      undefined,
      new MeetingAgentResourceResolver(meetingService, new FakeWorkspaceService())
    )
  );
  const tool = registry.getDefinition("search_meeting_transcript");
  const result = await tool.execute(context, tool.validateInput({ query: "일정 결론" }));
  assert.equal(tool.requiresGroundedAnswer, true);
  assert.equal(tool.executionMode, "contextual");
  assert.equal(result.outputSummary.sourceCount, 1);
  assert.deepEqual(result.outputSummary.sourceIds, ["99999999-9999-4999-8999-999999999999"]);
  assert.doesNotMatch(JSON.stringify(result.outputSummary), /원문/);
  assert.deepEqual(ragService.calls[0].input, { query: "일정 결론" });

  const preparation = await tool.prepareExecution(
    context,
    tool.validateInput({ query: "일정 결론", roomName: "기본 회의실" })
  );
  assert.deepEqual(preparation, { kind: "execute" });
  await tool.execute(
    context,
    tool.validateInput({ query: "일정 결론", roomName: "기본 회의실" })
  );
  assert.deepEqual(ragService.calls[1].input, {
    query: "일정 결론",
    reportId: REPORT_ID
  });

  assert.throws(
    () => tool.validateInput({ query: "일정 결론", reportId: REPORT_ID })
  );
}

class FakeCandidateSelectionDatabase {
  constructor() {
    this.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    this.resourceId = MEETING_ROOM_ID;
    this.latestStepId = CANDIDATE_STEP_ID;
    this.consumed = false;
  }

  async transaction(callback) {
    return callback(this);
  }

  async queryOne(text, values = []) {
    if (text.includes("INSERT INTO agent_candidate_selections")) {
      return {
        id: this.id,
        tool_step_id: CANDIDATE_STEP_ID,
        resource_type: "meeting_room",
        resource_id: this.resourceId,
        report_id: null,
        label: "기본 회의실",
        description: "기본 회의방",
        status: null
      };
    }
    if (text.includes("FROM agent_candidate_selections")) {
      const [id, workspaceId, userId, runId] = values;
      if (
        this.consumed ||
        this.latestStepId !== CANDIDATE_STEP_ID ||
        id !== this.id ||
        workspaceId !== WORKSPACE_ID ||
        userId !== USER_ID ||
        runId !== RUN_ID
      ) {
        return null;
      }
      return {
        id: this.id,
        tool_step_id: CANDIDATE_STEP_ID,
        resource_type: "meeting_room",
        resource_id: this.resourceId,
        report_id: null,
        label: "기본 회의실",
        description: "기본 회의방",
        status: null
      };
    }
    if (text.includes("UPDATE agent_candidate_selections SET consumed_at")) {
      if (this.consumed || values[0] !== this.id) return null;
      this.consumed = true;
      return { id: this.id };
    }
    return null;
  }
}

{
  const database = new FakeCandidateSelectionDatabase();
  const resolver = {
    async revalidateReference(_context, reference) {
      return reference.resourceId === MEETING_ROOM_ID ? reference : null;
    }
  };
  const service = new AgentCandidateSelectionService(database, resolver);
  const context = {
    currentUserId: USER_ID,
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    requestContext: null
  };
  const [candidate] = await service.createMeetingCandidates(context, CANDIDATE_STEP_ID, [
    {
      reference: { resourceType: "meeting_room", resourceId: MEETING_ROOM_ID },
      candidate: {
        resourceType: "meeting_room",
        label: "기본 회의실",
        description: "기본 회의방",
        status: null
      }
    }
  ]);
  assert.deepEqual(candidate, {
    candidateSelectionId: database.id,
    resourceType: "meeting_room",
    label: "기본 회의실",
    description: "기본 회의방",
    status: null
  });
  assert.doesNotMatch(JSON.stringify(candidate), new RegExp(MEETING_ROOM_ID));
  assert.deepEqual(
    await service.consumeMeetingCandidate(context, candidate.candidateSelectionId),
    {
      label: "기본 회의실",
      reference: { resourceType: "meeting_room", resourceId: MEETING_ROOM_ID }
    }
  );
  await assert.rejects(
    () => service.consumeMeetingCandidate(context, candidate.candidateSelectionId),
    (error) => error.getStatus?.() === 400
  );
}

{
  const database = new FakeCandidateSelectionDatabase();
  database.latestStepId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const service = new AgentCandidateSelectionService(database, {
    async revalidateReference(_context, reference) {
      return reference;
    }
  });
  await assert.rejects(
    () => service.consumeMeetingCandidate(context, database.id),
    (error) => error.getStatus?.() === 400,
    "A candidate from an earlier clarification cannot be claimed after a newer tool step"
  );
}

{
  const selectedMemberId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const calls = [];
  const candidateSelectionService = {
    async getLatestConsumedMeetingReference(candidateContext, resourceType) {
      calls.push({ candidateContext, resourceType });
      return {
        resourceType: "workspace_member",
        resourceId: selectedMemberId
      };
    }
  };
  const meetingService = {
    async updateMeetingReportActionItem(...args) {
      calls.push({ method: "updateMeetingReportActionItem", args });
      return {
        actionItem: {
          id: ACTION_ITEM_ID,
          title: "문서 정리",
          status: "PENDING"
        }
      };
    }
  };
  const tools = new MeetingAgentToolsService(
    meetingService,
    {},
    {},
    undefined,
    candidateSelectionService
  );
  const definition = tools
    .listDefinitions()
    .find((tool) => tool.name === "update_meeting_report_action_item");
  const result = await definition.execute(
    context,
    definition.validateConfirmationInput({
      reportId: REPORT_ID,
      actionItemId: ACTION_ITEM_ID,
      useSelectedWorkspaceMemberCandidate: true
    })
  );

  assert.equal(result.status, "updated");
  assert.deepEqual(calls, [
    {
      candidateContext: context,
      resourceType: "workspace_member"
    },
    {
      method: "updateMeetingReportActionItem",
      args: [
        USER_ID,
        WORKSPACE_ID,
        REPORT_ID,
        ACTION_ITEM_ID,
        { assigneeUserId: selectedMemberId }
      ]
    }
  ]);
  assert.doesNotMatch(JSON.stringify(result.outputSummary), new RegExp(selectedMemberId));
}

{
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "meeting-agent-resource-resolver-test-secret";
  try {
    const meetingService = new FakeMeetingService();
    const workspaceService = new FakeWorkspaceService();
    const resolver = new MeetingAgentResourceResolver(
      meetingService,
      workspaceService,
      {
        async resolveMeetingReference(_context, contextRef) {
          if (contextRef === "ctx_0123456789abcdef01234567") {
            return { resourceType: "meeting_report", resourceId: REPORT_ID };
          }
          if (contextRef === "ctx_89abcdef0123456789abcdef") {
            return { resourceType: "meeting", resourceId: MEETING_ID };
          }
          return null;
        }
      }
    );

    const contextReport = await resolver.resolveContextReference(
      context,
      "ctx_0123456789abcdef01234567",
      "meeting_report"
    );
    assert.equal(contextReport.kind, "selected");
    assert.equal(contextReport.reference.resourceId, REPORT_ID);
    assert.equal(
      (
        await resolver.resolveContextReference(
          context,
          "ctx_0123456789abcdef01234567",
          "meeting"
        )
      ).kind,
      "needs_clarification"
    );

    const contextTools = new MeetingAgentToolsService(
      meetingService,
      new FakeMeetingTranscriptRagService(),
      undefined,
      resolver
    );
    const reportTool = contextTools
      .listDefinitions()
      .find((tool) => tool.name === "get_meeting_report");
    const reportResult = await reportTool.execute(
      context,
      reportTool.validateInput({
        contextRef: "ctx_0123456789abcdef01234567"
      })
    );
    assert.equal(reportResult.outputSummary.report.reportId, REPORT_ID);

    for (const toolName of [
      "find_action_items",
      "get_meeting_decision_evidence",
      "regenerate_meeting_report"
    ]) {
      const contextualTool = contextTools
        .listDefinitions()
        .find((tool) => tool.name === toolName);
      assert.throws(
        () => contextualTool.validateInput({ reportId: REPORT_ID }),
        (error) =>
          error.getStatus?.() === 400 &&
          error.response?.error?.message?.includes("reportId is not supported"),
        `${toolName} must not accept a raw planner-facing reportId`
      );
      const contextualInput = contextualTool.validateInput({
        contextRef: "ctx_0123456789abcdef01234567",
        ...(toolName === "get_meeting_decision_evidence"
          ? { decisionIndex: 0 }
          : {})
      });
      if (contextualTool.prepareExecution) {
        assert.deepEqual(
          await contextualTool.prepareExecution(context, contextualInput),
          { kind: "execute" }
        );
      }
      if (toolName === "regenerate_meeting_report") {
        const plan = await contextualTool.buildConfirmation(
          context,
          contextualInput
        );
        assert.equal(plan.call.input.reportId, REPORT_ID);
      }
    }

    const leaveTool = contextTools
      .listDefinitions()
      .find((tool) => tool.name === "leave_meeting");
    assert.deepEqual(
      await leaveTool.prepareExecution(
        context,
        leaveTool.validateInput({
          contextRef: "ctx_89abcdef0123456789abcdef"
        })
      ),
      { kind: "execute" }
    );

    const updateTool = contextTools
      .listDefinitions()
      .find((tool) => tool.name === "update_meeting_report_action_item");
    assert.equal(updateTool.adaptLegacyPlannerInput, undefined);
    assert.throws(
      () =>
        updateTool.validateInput({
          reportId: REPORT_ID,
          actionItemId: ACTION_ITEM_ID,
          priority: "HIGH"
        }),
      (error) =>
        error.getStatus?.() === 400 &&
        error.response?.error?.message?.includes("reportId is not supported"),
      "new planner output must not reintroduce raw action item IDs"
    );
    assert.deepEqual(
      updateTool.validateConfirmationInput({
        reportId: REPORT_ID,
        actionItemId: ACTION_ITEM_ID,
        priority: "HIGH"
      }),
      {
        reportId: REPORT_ID,
        actionItemId: ACTION_ITEM_ID,
        priority: "HIGH"
      },
      "an already persisted confirmation plan remains executable after revalidation"
    );
    const updatePlan = await updateTool.buildConfirmation(
      context,
      updateTool.validateInput({
        reportContextRef: "ctx_0123456789abcdef01234567",
        ordinal: 1,
        priority: "HIGH"
      })
    );
    assert.equal(updatePlan.toolName, "update_meeting_report_action_item");
    assert.equal(updatePlan.call.input.reportId, REPORT_ID);
    assert.equal(updatePlan.call.input.actionItemId, ACTION_ITEM_ID);
    assert.equal(updatePlan.call.input.priority, "HIGH");

    const room = await resolver.resolveMeetingRoom(context, " 디자인   회의실 ");
    assert.equal(room.kind, "selected");
    assert.equal(room.candidate.label, "디자인 회의실");
    assert.equal(room.candidate.resourceType, "meeting_room");
    assert.equal(room.selectionToken.includes(SECOND_MEETING_ROOM_ID), false);
    assert.deepEqual(
      await resolver.revalidateSelectionToken(context, room.selectionToken),
      room.reference
    );
    assert.equal(
      await resolver.revalidateSelectionToken(
        { ...context, workspaceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
        room.selectionToken
      ),
      null
    );
    assert.equal(
      await resolver.revalidateSelectionToken(
        { ...context, currentUserId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
        room.selectionToken
      ),
      null
    );
    assert.equal(
      await resolver.revalidateSelectionToken(
        { ...context, runId: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
        room.selectionToken
      ),
      null
    );
    const tamperSegment = (token, index) => {
      const parts = token.split(".");
      const first = parts[index][0];
      parts[index] = `${first === "A" ? "B" : "A"}${parts[index].slice(1)}`;
      return parts.join(".");
    };
    for (const index of [2, 3, 4]) {
      assert.equal(
        await resolver.revalidateSelectionToken(
          context,
          tamperSegment(room.selectionToken, index)
        ),
        null
      );
    }
    const originalNow = Date.now;
    try {
      let now = 1_000;
      Date.now = () => now;
      const expiringRoom = await resolver.resolveMeetingRoom(context, "기본 회의실");
      assert.equal(expiringRoom.kind, "selected");
      now += 15 * 60 * 1000 + 1;
      assert.equal(
        await resolver.revalidateSelectionToken(context, expiringRoom.selectionToken),
        null
      );
    } finally {
      Date.now = originalNow;
    }
    delete process.env.SESSION_SECRET;
    await assert.rejects(
      () => resolver.resolveMeetingRoom(context, "기본 회의실"),
      /SESSION_SECRET/
    );
    process.env.SESSION_SECRET = "meeting-agent-resource-resolver-test-secret";

    const missingRoom = await resolver.resolveMeetingRoom(context, "없는 회의실");
    assert.equal(missingRoom.kind, "needs_clarification");
    assert.equal(missingRoom.reason, "not_found");

    meetingService.rooms.push(
      createMeetingRoom({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        roomKey: "ROOM_THIRD",
        name: "디자인 회의실",
        isDefault: false
      })
    );
    const ambiguousRoom = await resolver.resolveMeetingRoom(context, "디자인 회의실");
    assert.equal(ambiguousRoom.kind, "needs_clarification");
    assert.equal(ambiguousRoom.reason, "ambiguous");
    assert.equal(ambiguousRoom.candidates.length, 2);
    assert.doesNotMatch(JSON.stringify(ambiguousRoom.candidates), /[0-9a-f]{8}-/i);
    assert.equal(typeof ambiguousRoom.candidates[0].selectionToken, "string");
    assert.notEqual(
      ambiguousRoom.candidates[0].selectionToken,
      ambiguousRoom.candidates[1].selectionToken
    );

    const member = await resolver.resolveMember(context, { displayName: "김진호" });
    assert.equal(member.kind, "needs_clarification");
    assert.equal(member.reason, "ambiguous");
    const self = await resolver.resolveMember(context, { self: true });
    assert.equal(self.kind, "selected");
    assert.equal(self.candidate.label, "진호");
    const staleMemberToken = self.selectionToken;
    workspaceService.members = [];
    assert.equal(
      await resolver.revalidateSelectionToken(context, staleMemberToken),
      null
    );
    workspaceService.members = [
      {
        userId: USER_ID,
        role: "owner",
        user: { name: "진호" }
      },
      {
        userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        role: "member",
        user: { name: "김진호" }
      },
      {
        userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        role: "member",
        user: { name: "김진호" }
      }
    ];

    const meeting = await resolver.resolveMeeting(context, {
      roomName: "기본 회의실",
      from: "2026-07-08T00:00:00.000Z",
      to: "2026-07-09T00:00:00.000Z"
    });
    assert.equal(meeting.kind, "selected");
    assert.equal(meeting.candidate.label, "기본 회의실");
    meetingService.staleMeetingIds.add(meeting.reference.resourceId);
    assert.equal(
      await resolver.revalidateSelectionToken(context, meeting.selectionToken),
      null
    );
    meetingService.staleMeetingIds.clear();

    const report = await resolver.resolveReport(context, { status: "COMPLETED" });
    assert.equal(report.kind, "selected");
    assert.equal(report.candidate.status, "COMPLETED");
    meetingService.staleReportIds.add(report.reference.resourceId);
    assert.equal(
      await resolver.revalidateSelectionToken(context, report.selectionToken),
      null
    );
    meetingService.staleReportIds.clear();
    meetingService.reports.push(createReport({ id: SECOND_REPORT_ID }));
    const latestReport = await resolver.resolveLatestReport(context);
    assert.equal(latestReport.kind, "selected");
    assert.equal(latestReport.reference.resourceId, REPORT_ID);
    const ambiguousReport = await resolver.resolveReport(context, {});
    assert.equal(ambiguousReport.kind, "needs_clarification");
    assert.equal(ambiguousReport.reason, "ambiguous");
    meetingService.reports.splice(1);

    meetingService.activeMeeting = {
      meeting: createMeeting({
        workspaceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
      }),
      meetingRoom: createMeetingRoom({
        workspaceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
      })
    };
    const otherWorkspaceActive = await resolver.resolveCurrentMeeting(context);
    assert.equal(otherWorkspaceActive.kind, "needs_clarification");
    assert.equal(otherWorkspaceActive.reason, "not_found");

    meetingService.activeMeeting = {
      meeting: createMeeting(),
      meetingRoom: createMeetingRoom()
    };
    meetingService.actionItems.push({
      id: "99999999-9999-4999-8999-999999999995",
      reportId: REPORT_ID,
      sourceIndex: 8,
      title: "두 번째 필터 결과",
      status: "PENDING",
      assignee: { userId: USER_ID, name: "진호", avatarUrl: null },
      reportCreatedAt: "2026-07-08T00:00:00.000Z"
    });
    const secondActionItem = await resolver.resolveActionItem(context, {
      reportId: REPORT_ID,
      ordinal: 2
    });
    assert.equal(secondActionItem.kind, "selected");
    assert.equal(secondActionItem.candidate.label, "두 번째 필터 결과");
    meetingService.actionItems.splice(1);
    const actionItem = await resolver.resolveActionItem(context, {
      reportId: REPORT_ID,
      ordinal: 1
    });
    assert.equal(actionItem.kind, "selected");
    assert.equal(actionItem.candidate.label, "문서 정리");
    assert.deepEqual(
      await resolver.revalidateSelectionToken(context, actionItem.selectionToken),
      actionItem.reference
    );
    meetingService.reports[0].actionItems = [];
    assert.equal(
      await resolver.revalidateSelectionToken(context, actionItem.selectionToken),
      null
    );
  } finally {
    if (previousSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSecret;
    }
  }
}

function errorCode(error) {
  return error.getResponse().error.code;
}

{
  const { registry } = createRegistry();
  const names = registry.listDefinitions().map((definition) => definition.name);

  assert.deepEqual(names, [
    "list_meeting_rooms",
    "resolve_meeting_resource",
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
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "meeting-tool-selection-test-secret";
  const meetingService = new FakeMeetingService();
  const workspaceService = new FakeWorkspaceService();
  const resolver = new MeetingAgentResourceResolver(
    meetingService,
    workspaceService
  );
  const meetingTools = new MeetingAgentToolsService(
    meetingService,
    new FakeMeetingTranscriptRagService(),
    undefined,
    resolver
  );
  const tool = meetingTools
    .listDefinitions()
    .find((definition) => definition.name === "resolve_meeting_resource");
  try {
    const preparation = await tool.prepareExecution(context, {
      resourceType: "workspace_member",
      displayName: "김진호"
    });
    assert.equal(preparation.kind, "needs_clarification");
    assert.equal(preparation.candidateResources.length, 2);
    assert.match(preparation.candidateResources[0].candidate.description, /member · ji\*+@example\.com/);
    assert.equal(
      "resourceId" in preparation.outputSummary,
      false,
      "Clarification output must not persist a raw resource reference"
    );
  } finally {
    if (previousSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSecret;
    }
  }
}

{
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "meeting-tool-sequential-selection-test-secret";
  const meetingService = new FakeMeetingService();
  const resolver = new MeetingAgentResourceResolver(
    meetingService,
    new FakeWorkspaceService()
  );
  const selectedMemberId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const candidateSelectionService = {
    async getLatestConsumedMeetingReference(_context, resourceType) {
      if (resourceType === "meeting_report_action_item") {
        return {
          resourceType,
          resourceId: ACTION_ITEM_ID,
          reportId: REPORT_ID
        };
      }
      if (resourceType === "workspace_member") {
        return { resourceType, resourceId: selectedMemberId };
      }
      return null;
    }
  };
  const meetingTools = new MeetingAgentToolsService(
    meetingService,
    new FakeMeetingTranscriptRagService(),
    undefined,
    resolver,
    candidateSelectionService
  );
  const tool = meetingTools
    .listDefinitions()
    .find(
      (definition) => definition.name === "update_meeting_report_action_item"
    );
  try {
    const nextSelection = await tool.buildConfirmation(
      context,
      tool.validateInput({
        useSelectedMeetingActionItemCandidate: true,
        assigneeDisplayName: "김진호"
      })
    );
    assert.equal(nextSelection.kind, "needs_clarification");
    assert.equal(nextSelection.candidateResources.length, 2);
    assert.equal(
      nextSelection.candidateResources[0].candidate.resourceType,
      "workspace_member"
    );

    const confirmation = await tool.buildConfirmation(
      context,
      tool.validateInput({
        useSelectedMeetingActionItemCandidate: true,
        useSelectedWorkspaceMemberCandidate: true
      })
    );
    assert.equal(confirmation.toolName, "update_meeting_report_action_item");
    assert.equal(confirmation.target.resourceId, ACTION_ITEM_ID);
    assert.equal(confirmation.call.input.assigneeUserId, selectedMemberId);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSecret;
    }
  }
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
  const input = tool.validateInput({ roomName: "디자인 회의실" });
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
    tool.validateInput({ roomName: "기본 회의실" })
  );
  assert.equal(clarification.kind, "needs_clarification");
  assert.equal(clarification.outputSummary.policyVersion, "v1");
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("join_meeting");
  const result = await tool.execute(
    context,
    tool.validateConfirmationInput({ meetingId: MEETING_ID })
  );
  assert.equal(result.outputSummary.clientAction.type, "connect_meeting");
  assert.equal(result.outputSummary.clientAction.expiresInSec, 20);
  assert.doesNotMatch(JSON.stringify(result), /must-not-persist/);
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("leave_meeting");
  const preparation = await tool.prepareExecution(context, tool.validateInput({}));
  assert.equal(preparation.kind, "execute");
  const result = await tool.execute(context, tool.validateInput({}));
  assert.equal(result.status, "left");
}

{
  const { registry } = createRegistry();
  const start = registry.getDefinition("start_meeting_recording");
  const end = registry.getDefinition("end_meeting_recording");
  const startResult = await start.execute(
    context,
    start.validateConfirmationInput({ meetingId: MEETING_ID })
  );
  const endResult = await end.execute(
    context,
    end.validateConfirmationInput({ meetingId: MEETING_ID })
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
  const result = await tool.execute(context, tool.validateInput({}));

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
      method: "getCurrentUserActiveMeeting",
      currentUserId: USER_ID
    },
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
    method: "listReportsForAgent",
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
  assert.deepEqual(meetingService.calls[0].query, { limit: 1 });
}

{
  const { meetingService, registry } = createRegistry();
  const tool = registry.getDefinition("list_meeting_reports");
  const result = await tool.execute(
    context,
    tool.validateInput({ roomName: "디자인 회의실" })
  );

  assert.equal(result.outputSummary.count, 1);
  assert.deepEqual(meetingService.calls[0].query, {
    roomName: "디자인 회의실",
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
    })
  ];
  const tool = registry.getDefinition("list_meeting_reports");
  const result = await tool.execute(context, tool.validateInput({}));

  assert.equal(result.outputSummary.count, 1);
  assert.equal(result.outputSummary.reports[0].reportId, REPORT_ID);
  assert.deepEqual(meetingService.calls[0].query, { limit: 1 });
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

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("summarize_meeting_report");
  const result = await tool.execute(context, tool.validateInput({}));
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
  const tool = registry.getDefinition("summarize_meeting_report");
  const result = await tool.execute(
    context,
    tool.validateInput({ sections: ["decisions", "actionItems"] })
  );
  const report = result.outputSummary.report;

  assert.deepEqual(result.outputSummary.sections, ["decisions", "actionItems"]);
  assert.deepEqual(report.sections.map((section) => section.key), ["decisions"]);
  assert.equal(Array.isArray(report.actionItems), true);
  assert.equal(report.transcript, undefined);
  assert.equal(JSON.stringify(report).includes("논의사항"), false);
  assert.equal(JSON.stringify(report).includes("요약"), false);
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("summarize_meeting_report");

  for (const input of [
    { sections: [] },
    { sections: ["decisions", "decisions"] },
    { sections: ["transcript"] }
  ]) {
    assert.throws(
      () => tool.validateInput(input),
      (error) => error.getStatus() === 400
    );
  }
}

{
  const { registry } = createRegistry();
  const tool = registry.getDefinition("get_meeting_report");
  const result = await tool.execute(context, tool.validateInput({}));

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
  const result = await tool.execute(context, tool.validateInput({}));
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
  const result = await tool.execute(context, tool.validateInput({}));
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

{
  const { registry } = createRegistry();
  for (const toolName of [
    "get_meeting_participants",
    "join_meeting",
    "leave_meeting",
    "start_meeting_recording",
    "end_meeting_recording"
  ]) {
    const tool = registry.getDefinition(toolName);
    assert.throws(
      () => tool.validateInput({ meetingId: MEETING_ID }),
      (error) => {
        assert.match(error.getResponse().error.message, /meetingId/);
        return true;
      },
      `${toolName} must not expose a raw meetingId in the planner input`
    );
  }
  for (const toolName of ["get_meeting_report", "summarize_meeting_report"]) {
    const tool = registry.getDefinition(toolName);
    assert.throws(
      () => tool.validateInput({ reportId: REPORT_ID }),
      (error) => {
        assert.match(error.getResponse().error.message, /reportId/);
        return true;
      },
      `${toolName} must not expose a raw reportId in the planner input`
    );
  }
  assert.throws(
    () =>
      registry
        .getDefinition("start_meeting_in_room")
        .validateInput({ meetingRoomId: MEETING_ROOM_ID }),
    (error) => {
      assert.match(error.getResponse().error.message, /meetingRoomId/);
      return true;
    },
    "start_meeting_in_room must resolve a room selector instead of accepting a raw ID"
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
