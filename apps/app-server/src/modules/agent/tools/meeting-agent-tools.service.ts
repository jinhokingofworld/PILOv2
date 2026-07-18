import { Injectable } from "@nestjs/common";
import { badRequest } from "../../../common/api-error";
import {
  MeetingPayload,
  MeetingReportDetailPayload,
  MeetingReportSummaryPayload,
  MeetingRoomPayload,
  MeetingService
} from "../../meeting/meeting.service";
import {
  MeetingActionItemDeliveryInput,
  MeetingActionItemDeliveryService
} from "../../meeting/meeting-action-item-delivery.service";
import { MeetingTranscriptRagService } from "../../meeting/meeting-transcript-rag.service";
import { AgentCandidateSelectionService } from "../agent-candidate-selection.service";
import {
  type MeetingAgentResourceReference,
  type MeetingAgentResourceResolution,
  type MeetingAgentResourceType,
  MeetingAgentResourceResolver
} from "./meeting-agent-resource-resolver.service";
import type {
  AgentConfirmationPlan,
  AgentJsonObject,
  AgentJsonValue,
  AgentResourceRef,
  AgentToolClarificationResult,
  AgentToolContext,
  AgentToolDefinition,
  AgentToolExecutionResult
} from "../types/agent-tool.types";

type MeetingReportStatus =
  | "QUEUED"
  | "TRANSCRIBING"
  | "SUMMARIZING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

interface ListMeetingReportsInput {
  status?: MeetingReportStatus;
  from?: string;
  to?: string;
  /** Agent-only filter. The Meeting REST API deliberately does not expose it. */
  roomName?: string;
  limit: number;
}

interface ReportIdInput {
  reportId: string;
}

interface MeetingIdInput {
  meetingId: string;
}

interface MeetingSelectorInput {
  contextRef?: string;
  current?: true;
  roomName?: string;
  useSelectedMeetingCandidate?: true;
}

interface MeetingReportSelectorInput {
  contextRef?: string;
  from?: string;
  to?: string;
  status?: MeetingReportStatus;
  roomName?: string;
  useSelectedMeetingReportCandidate?: true;
}

interface LegacyPersistedReportReferenceInput extends ReportIdInput {
  legacyPersistedPlannerInput: true;
}

interface LegacyPersistedDecisionEvidenceInput extends DecisionEvidenceInput {
  legacyPersistedPlannerInput: true;
}

interface RecordingConsentInput {
  accepted: true;
  policyVersion: string;
}

interface StartMeetingInput {
  roomName?: string;
  useSelectedMeetingRoomCandidate?: true;
  recordingConsent?: RecordingConsentInput;
}

interface ResolvedStartMeetingInput {
  meetingRoomId: string;
  recordingConsent?: RecordingConsentInput;
}

interface JoinMeetingInput extends MeetingSelectorInput {
  recordingConsent?: RecordingConsentInput;
}

interface ResolvedJoinMeetingInput extends MeetingIdInput {
  recordingConsent?: RecordingConsentInput;
}

interface SearchMeetingTranscriptInput { query: string; reportId?: string }

interface ActionItemInput extends ReportIdInput { actionItemId: string }

interface ActionItemContextInput {
  actionItemContextRef?: string;
  reportContextRef?: string;
  ordinal?: number;
  useSelectedMeetingActionItemCandidate?: true;
}

interface UpdateActionItemContextInput extends ActionItemContextInput {
  title?: string;
  description?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  assigneeUserId?: string | null;
  assigneeDisplayName?: string;
  useSelectedWorkspaceMemberCandidate?: true;
}

interface UpdateActionItemInput extends ActionItemInput {
  title?: string;
  description?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  assigneeUserId?: string | null;
  useSelectedWorkspaceMemberCandidate?: true;
}

interface ResolvedUpdateActionItemInput extends ActionItemInput {
  title?: string;
  description?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  assigneeUserId?: string | null;
}

interface ApproveActionItemInput extends ActionItemInput {
  delivery: MeetingActionItemDeliveryInput;
}

interface ApproveActionItemContextInput extends ActionItemContextInput {
  delivery: MeetingActionItemDeliveryInput;
}

interface DecisionEvidenceInput extends ReportIdInput { decisionIndex?: number }

interface DecisionEvidenceSelectorInput extends MeetingReportSelectorInput {
  decisionIndex?: number;
}

interface ResolveMeetingResourceInput {
  resourceType: "meeting_room" | "workspace_member";
  roomName?: string;
  displayName?: string;
  self?: boolean;
  useLatestCandidate?: boolean;
}

interface ProjectionOptions {
  sectionTextLimit: number;
}

const MEETING_REPORT_STATUSES: readonly MeetingReportStatus[] = [
  "QUEUED",
  "TRANSCRIBING",
  "SUMMARIZING",
  "PROCESSING",
  "COMPLETED",
  "FAILED"
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIST_INPUT_FIELDS = ["status", "from", "to", "roomName", "limit"];
const REPORT_ID_INPUT_FIELDS = ["reportId"];
const MEETING_ID_INPUT_FIELDS = ["meetingId"];
const MEETING_SELECTOR_INPUT_FIELDS = [
  "contextRef",
  "current",
  "roomName",
  "useSelectedMeetingCandidate"
];
const REPORT_SELECTOR_INPUT_FIELDS = [
  "contextRef",
  "from",
  "to",
  "status",
  "roomName",
  "useSelectedMeetingReportCandidate"
];
const START_MEETING_INPUT_FIELDS = [
  "roomName",
  "useSelectedMeetingRoomCandidate",
  "recordingConsent"
];
const JOIN_MEETING_INPUT_FIELDS = [
  ...MEETING_SELECTOR_INPUT_FIELDS,
  "recordingConsent"
];
const SEARCH_TRANSCRIPT_INPUT_FIELDS = ["query", "reportId"];
const ACTION_ITEM_INPUT_FIELDS = ["reportId", "actionItemId"];
const UPDATE_ACTION_ITEM_INPUT_FIELDS = [
  "actionItemContextRef",
  "reportContextRef",
  "ordinal",
  "title",
  "description",
  "priority",
  "assigneeUserId",
  "assigneeDisplayName",
  "useSelectedMeetingActionItemCandidate",
  "useSelectedWorkspaceMemberCandidate"
];
const LEGACY_UPDATE_ACTION_ITEM_INPUT_FIELDS = [
  ...ACTION_ITEM_INPUT_FIELDS,
  "title",
  "description",
  "priority",
  "assigneeUserId",
  "useSelectedWorkspaceMemberCandidate"
];
const ACTION_ITEM_CONTEXT_INPUT_FIELDS = [
  "actionItemContextRef",
  "reportContextRef",
  "ordinal",
  "useSelectedMeetingActionItemCandidate"
];
const APPROVE_ACTION_ITEM_INPUT_FIELDS = [
  ...ACTION_ITEM_CONTEXT_INPUT_FIELDS,
  "delivery"
];
const LEGACY_APPROVE_ACTION_ITEM_INPUT_FIELDS = [
  ...ACTION_ITEM_INPUT_FIELDS,
  "delivery"
];
const DECISION_EVIDENCE_SELECTOR_INPUT_FIELDS = [
  ...REPORT_SELECTOR_INPUT_FIELDS,
  "decisionIndex"
];
const LEGACY_DECISION_EVIDENCE_INPUT_FIELDS = ["reportId", "decisionIndex"];
const RESOLVE_RESOURCE_INPUT_FIELDS = [
  "resourceType",
  "roomName",
  "displayName",
  "self",
  "useLatestCandidate"
];
const FORBIDDEN_MEETING_TOOL_FIELDS = [
  "workspaceId",
  "userId",
  "currentUserId",
  "requestedByUserId"
];
const LIST_SECTION_TEXT_LIMIT = 400;
const DETAIL_SECTION_TEXT_LIMIT = 4000;
const MAX_ACTION_ITEMS = 10;
const ACTION_ITEM_TEXT_LIMIT = 500;
const MAX_MEETING_ROOMS = 100;
const MAX_MEETING_PARTICIPANTS = 100;

@Injectable()
export class MeetingAgentToolsService {
  constructor(
    private readonly meetingService: MeetingService,
    private readonly meetingTranscriptRagService: MeetingTranscriptRagService,
    private readonly meetingActionItemDeliveryService: MeetingActionItemDeliveryService,
    private readonly meetingAgentResourceResolver?: MeetingAgentResourceResolver,
    private readonly agentCandidateSelectionService?: AgentCandidateSelectionService
  ) {}

  listDefinitions(): AgentToolDefinition<unknown>[] {
    return [
      this.listMeetingRoomsDefinition(),
      this.resolveMeetingResourceDefinition(),
      this.getActiveMeetingDefinition(),
      this.getMeetingParticipantsDefinition(),
      this.startMeetingDefinition(),
      this.joinMeetingDefinition(),
      this.leaveMeetingDefinition(),
      this.startMeetingRecordingDefinition(),
      this.endMeetingRecordingDefinition(),
      this.listMeetingReportsDefinition(),
      this.getMeetingReportDefinition(),
      this.summarizeMeetingReportDefinition(),
      this.searchMeetingTranscriptDefinition(),
      this.findActionItemsDefinition(),
      this.getMeetingDecisionEvidenceDefinition(),
      this.updateActionItemDefinition(),
      this.dismissActionItemDefinition(),
      this.approveActionItemDefinition(),
      this.regenerateMeetingReportDefinition()
    ];
  }

  private resolveMeetingResourceDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "resolve_meeting_resource",
      description:
        "Meeting 회의방 또는 Workspace 구성원을 이름/self selector로 안전하게 해소합니다. 복수 후보는 사용자가 선택할 후보 버튼으로 반환합니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        required: ["resourceType"],
        additionalProperties: false,
        properties: {
          resourceType: { type: "string", enum: ["meeting_room", "workspace_member"] },
          roomName: { type: "string", minLength: 1, maxLength: 100 },
          displayName: { type: "string", minLength: 1, maxLength: 120 },
          self: { type: "boolean", const: true },
          useLatestCandidate: { type: "boolean", const: true }
        }
      },
      validateInput: (input) => this.validateResolveMeetingResourceInput(input),
      prepareExecution: async (context, input) => {
        const resolved = await this.resolveMeetingResource(
          context,
          this.validateResolveMeetingResourceInput(input)
        );
        return resolved.kind === "selected"
          ? { kind: "execute" }
          : this.toResourceClarification(context, resolved);
      },
      execute: async (context, input) => {
        const resolved = await this.resolveMeetingResource(
          context,
          this.validateResolveMeetingResourceInput(input)
        );
        if (resolved.kind !== "selected") {
          throw badRequest("Meeting resource requires a candidate selection");
        }
        return {
          outputSummary: {
            resourceType: resolved.reference.resourceType,
            label: resolved.candidate.label,
            description: resolved.candidate.description,
            status: resolved.candidate.status
          },
          resourceRefs: [this.toResolvedResourceRef(resolved.reference, resolved.candidate.label)],
          status: "completed"
        };
      }
    };
  }

  private startMeetingDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "start_meeting_in_room",
      description:
        "선택한 MeetingRoom에서 회의를 시작합니다. recordingConsent는 사용자가 현재 정책에 명시적으로 동의한 경우에만 전달합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: {
        type: "object",
        anyOf: [
          { required: ["roomName"] },
          { required: ["useSelectedMeetingRoomCandidate"] }
        ],
        additionalProperties: false,
        properties: {
          roomName: { type: "string", minLength: 1, maxLength: 100 },
          useSelectedMeetingRoomCandidate: { type: "boolean", const: true },
          recordingConsent: this.recordingConsentSchema()
        }
      },
      validateInput: (input) => this.validateStartMeetingInput(input),
      buildConfirmation: async (context, input) => {
        const resolved = await this.resolveStartMeetingInput(
          context,
          this.validateStartMeetingInput(input)
        );
        return "kind" in resolved
          ? resolved
          : this.buildStartMeetingConfirmation(context, resolved);
      },
      buildConfirmationInput: (plan) => this.confirmationPlanInput(plan),
      validateConfirmationInput: (input) =>
        this.validateResolvedStartMeetingInput(input),
      execute: async (context, input) =>
        this.executeStartMeeting(
          context,
          this.validateResolvedStartMeetingInput(input)
        )
    };
  }

  private joinMeetingDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "join_meeting",
      description:
        "진행 중인 Meeting에 참여하거나 재입장합니다. LiveKit token은 저장하지 않고 connect_meeting client action만 반환합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...this.meetingSelectorSchema(),
          recordingConsent: this.recordingConsentSchema()
        }
      },
      validateInput: (input) => this.validateJoinMeetingInput(input),
      buildConfirmation: async (context, input) => {
        const resolved = await this.resolveJoinMeetingInput(
          context,
          this.validateJoinMeetingInput(input)
        );
        return "kind" in resolved
          ? resolved
          : this.buildJoinMeetingConfirmation(context, resolved);
      },
      buildConfirmationInput: (plan) => this.confirmationPlanInput(plan),
      validateConfirmationInput: (input) =>
        this.validateResolvedJoinMeetingInput(input),
      execute: (context, input) =>
        this.executeJoinMeeting(
          context,
          this.validateResolvedJoinMeetingInput(input)
        )
    };
  }

  private leaveMeetingDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "leave_meeting",
      description:
        "현재 참여 중인 Meeting에서 나갑니다. 마지막 참여자면 기존 Meeting 규칙에 따라 녹음·회의가 종료될 수 있습니다.",
      riskLevel: "low",
      executionMode: "contextual",
      inputSchema: this.meetingSelectorInputSchema(),
      validateInput: (input) => this.validateMeetingSelectorInput(input),
      prepareExecution: async (context, input) =>
        this.prepareMeetingSelectorExecution(
          context,
          this.validateMeetingSelectorInput(input)
        ),
      execute: async (context, input) => {
        const resolved = await this.requireResolvedMeeting(
          context,
          this.validateMeetingSelectorInput(input)
        );
        return this.executeLeaveMeeting(context, { meetingId: resolved.resourceId });
      }
    };
  }

  private startMeetingRecordingDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "start_meeting_recording",
      description:
        "현재 active participant인 Meeting의 녹음을 시작합니다. 모든 active participant의 동의를 서버가 재검증합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: this.meetingSelectorInputSchema(),
      validateInput: (input) => this.validateMeetingSelectorInput(input),
      buildConfirmation: async (context, input) => {
        const resolved = await this.resolveMeetingIdInput(
          context,
          this.validateMeetingSelectorInput(input)
        );
        return "kind" in resolved
          ? resolved
          : this.buildRecordingConfirmation(
              context,
              "start_meeting_recording",
              resolved
            );
      },
      buildConfirmationInput: (plan) => this.confirmationPlanInput(plan),
      validateConfirmationInput: (input) => this.validateMeetingIdInput(input),
      execute: (context, input) =>
        this.executeStartRecording(context, this.validateMeetingIdInput(input))
    };
  }

  private endMeetingRecordingDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "end_meeting_recording",
      description:
        "Meeting의 current recording을 종료하고 조건을 충족하면 MeetingReport 생성을 요청합니다. recordingId를 입력받지 않습니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: this.meetingSelectorInputSchema(),
      validateInput: (input) => this.validateMeetingSelectorInput(input),
      buildConfirmation: async (context, input) => {
        const resolved = await this.resolveMeetingIdInput(
          context,
          this.validateMeetingSelectorInput(input)
        );
        return "kind" in resolved
          ? resolved
          : this.buildRecordingConfirmation(
              context,
              "end_meeting_recording",
              resolved
            );
      },
      buildConfirmationInput: (plan) => this.confirmationPlanInput(plan),
      validateConfirmationInput: (input) => this.validateMeetingIdInput(input),
      execute: (context, input) =>
        this.executeEndRecording(context, this.validateMeetingIdInput(input))
    };
  }

  private findActionItemsDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "find_action_items",
      description: "특정 MeetingReport에 저장된 후속작업의 상태와 담당자를 조회합니다.",
      riskLevel: "low",
      executionMode: "contextual",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: this.meetingReportSelectorSchema()
      },
      validateInput: (input) => this.validateMeetingReportSelectorInput(input),
      adaptLegacyPlannerInput: (input) =>
        this.adaptLegacyReportReferenceInput(input),
      prepareExecution: async (context, input) =>
        this.prepareMeetingReportSelectorExecution(
          context,
          this.validateMeetingReportSelectorInput(input)
        ),
      execute: async (context, input) => {
        if (this.isLegacyPersistedReportReferenceInput(input)) {
          return this.executeFindActionItems(context, {
            reportId: input.reportId
          });
        }
        const resolved = await this.requireResolvedReport(
          context,
          this.validateMeetingReportSelectorInput(input)
        );
        return this.executeFindActionItems(context, {
          reportId: resolved.resourceId
        });
      }
    };
  }

  private getMeetingDecisionEvidenceDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "get_meeting_decision_evidence",
      description: "MeetingReport 결정사항에 직접 연결된 transcript와 Activity evidence만 조회합니다.",
      riskLevel: "low",
      executionMode: "contextual",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...this.meetingReportSelectorSchema(),
          decisionIndex: { type: "integer", minimum: 0 }
        }
      },
      validateInput: (input) => this.validateDecisionEvidenceSelectorInput(input),
      adaptLegacyPlannerInput: (input) =>
        this.adaptLegacyDecisionEvidenceInput(input),
      prepareExecution: async (context, input) =>
        this.prepareMeetingReportSelectorExecution(
          context,
          this.validateDecisionEvidenceSelectorInput(input)
        ),
      execute: async (context, input) => {
        if (this.isLegacyPersistedDecisionEvidenceInput(input)) {
          return this.executeDecisionEvidence(context, input);
        }
        const draft = this.validateDecisionEvidenceSelectorInput(input);
        const resolved = await this.requireResolvedReport(context, draft);
        return this.executeDecisionEvidence(context, {
          reportId: resolved.resourceId,
          ...(draft.decisionIndex === undefined
            ? {}
            : { decisionIndex: draft.decisionIndex })
        });
      }
    };
  }

  private updateActionItemDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "update_meeting_report_action_item",
      description: "저장된 회의 후속작업의 제목, 설명, 우선순위, 담당자를 수정합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: { type: "object", additionalProperties: false, properties: { ...this.actionItemContextSchema(), title: { type: "string" }, description: { type: "string" }, priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] }, assigneeUserId: { type: ["string", "null"], format: "uuid" }, assigneeDisplayName: { type: "string", minLength: 1, maxLength: 120 }, useSelectedWorkspaceMemberCandidate: { type: "boolean", const: true } } },
      validateInput: (input) => this.validateUpdateActionItemContextInput(input),
      buildConfirmation: async (context, input) =>
        this.buildUpdateActionItemContextConfirmation(
          context,
          input
        ),
      buildConfirmationInput: (plan) => this.confirmationPlanInput(plan),
      validateConfirmationInput: (input) => this.validateUpdateActionItemInput(input),
      execute: async (context, input) =>
        this.executeUpdateActionItem(
          context,
          await this.resolveSelectedWorkspaceMember(
            context,
            this.validateUpdateActionItemInput(input)
          )
        )
    };
  }

  private dismissActionItemDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "dismiss_meeting_report_action_item",
      description: "저장된 회의 후속작업을 반려합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: { type: "object", additionalProperties: false, properties: this.actionItemContextSchema() },
      validateInput: (input) => this.validateActionItemContextInput(input),
      buildConfirmation: async (context, input) => this.buildActionItemContextConfirmation(context, "dismiss_meeting_report_action_item", input),
      buildConfirmationInput: (plan) => this.confirmationPlanInput(plan),
      validateConfirmationInput: (input) => this.validateActionItemInput(input),
      execute: (context, input) => this.executeDismissActionItem(context, this.validateActionItemInput(input))
    };
  }

  private approveActionItemDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "approve_meeting_report_action_item",
      description: "회의 후속작업을 승인하고 선택한 하나의 Calendar 일정 또는 Board issue를 생성합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: { type: "object", required: ["delivery"], additionalProperties: false, properties: { ...this.actionItemContextSchema(), delivery: { type: "object" } } },
      validateInput: (input) => this.validateApproveActionItemContextInput(input),
      buildConfirmation: async (context, input) => this.buildApproveActionItemContextConfirmation(context, input),
      buildConfirmationInput: (plan) => this.confirmationPlanInput(plan),
      validateConfirmationInput: (input) => this.validateApproveActionItemInput(input),
      execute: (context, input) => this.executeApproveActionItem(context, this.validateApproveActionItemInput(input))
    };
  }

  private regenerateMeetingReportDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "regenerate_meeting_report",
      description: "원본 audio가 남아 있는 실패 MeetingReport의 재생성을 요청합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: this.meetingReportSelectorSchema()
      },
      validateInput: (input) => this.validateMeetingReportSelectorInput(input),
      adaptLegacyPlannerInput: (input) =>
        this.adaptLegacyReportReferenceInput(input),
      buildConfirmation: async (context, input) => {
        if (this.isLegacyPersistedReportReferenceInput(input)) {
          return this.buildRegenerateConfirmation(context, {
            reportId: input.reportId
          });
        }
        return this.buildRegenerateContextConfirmation(
          context,
          this.validateMeetingReportSelectorInput(input)
        );
      },
      buildConfirmationInput: (plan) => this.confirmationPlanInput(plan),
      validateConfirmationInput: (input) => this.validateReportIdInput(input),
      execute: (context, input) =>
        this.executeRegenerateMeetingReport(
          context,
          this.validateReportIdInput(input)
        )
    };
  }

  private listMeetingRoomsDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "list_meeting_rooms",
      description:
        "Workspace 회의방 목록과 각 방의 현재 회의·녹음 상태를 조회합니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {}
      },
      validateInput: (input) => this.validateEmptyInput(input, "Meeting room list input"),
      execute: (context) => this.executeListMeetingRooms(context)
    };
  }

  private getActiveMeetingDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "get_active_meeting",
      description:
        "현재 사용자가 참여 중인 active Meeting과 회의방, 시작 후 경과 시간을 조회합니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {}
      },
      validateInput: (input) => this.validateEmptyInput(input, "Active meeting input"),
      execute: (context) => this.executeGetActiveMeeting(context)
    };
  }

  private getMeetingParticipantsDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "get_meeting_participants",
      description:
        "특정 Meeting의 현재·과거 참여자 요약을 조회합니다. LiveKit 연결 상태는 반환하지 않습니다.",
      riskLevel: "low",
      executionMode: "contextual",
      inputSchema: this.meetingSelectorInputSchema(),
      validateInput: (input) => this.validateMeetingSelectorInput(input),
      prepareExecution: async (context, input) =>
        this.prepareMeetingSelectorExecution(
          context,
          this.validateMeetingSelectorInput(input)
        ),
      execute: async (context, input) => {
        const resolved = await this.requireResolvedMeeting(
          context,
          this.validateMeetingSelectorInput(input)
        );
        return this.executeGetMeetingParticipants(context, {
          meetingId: resolved.resourceId
        });
      }
    };
  }

  private searchMeetingTranscriptDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "search_meeting_transcript",
      description: "권한이 있는 MeetingReport의 발언 transcript와 안전한 실제 사용자 활동 evidence에서 질문과 의미적으로 관련된 근거를 검색하고, 출처 유형을 구분한 근거 기반 답변을 생성합니다.",
      riskLevel: "low",
      executionMode: "auto",
      requiresGroundedAnswer: true,
      inputSchema: { type: "object", required: ["query"], additionalProperties: false, properties: { query: { type: "string", minLength: 1, maxLength: 1000 }, reportId: { type: "string", format: "uuid" } } },
      validateInput: (input) => this.validateSearchTranscriptInput(input),
      execute: async (context, input) => {
        const sources = await this.meetingTranscriptRagService.search(context.currentUserId, context.workspaceId, this.validateSearchTranscriptInput(input));
        return { outputSummary: { status: "grounding_queued", sourceCount: sources.length, sourceIds: sources.map((source) => source.sourceId) }, resourceRefs: sources.map((source) => ({ domain: "meeting", resourceType: "meeting_report", resourceId: source.reportId })), status: "grounding_queued" };
      }
    };
  }

  private listMeetingReportsDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "list_meeting_reports",
      description:
        "Workspace MeetingReport 목록을 createdAt 내림차순으로 조회합니다. 기간과 개수를 생략하면 최신 회의록 1개를 반환합니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: {
            type: "string",
            enum: [...MEETING_REPORT_STATUSES]
          },
          from: { type: "string", format: "date-time" },
          to: { type: "string", format: "date-time" },
          roomName: { type: "string", minLength: 1, maxLength: 100 },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100
          }
        }
      },
      validateInput: (input) => this.validateListInput(input),
      execute: (context, input) =>
        this.executeListMeetingReports(context, this.validateListInput(input))
    };
  }

  private getMeetingReportDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "get_meeting_report",
      description: "MeetingReport 상세를 Agent용 보고서 projection으로 조회합니다.",
      riskLevel: "low",
      executionMode: "contextual",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: this.meetingReportSelectorSchema()
      },
      validateInput: (input) => this.validateMeetingReportSelectorInput(input),
      adaptLegacyPlannerInput: (input) => this.adaptLegacyReportReferenceInput(input),
      prepareExecution: async (context, input) =>
        this.prepareMeetingReportSelectorExecution(
          context,
          this.validateMeetingReportSelectorInput(input)
        ),
      execute: async (context, input) => {
        if (this.isLegacyPersistedReportReferenceInput(input)) {
          return this.executeGetMeetingReport(context, {
            reportId: input.reportId
          });
        }
        const resolved = await this.requireResolvedReport(
          context,
          this.validateMeetingReportSelectorInput(input)
        );
        return this.executeGetMeetingReport(context, {
          reportId: resolved.resourceId
        });
      }
    };
  }

  private summarizeMeetingReportDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "summarize_meeting_report",
      description:
        "MeetingReport를 Agent가 소비할 수 있는 sections/actionItems projection으로 요약합니다.",
      riskLevel: "low",
      executionMode: "contextual",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: this.meetingReportSelectorSchema()
      },
      validateInput: (input) => this.validateMeetingReportSelectorInput(input),
      adaptLegacyPlannerInput: (input) => this.adaptLegacyReportReferenceInput(input),
      prepareExecution: async (context, input) =>
        this.prepareMeetingReportSelectorExecution(
          context,
          this.validateMeetingReportSelectorInput(input)
        ),
      execute: async (context, input) => {
        if (this.isLegacyPersistedReportReferenceInput(input)) {
          return this.executeSummarizeMeetingReport(context, {
            reportId: input.reportId
          });
        }
        const resolved = await this.requireResolvedReport(
          context,
          this.validateMeetingReportSelectorInput(input)
        );
        return this.executeSummarizeMeetingReport(context, {
          reportId: resolved.resourceId
        });
      }
    };
  }

  private async executeListMeetingReports(
    context: AgentToolContext,
    input: ListMeetingReportsInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingService.listReportsForAgent(
      context.currentUserId,
      context.workspaceId,
      input
    );
    const selectedReports = result.reports.slice(0, input.limit);
    const reports = selectedReports.map((report) =>
      this.normalizeMeetingReportForAgent(report, {
        sectionTextLimit: LIST_SECTION_TEXT_LIMIT
      })
    );

    return {
      outputSummary: {
        count: reports.length,
        reports
      },
      resourceRefs: selectedReports.map((report) => this.toResourceRef(report)),
      status: "completed"
    };
  }

  private async executeFindActionItems(
    context: AgentToolContext,
    input: ReportIdInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingService.getReport(
      context.currentUserId,
      context.workspaceId,
      input.reportId
    );
    const actionItems = result.report.actionItems.map((item) => ({
      actionItemId: item.id,
      sourceIndex: item.sourceIndex,
      title: this.boundText(item.title, ACTION_ITEM_TEXT_LIMIT),
      description: this.boundText(item.description, ACTION_ITEM_TEXT_LIMIT),
      priority: item.priority,
      status: item.status,
      assigneeUserId: item.assignee?.userId ?? null,
      assigneeName: item.assignee?.name ?? null
    }));
    return {
      outputSummary: { reportId: input.reportId, count: actionItems.length, actionItems },
      resourceRefs: [
        this.toResourceRef(result.report),
        ...actionItems.map((item) => ({
          domain: "meeting",
          resourceType: "meeting_report_action_item",
          resourceId: item.actionItemId,
          label: item.title ?? undefined,
          status: item.status,
          metadata: { reportId: input.reportId }
        }))
      ],
      status: "completed"
    };
  }

  private async executeDecisionEvidence(
    context: AgentToolContext,
    input: DecisionEvidenceInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingService.getReport(
      context.currentUserId,
      context.workspaceId,
      input.reportId
    );
    const decisionIndex = input.decisionIndex ?? 0;
    const decision = await this.meetingService.getMeetingReportDecisionItem(
      context.currentUserId,
      context.workspaceId,
      input.reportId,
      decisionIndex
    );
    const segmentIds = new Set(
      result.report.evidence
        .filter((reference) => reference.sourceType === "decision" && reference.sourceIndex === decisionIndex)
        .map((reference) => reference.transcriptSegmentId)
    );
    const transcriptEvidence = result.report.evidenceSegments
      .filter((segment) => segmentIds.has(segment.id))
      .map((segment) => ({
        segmentIndex: segment.segmentIndex,
        startedAtMs: segment.startedAtMs,
        endedAtMs: segment.endedAtMs,
        text: this.boundText(segment.text, DETAIL_SECTION_TEXT_LIMIT)
      }));
    const activityEvidence = result.report.activityEvidence
      .filter((item) => item.references.some((reference) => reference.sourceType === "decision" && reference.sourceIndex === decisionIndex))
      .map((item) => ({
        occurredAt: item.occurredAt,
        action: item.action,
        summary: item.summary
      }));
    return {
      outputSummary: {
        reportId: input.reportId,
        decisionIndex,
        decision: decision
          ? this.boundText(decision.text, DETAIL_SECTION_TEXT_LIMIT)
          : null,
        transcriptEvidence,
        activityEvidence
      },
      resourceRefs: [{ domain: "meeting", resourceType: "meeting_report", resourceId: input.reportId }],
      status: "completed"
    };
  }

  private async executeUpdateActionItem(
    context: AgentToolContext,
    input: UpdateActionItemInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingService.updateMeetingReportActionItem(
      context.currentUserId,
      context.workspaceId,
      input.reportId,
      input.actionItemId,
      this.actionItemPatch(input)
    );
    return this.actionItemExecutionResult(result.actionItem, input.reportId, "updated");
  }

  private async executeDismissActionItem(
    context: AgentToolContext,
    input: ActionItemInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingService.dismissMeetingReportActionItem(
      context.currentUserId,
      context.workspaceId,
      input.reportId,
      input.actionItemId
    );
    return this.actionItemExecutionResult(result.actionItem, input.reportId, "dismissed");
  }

  private async executeApproveActionItem(
    context: AgentToolContext,
    input: ApproveActionItemInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingActionItemDeliveryService.deliver(
      context.currentUserId,
      context.workspaceId,
      input.reportId,
      input.actionItemId,
      input.delivery
    );
    const resourceRefs: AgentResourceRef[] = [{
      domain: "meeting",
      resourceType: "meeting_report_action_item",
      resourceId: input.actionItemId,
      status: result.status,
      metadata: { reportId: input.reportId }
    }];
    if (result.calendarEventId !== undefined) {
      resourceRefs.push({ domain: "calendar", resourceType: "event", resourceId: String(result.calendarEventId), status: "created" });
    }
    if (result.piloIssueId !== undefined) {
      resourceRefs.push({ domain: "board", resourceType: "issue", resourceId: result.piloIssueId, status: "created" });
    }
    return {
      outputSummary: {
        actionItemId: result.actionItemId,
        deliveryType: result.deliveryType,
        deliveryStatus: result.status,
        badge: result.deliveryType === "calendar_event" ? "일정" : "이슈",
        ...(result.errorCode ? { errorCode: result.errorCode } : {})
      },
      resourceRefs,
      status: result.status === "COMPLETED" ? "completed" : "delivery_failed"
    };
  }

  private async executeRegenerateMeetingReport(
    context: AgentToolContext,
    input: ReportIdInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingService.requestReportRegeneration(
      context.currentUserId,
      context.workspaceId,
      input.reportId
    );
    return {
      outputSummary: { reportId: result.report.id, status: result.report.status, action: "regeneration_requested" },
      resourceRefs: [this.toResourceRef(result.report)],
      status: "queued"
    };
  }

  private async buildActionItemConfirmation(
    context: AgentToolContext,
    toolName: string,
    input: ActionItemInput | UpdateActionItemInput | ApproveActionItemInput
  ): Promise<AgentConfirmationPlan> {
    const report = await this.meetingService.getReport(context.currentUserId, context.workspaceId, input.reportId);
    const actionItem = report.report.actionItems.find((item) => item.id === input.actionItemId);
    if (!actionItem) throw badRequest("Meeting report action item not found");

    const isApproval = toolName === "approve_meeting_report_action_item";
    const delivery = isApproval ? (input as ApproveActionItemInput).delivery : undefined;
    const after: AgentJsonObject = isApproval
      ? { deliveryType: delivery!.deliveryType, badge: delivery!.deliveryType === "calendar_event" ? "일정" : "이슈" }
      : toolName === "dismiss_meeting_report_action_item"
        ? { status: "DISMISSED" }
        : this.actionItemPatch(input as UpdateActionItemInput);
    return {
      toolName,
      summary: isApproval
        ? `${actionItem.title} 후속작업을 승인하고 ${after.badge as string} 하나를 생성합니다.`
        : toolName === "dismiss_meeting_report_action_item"
          ? `${actionItem.title} 후속작업을 반려합니다.`
          : `${actionItem.title} 후속작업을 수정합니다.`,
      target: { domain: "meeting", resourceType: "meeting_report_action_item", resourceId: actionItem.id },
      before: { title: actionItem.title, description: actionItem.description, priority: actionItem.priority, assigneeUserId: actionItem.assignee?.userId ?? null, status: actionItem.status },
      after,
      call: { input: input as unknown as AgentJsonObject }
    };
  }

  private async buildUpdateActionItemContextConfirmation(
    context: AgentToolContext,
    input: unknown
  ): Promise<AgentConfirmationPlan | AgentToolClarificationResult> {
    const draft = this.validateUpdateActionItemContextInput(input);
    const resolved = await this.resolveActionItemContextReference(context, draft);
    if (resolved.kind === "needs_clarification") {
      return this.toResourceClarification(context, resolved);
    }
    const assignee = await this.resolveActionItemAssignee(context, draft);
    if ("kind" in assignee) {
      return assignee;
    }
    const resolvedInput: UpdateActionItemInput = {
      reportId: resolved.reference.reportId!,
      actionItemId: resolved.reference.resourceId,
      ...this.actionItemPatch(draft),
      ...assignee
    };
    return this.buildActionItemConfirmation(
      context,
      "update_meeting_report_action_item",
      resolvedInput
    );
  }

  private async buildActionItemContextConfirmation(
    context: AgentToolContext,
    toolName: "dismiss_meeting_report_action_item",
    input: unknown
  ): Promise<AgentConfirmationPlan | AgentToolClarificationResult> {
    const resolved = await this.resolveActionItemContextReference(
      context,
      this.validateActionItemContextInput(input)
    );
    if (resolved.kind === "needs_clarification") {
      return this.toResourceClarification(context, resolved);
    }
    return this.buildActionItemConfirmation(context, toolName, {
      reportId: resolved.reference.reportId!,
      actionItemId: resolved.reference.resourceId
    });
  }

  private async buildApproveActionItemContextConfirmation(
    context: AgentToolContext,
    input: unknown
  ): Promise<AgentConfirmationPlan | AgentToolClarificationResult> {
    const draft = this.validateApproveActionItemContextInput(input);
    const resolved = await this.resolveActionItemContextReference(context, draft);
    if (resolved.kind === "needs_clarification") {
      return this.toResourceClarification(context, resolved);
    }
    return this.buildActionItemConfirmation(
      context,
      "approve_meeting_report_action_item",
      {
        reportId: resolved.reference.reportId!,
        actionItemId: resolved.reference.resourceId,
        delivery: draft.delivery
      }
    );
  }

  private async resolveActionItemContextReference(
    context: AgentToolContext,
    input: ActionItemContextInput
  ): Promise<MeetingAgentResourceResolution> {
    const resolver = this.requireMeetingResourceResolver();
    if (input.useSelectedMeetingActionItemCandidate) {
      return this.resolveLatestCandidateReference(
        context,
        "meeting_report_action_item"
      );
    }
    if (input.actionItemContextRef) {
      return resolver.resolveContextReference(
        context,
        input.actionItemContextRef,
        "meeting_report_action_item"
      );
    }
    const report = await resolver.resolveContextReference(
      context,
      input.reportContextRef!,
      "meeting_report"
    );
    if (report.kind === "needs_clarification") return report;
    return resolver.resolveActionItem(context, {
      reportId: report.reference.resourceId,
      ordinal: input.ordinal
    });
  }

  private async resolveActionItemAssignee(
    context: AgentToolContext,
    input: UpdateActionItemContextInput
  ): Promise<
    | { assigneeUserId?: string | null }
    | AgentToolClarificationResult
  > {
    if (input.assigneeUserId !== undefined) {
      return { assigneeUserId: input.assigneeUserId };
    }
    if (input.useSelectedWorkspaceMemberCandidate) {
      const reference = await this.resolveLatestCandidateReference(
        context,
        "workspace_member"
      );
      if (reference.kind === "needs_clarification") {
        return this.toResourceClarification(context, reference);
      }
      return { assigneeUserId: reference.reference.resourceId };
    }
    if (input.assigneeDisplayName) {
      const reference = await this.requireMeetingResourceResolver().resolveMember(
        context,
        { displayName: input.assigneeDisplayName }
      );
      if (reference.kind === "needs_clarification") {
        return this.toResourceClarification(context, reference);
      }
      return { assigneeUserId: reference.reference.resourceId };
    }
    return {};
  }

  private async buildRegenerateConfirmation(
    context: AgentToolContext,
    input: ReportIdInput
  ): Promise<AgentConfirmationPlan> {
    const result = await this.meetingService.getReport(context.currentUserId, context.workspaceId, input.reportId);
    return {
      toolName: "regenerate_meeting_report",
      summary: "실패한 회의록의 재생성을 요청합니다.",
      target: { domain: "meeting", resourceType: "meeting_report", resourceId: input.reportId },
      before: { status: result.report.status },
      after: { status: "QUEUED" },
      call: { input: input as unknown as AgentJsonObject }
    };
  }

  private async buildRegenerateContextConfirmation(
    context: AgentToolContext,
    input: MeetingReportSelectorInput
  ): Promise<AgentConfirmationPlan | AgentToolClarificationResult> {
    const resolved = await this.resolveMeetingReportSelector(context, input);
    if (resolved.kind === "needs_clarification") {
      return this.toResourceClarification(context, resolved);
    }
    return this.buildRegenerateConfirmation(context, {
      reportId: resolved.reference.resourceId
    });
  }

  private async buildStartMeetingConfirmation(
    context: AgentToolContext,
    input: ResolvedStartMeetingInput
  ): Promise<AgentConfirmationPlan | AgentToolClarificationResult> {
    const rooms = await this.meetingService.listMeetingRooms(
      context.currentUserId,
      context.workspaceId
    );
    const room = rooms.rooms.find((candidate) => candidate.id === input.meetingRoomId);
    if (!room) throw badRequest("Meeting room not found");
    const current = await this.meetingService.getCurrentMeetingForRoom(
      context.currentUserId,
      context.workspaceId,
      room.id
    );
    if (current.meeting) {
      throw badRequest("Meeting room already has an active meeting");
    }
    const consent = await this.requireMeetingConsent(context, input.recordingConsent, [
      this.toMeetingRoomResourceRef(room)
    ]);
    if (consent) return consent;
    const active = await this.meetingService.getCurrentUserActiveMeeting(
      context.currentUserId
    );
    return {
      toolName: "start_meeting_in_room",
      summary: active.meeting
        ? `현재 회의에서 나간 뒤 ${room.name}에서 새 회의를 시작합니다.`
        : `${room.name}에서 새 회의를 시작합니다.`,
      target: {
        domain: "meeting",
        resourceType: "meeting_room",
        resourceId: room.id
      },
      before: {
        activeMeetingId: active.meeting?.id ?? null,
        activeMeetingRoomName: active.meetingRoom?.name ?? null
      },
      after: { meetingStatus: "active", clientAction: "connect_meeting" },
      call: { input: input as unknown as AgentJsonObject }
    };
  }

  private async buildJoinMeetingConfirmation(
    context: AgentToolContext,
    input: ResolvedJoinMeetingInput
  ): Promise<AgentConfirmationPlan | AgentToolClarificationResult> {
    const detail = await this.meetingService.getMeeting(
      context.currentUserId,
      context.workspaceId,
      input.meetingId
    );
    const consent = await this.requireMeetingConsent(context, input.recordingConsent, [
      this.toMeetingResourceRef(detail.meeting)
    ]);
    if (consent) return consent;
    const active = await this.meetingService.getCurrentUserActiveMeeting(
      context.currentUserId
    );
    const switching = active.meeting && active.meeting.id !== input.meetingId;
    return {
      toolName: "join_meeting",
      summary: switching
        ? "현재 회의에서 나간 뒤 선택한 회의에 참여합니다."
        : "선택한 회의에 참여합니다.",
      target: {
        domain: "meeting",
        resourceType: "meeting",
        resourceId: input.meetingId
      },
      before: {
        activeMeetingId: active.meeting?.id ?? null,
        targetActiveParticipantCount: detail.activeParticipantCount
      },
      after: { participantStatus: "active", clientAction: "connect_meeting" },
      call: { input: input as unknown as AgentJsonObject }
    };
  }

  private async buildRecordingConfirmation(
    context: AgentToolContext,
    toolName: "start_meeting_recording" | "end_meeting_recording",
    input: MeetingIdInput
  ): Promise<AgentConfirmationPlan> {
    const detail = await this.meetingService.getMeeting(
      context.currentUserId,
      context.workspaceId,
      input.meetingId
    );
    if (toolName === "end_meeting_recording" && !detail.currentRecording) {
      throw badRequest("Meeting has no current recording");
    }
    return {
      toolName,
      summary:
        toolName === "start_meeting_recording"
          ? "선택한 회의의 녹음을 시작합니다."
          : "현재 녹음을 종료하고 조건을 충족하면 회의록 생성을 요청합니다.",
      target: {
        domain: "meeting",
        resourceType:
          toolName === "start_meeting_recording" ? "meeting" : "meeting_recording",
        resourceId: detail.currentRecording?.id ?? input.meetingId
      },
      before: {
        meetingId: input.meetingId,
        activeParticipantCount: detail.activeParticipantCount,
        currentRecordingId: detail.currentRecording?.id ?? null,
        currentRecordingStatus: detail.currentRecording?.status ?? null
      },
      after: {
        recordingStatus:
          toolName === "start_meeting_recording" ? "RUNNING" : "COMPLETED",
        reportGenerationRequested: toolName === "end_meeting_recording"
      },
      call: { input: input as unknown as AgentJsonObject }
    };
  }

  private async requireMeetingConsent(
    context: AgentToolContext,
    provided: RecordingConsentInput | undefined,
    resourceRefs: AgentResourceRef[]
  ): Promise<AgentToolClarificationResult | null> {
    if (provided) return null;
    const consent = await this.meetingService.getRecordingConsentStatus(
      context.currentUserId,
      context.workspaceId
    );
    if (consent.accepted) return null;
    return {
      kind: "needs_clarification",
      outputSummary: {
        selection: "recording_consent_required",
        policyVersion: consent.policyVersion,
        question: "이 Workspace의 음성 녹음 정책에 동의하시나요?"
      },
      resourceRefs
    };
  }

  private actionItemExecutionResult(
    item: { id: string; title: string; status: string },
    reportId: string,
    action: string
  ): AgentToolExecutionResult {
    return {
      outputSummary: { action, actionItemId: item.id, title: this.boundText(item.title, ACTION_ITEM_TEXT_LIMIT), status: item.status },
      resourceRefs: [{ domain: "meeting", resourceType: "meeting_report_action_item", resourceId: item.id, label: item.title, status: item.status, metadata: { reportId } }],
      status: action
    };
  }

  private async executeGetMeetingReport(
    context: AgentToolContext,
    input: ReportIdInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingService.getReport(
      context.currentUserId,
      context.workspaceId,
      input.reportId
    );
    const report = this.normalizeMeetingReportForAgent(result.report, {
      sectionTextLimit: DETAIL_SECTION_TEXT_LIMIT
    });

    return {
      outputSummary: {
        report
      },
      resourceRefs: [this.toResourceRef(result.report)],
      status: "completed"
    };
  }

  private async executeSummarizeMeetingReport(
    context: AgentToolContext,
    input: ReportIdInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingService.getReport(
      context.currentUserId,
      context.workspaceId,
      input.reportId
    );
    const report = this.normalizeMeetingReportForAgent(result.report, {
      sectionTextLimit: DETAIL_SECTION_TEXT_LIMIT
    });

    return {
      outputSummary: {
        report
      },
      resourceRefs: [this.toResourceRef(result.report)],
      status: "summarized"
    };
  }

  private async executeListMeetingRooms(
    context: AgentToolContext
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingService.listMeetingRooms(
      context.currentUserId,
      context.workspaceId
    );
    const selectedRooms = result.rooms.slice(0, MAX_MEETING_ROOMS);
    const rooms = await Promise.all(
      selectedRooms.map(async (room) => {
        const current = await this.meetingService.getCurrentMeetingForRoom(
          context.currentUserId,
          context.workspaceId,
          room.id
        );

        return this.normalizeMeetingRoom(room, current);
      })
    );

    return {
      outputSummary: {
        count: result.rooms.length,
        hasMore: result.rooms.length > selectedRooms.length,
        rooms
      },
      resourceRefs: selectedRooms.map((room) => this.toMeetingRoomResourceRef(room)),
      status: "completed"
    };
  }

  private async executeGetActiveMeeting(
    context: AgentToolContext
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingService.getCurrentUserActiveMeeting(
      context.currentUserId
    );

    if (result.meeting === null || result.meetingRoom === null) {
      return {
        outputSummary: {
          active: false,
          meeting: null,
          meetingRoom: null,
          durationSec: null
        },
        resourceRefs: [],
        status: "completed"
      };
    }

    return {
      outputSummary: {
        active: true,
        meeting: this.normalizeActiveMeeting(result.meeting),
        meetingRoom: this.normalizeMeetingRoomSummary(result.meetingRoom),
        durationSec: this.durationSec(result.meeting.startedAt)
      },
      resourceRefs: [
        this.toMeetingResourceRef(result.meeting),
        this.toMeetingRoomResourceRef(result.meetingRoom)
      ],
      status: "completed"
    };
  }

  private async executeGetMeetingParticipants(
    context: AgentToolContext,
    input: MeetingIdInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingService.listParticipants(
      context.currentUserId,
      context.workspaceId,
      input.meetingId
    );
    const selectedParticipants = result.participants.slice(
      0,
      MAX_MEETING_PARTICIPANTS
    );

    return {
      outputSummary: {
        meetingId: input.meetingId,
        count: result.participants.length,
        hasMore: result.participants.length > selectedParticipants.length,
        participants: selectedParticipants.map((participant) => ({
          userId: participant.userId,
          name: participant.user.name,
          avatarUrl: participant.user.avatarUrl,
          joinedAt: participant.joinedAt,
          leftAt: participant.leftAt,
          isActive: participant.isActive
        }))
      },
      resourceRefs: [
        {
          domain: "meeting",
          resourceType: "meeting",
          resourceId: input.meetingId
        }
      ],
      status: "completed"
    };
  }

  private async executeStartMeeting(
    context: AgentToolContext,
    input: ResolvedStartMeetingInput
  ): Promise<AgentToolExecutionResult> {
    const current = await this.meetingService.getCurrentMeetingForRoom(
      context.currentUserId,
      context.workspaceId,
      input.meetingRoomId
    );
    if (current.meeting) {
      throw badRequest("Meeting room already has an active meeting");
    }
    const active = await this.meetingService.getCurrentUserActiveMeeting(
      context.currentUserId
    );
    if (active.meeting) {
      await this.meetingService.leaveMeeting(
        context.currentUserId,
        active.meeting.workspaceId,
        active.meeting.id
      );
    }
    const result = await this.meetingService.startMeetingInRoom(
      context.currentUserId,
      context.workspaceId,
      input.meetingRoomId,
      input.recordingConsent ? { recordingConsent: input.recordingConsent } : {}
    );
    return this.meetingConnectionResult(result.meeting, input.meetingRoomId, "started");
  }

  private async executeJoinMeeting(
    context: AgentToolContext,
    input: ResolvedJoinMeetingInput
  ): Promise<AgentToolExecutionResult> {
    const active = await this.meetingService.getCurrentUserActiveMeeting(
      context.currentUserId
    );
    if (active.meeting && active.meeting.id !== input.meetingId) {
      await this.meetingService.leaveMeeting(
        context.currentUserId,
        active.meeting.workspaceId,
        active.meeting.id
      );
    }
    const result = await this.meetingService.joinMeeting(
      context.currentUserId,
      context.workspaceId,
      input.meetingId,
      input.recordingConsent ? { recordingConsent: input.recordingConsent } : {}
    );
    return this.meetingConnectionResult(result.meeting, null, "joined");
  }

  private async executeLeaveMeeting(
    context: AgentToolContext,
    input: MeetingIdInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingService.leaveMeeting(
      context.currentUserId,
      context.workspaceId,
      input.meetingId
    );
    return {
      outputSummary: {
        meetingId: result.meeting.id,
        meetingEnded: result.meetingEnded,
        recordingStillRunning: result.currentRecording !== null
      },
      resourceRefs: [this.toMeetingResourceRef(result.meeting)],
      status: "left"
    };
  }

  private async executeStartRecording(
    context: AgentToolContext,
    input: MeetingIdInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingService.startRecording(
      context.currentUserId,
      context.workspaceId,
      input.meetingId
    );
    return {
      outputSummary: {
        meetingId: result.meeting.id,
        recordingId: result.recording.id,
        recordingStatus: result.recording.status,
        startedAt: result.recording.startedAt
      },
      resourceRefs: [
        this.toMeetingResourceRef(result.meeting),
        {
          domain: "meeting",
          resourceType: "meeting_recording",
          resourceId: result.recording.id,
          status: result.recording.status
        }
      ],
      status: "recording_started"
    };
  }

  private async executeEndRecording(
    context: AgentToolContext,
    input: MeetingIdInput
  ): Promise<AgentToolExecutionResult> {
    const current = await this.meetingService.getCurrentRecording(
      context.currentUserId,
      context.workspaceId,
      input.meetingId
    );
    if (!current.recording) throw badRequest("Meeting has no current recording");
    const result = await this.meetingService.endRecordingAndCreateReport(
      context.currentUserId,
      context.workspaceId,
      input.meetingId,
      current.recording.id
    );
    const refs: AgentResourceRef[] = [
      this.toMeetingResourceRef(result.meeting),
      {
        domain: "meeting",
        resourceType: "meeting_recording",
        resourceId: result.recording.id,
        status: result.recording.status
      }
    ];
    if (result.report) refs.push(this.toResourceRef(result.report));
    return {
      outputSummary: {
        meetingId: result.meeting.id,
        recordingId: result.recording.id,
        recordingStatus: result.recording.status,
        reportId: result.report?.id ?? null,
        reportStatus: result.report?.status ?? null
      },
      resourceRefs: refs,
      status: "recording_ended"
    };
  }

  private meetingConnectionResult(
    meeting: MeetingPayload,
    meetingRoomId: string | null,
    status: "started" | "joined"
  ): AgentToolExecutionResult {
    return {
      outputSummary: {
        meetingId: meeting.id,
        status,
        clientAction: {
          type: "connect_meeting",
          meetingId: meeting.id,
          ...(meetingRoomId ? { meetingRoomId } : {}),
          expiresInSec: 20
        }
      },
      resourceRefs: [this.toMeetingResourceRef(meeting)],
      status
    };
  }

  private normalizeMeetingRoom(
    room: MeetingRoomPayload,
    current: Awaited<ReturnType<MeetingService["getCurrentMeetingForRoom"]>>
  ): AgentJsonObject {
    return {
      ...this.normalizeMeetingRoomSummary(room),
      currentMeeting:
        current.meeting === null
          ? null
          : {
              ...this.normalizeActiveMeeting(current.meeting),
              activeParticipantCount: current.activeParticipantCount,
              durationSec: this.durationSec(current.meeting.startedAt),
              recording:
                current.currentRecording === null
                  ? null
                  : {
                      status: current.currentRecording.status,
                      startedAt: current.currentRecording.startedAt
                    }
            }
    };
  }

  private normalizeMeetingRoomSummary(
    room: MeetingRoomPayload
  ): AgentJsonObject {
    return {
      roomId: room.id,
      name: room.name,
      isDefault: room.isDefault
    };
  }

  private normalizeActiveMeeting(meeting: MeetingPayload): AgentJsonObject {
    return {
      meetingId: meeting.id,
      startedAt: meeting.startedAt
    };
  }

  private durationSec(startedAt: string): number {
    const startedAtMs = Date.parse(startedAt);
    if (!Number.isFinite(startedAtMs)) {
      return 0;
    }

    return Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  }

  private normalizeMeetingReportForAgent(
    report: MeetingReportSummaryPayload | MeetingReportDetailPayload,
    options: ProjectionOptions
  ): AgentJsonObject {
    const projection: AgentJsonObject = {
      reportId: report.id,
      meetingId: report.meetingId,
      status: report.status,
      createdAt: report.createdAt,
      sections: this.buildSections(report, options),
      actionItems: this.buildActionItems(report.actionItemCandidates),
      transcript: this.buildTranscriptSummary(report)
    };

    if (report.status === "FAILED") {
      projection.failure = {
        failedStep: report.failedStep
      };
    }

    return projection;
  }

  private buildSections(
    report: MeetingReportSummaryPayload,
    options: ProjectionOptions
  ): AgentJsonValue[] {
    return [
      this.toSection("summary", "요약", report.summary, options),
      this.toSection("discussionPoints", "논의사항", report.discussionPoints, options),
      this.toSection("decisions", "결정사항", report.decisions, options)
    ].filter((section): section is AgentJsonObject => section !== null);
  }

  private toSection(
    key: string,
    title: string,
    text: string | null,
    options: ProjectionOptions
  ): AgentJsonObject | null {
    const boundedText = this.boundText(text, options.sectionTextLimit);
    if (boundedText === null) {
      return null;
    }

    return {
      key,
      title,
      text: boundedText
    };
  }

  private buildActionItems(actionItemCandidates: unknown[]): AgentJsonValue[] {
    return actionItemCandidates
      .slice(0, MAX_ACTION_ITEMS)
      .map((item) => this.normalizeActionItem(item))
      .filter((item): item is AgentJsonObject => item !== null);
  }

  private normalizeActionItem(item: unknown): AgentJsonObject | null {
    if (typeof item === "string") {
      const title = this.boundText(item, ACTION_ITEM_TEXT_LIMIT);
      return title === null ? null : { title };
    }

    if (!this.isPlainObject(item)) {
      return null;
    }

    const actionItem: AgentJsonObject = {};
    this.copyBoundedString(item, actionItem, "title");
    this.copyBoundedString(item, actionItem, "description");
    this.copyBoundedString(item, actionItem, "assigneeUserId");
    this.copyBoundedString(item, actionItem, "priority");

    return Object.keys(actionItem).length > 0 ? actionItem : null;
  }

  private buildTranscriptSummary(
    report: MeetingReportSummaryPayload | MeetingReportDetailPayload
  ): AgentJsonObject {
    if (!("transcriptText" in report)) {
      return {
        available: false,
        stored: false
      };
    }

    const transcriptText = report.transcriptText;
    const available =
      typeof transcriptText === "string" && transcriptText.trim().length > 0;

    return {
      available,
      stored: false,
      length: available ? transcriptText.length : 0
    };
  }

  private toResourceRef(report: MeetingReportSummaryPayload): AgentResourceRef {
    return {
      domain: "meeting",
      resourceType: "meeting_report",
      resourceId: report.id,
      status: report.status,
      metadata: {
        meetingId: report.meetingId
      }
    };
  }

  private toMeetingResourceRef(meeting: MeetingPayload): AgentResourceRef {
    return {
      domain: "meeting",
      resourceType: "meeting",
      resourceId: meeting.id,
      metadata: {
        startedAt: meeting.startedAt
      }
    };
  }

  private toMeetingRoomResourceRef(room: MeetingRoomPayload): AgentResourceRef {
    return {
      domain: "meeting",
      resourceType: "meeting_room",
      resourceId: room.id,
      label: room.name
    };
  }

  private validateEmptyInput(input: unknown, label: string): Record<never, never> {
    const draft = input ?? {};
    const object = this.requirePlainObject(draft, label);
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(object, [], label);
    return {};
  }

  private validateResolveMeetingResourceInput(
    input: unknown
  ): ResolveMeetingResourceInput {
    const object = this.requirePlainObject(input, "Meeting resource selector input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(
      object,
      RESOLVE_RESOURCE_INPUT_FIELDS,
      "Meeting resource selector input"
    );
    if (object.resourceType !== "meeting_room" && object.resourceType !== "workspace_member") {
      throw badRequest("resourceType must be meeting_room or workspace_member");
    }
    const roomName = object.roomName === undefined
      ? undefined
      : this.requireBoundedString(object.roomName, "roomName", 100);
    const displayName = object.displayName === undefined
      ? undefined
      : this.requireBoundedString(object.displayName, "displayName", 120);
    const self = object.self === undefined ? undefined : this.requireBoolean(object.self, "self");
    const useLatestCandidate = object.useLatestCandidate === undefined
      ? undefined
      : this.requireBoolean(object.useLatestCandidate, "useLatestCandidate");
    if (self === false || useLatestCandidate === false) {
      throw badRequest("self and useLatestCandidate may only be true when provided");
    }
    if (object.resourceType === "meeting_room" && !roomName && !useLatestCandidate) {
      throw badRequest("meeting_room requires roomName or useLatestCandidate");
    }
    if (
      object.resourceType === "workspace_member" &&
      !displayName &&
      !self &&
      !useLatestCandidate
    ) {
      throw badRequest("workspace_member requires displayName, self, or useLatestCandidate");
    }
    return {
      resourceType: object.resourceType,
      ...(roomName ? { roomName } : {}),
      ...(displayName ? { displayName } : {}),
      ...(self ? { self: true } : {}),
      ...(useLatestCandidate ? { useLatestCandidate: true } : {})
    };
  }

  private async resolveMeetingResource(
    context: AgentToolContext,
    input: ResolveMeetingResourceInput
  ): Promise<MeetingAgentResourceResolution> {
    const resolver = this.requireMeetingResourceResolver();
    if (input.useLatestCandidate) {
      const reference = await this.requireAgentCandidateSelectionService().getLatestConsumedMeetingReference(
        context,
        input.resourceType
      );
      if (!reference) {
        return {
          kind: "needs_clarification",
          reason: "not_found",
          candidates: [],
          totalCandidates: 0
        };
      }
      return {
        kind: "selected",
        reference,
        candidate: {
          resourceType: reference.resourceType,
          label: "선택한 후보",
          description: null,
          status: null
        },
        selectionToken: ""
      };
    }
    return input.resourceType === "meeting_room"
      ? resolver.resolveMeetingRoom(context, input.roomName ?? "")
      : resolver.resolveMember(context, {
          ...(input.self ? { self: true } : {}),
          ...(input.displayName ? { displayName: input.displayName } : {})
        });
  }

  private async resolveStartMeetingInput(
    context: AgentToolContext,
    input: StartMeetingInput
  ): Promise<ResolvedStartMeetingInput | AgentToolClarificationResult> {
    const resolved = await this.resolveMeetingRoomSelector(context, input);
    if (resolved.kind !== "selected") {
      return this.toResourceClarification(context, resolved);
    }
    return {
      meetingRoomId: resolved.reference.resourceId,
      ...(input.recordingConsent ? { recordingConsent: input.recordingConsent } : {})
    };
  }

  private async resolveJoinMeetingInput(
    context: AgentToolContext,
    input: JoinMeetingInput
  ): Promise<ResolvedJoinMeetingInput | AgentToolClarificationResult> {
    const resolved = await this.resolveMeetingSelector(context, input);
    if (resolved.kind !== "selected") {
      return this.toResourceClarification(context, resolved);
    }
    return {
      meetingId: resolved.reference.resourceId,
      ...(input.recordingConsent ? { recordingConsent: input.recordingConsent } : {})
    };
  }

  private async resolveMeetingIdInput(
    context: AgentToolContext,
    input: MeetingSelectorInput
  ): Promise<MeetingIdInput | AgentToolClarificationResult> {
    const resolved = await this.resolveMeetingSelector(context, input);
    if (resolved.kind !== "selected") {
      return this.toResourceClarification(context, resolved);
    }
    return { meetingId: resolved.reference.resourceId };
  }

  private async prepareMeetingSelectorExecution(
    context: AgentToolContext,
    input: MeetingSelectorInput
  ): Promise<{ kind: "execute" } | AgentToolClarificationResult> {
    const resolved = await this.resolveMeetingSelector(context, input);
    return resolved.kind === "selected"
      ? { kind: "execute" }
      : this.toResourceClarification(context, resolved);
  }

  private async prepareMeetingReportSelectorExecution(
    context: AgentToolContext,
    input: MeetingReportSelectorInput
  ): Promise<{ kind: "execute" } | AgentToolClarificationResult> {
    const resolved = await this.resolveMeetingReportSelector(context, input);
    return resolved.kind === "selected"
      ? { kind: "execute" }
      : this.toResourceClarification(context, resolved);
  }

  private async requireResolvedMeeting(
    context: AgentToolContext,
    input: MeetingSelectorInput
  ): Promise<MeetingAgentResourceReference> {
    const resolved = await this.resolveMeetingSelector(context, input);
    if (resolved.kind !== "selected") {
      throw badRequest("Meeting selector requires a candidate selection");
    }
    return resolved.reference;
  }

  private async requireResolvedReport(
    context: AgentToolContext,
    input: MeetingReportSelectorInput
  ): Promise<MeetingAgentResourceReference> {
    const resolved = await this.resolveMeetingReportSelector(context, input);
    if (resolved.kind !== "selected") {
      throw badRequest("Meeting report selector requires a candidate selection");
    }
    return resolved.reference;
  }

  private async resolveMeetingRoomSelector(
    context: AgentToolContext,
    input: StartMeetingInput
  ): Promise<MeetingAgentResourceResolution> {
    if (input.useSelectedMeetingRoomCandidate) {
      return this.resolveLatestCandidateReference(context, "meeting_room");
    }
    return this.requireMeetingResourceResolver().resolveMeetingRoom(
      context,
      input.roomName ?? ""
    );
  }

  private async resolveMeetingSelector(
    context: AgentToolContext,
    input: MeetingSelectorInput
  ): Promise<MeetingAgentResourceResolution> {
    if (input.contextRef) {
      return this.requireMeetingResourceResolver().resolveContextReference(
        context,
        input.contextRef,
        "meeting"
      );
    }
    if (input.useSelectedMeetingCandidate) {
      return this.resolveLatestCandidateReference(context, "meeting");
    }
    if (input.roomName) {
      return this.requireMeetingResourceResolver().resolveMeeting(context, {
        roomName: input.roomName
      });
    }
    return this.requireMeetingResourceResolver().resolveCurrentMeeting(context);
  }

  private async resolveMeetingReportSelector(
    context: AgentToolContext,
    input: MeetingReportSelectorInput
  ): Promise<MeetingAgentResourceResolution> {
    if (input.contextRef) {
      return this.requireMeetingResourceResolver().resolveContextReference(
        context,
        input.contextRef,
        "meeting_report"
      );
    }
    if (input.useSelectedMeetingReportCandidate) {
      return this.resolveLatestCandidateReference(context, "meeting_report");
    }
    const resolver = this.requireMeetingResourceResolver();
    const selector = {
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.roomName ? { roomName: input.roomName } : {})
    };
    return Object.keys(selector).length === 0
      ? resolver.resolveLatestReport(context)
      : resolver.resolveReport(context, selector);
  }

  private async resolveLatestCandidateReference(
    context: AgentToolContext,
    resourceType: MeetingAgentResourceType
  ): Promise<MeetingAgentResourceResolution> {
    const reference = await this.requireAgentCandidateSelectionService().getLatestConsumedMeetingReference(
      context,
      resourceType
    );
    if (!reference || reference.resourceType !== resourceType) {
      return this.notFoundResourceResolution();
    }
    const revalidated = await this.requireMeetingResourceResolver().revalidateReference(
      context,
      reference
    );
    if (!revalidated) return this.notFoundResourceResolution();
    return {
      kind: "selected",
      reference: revalidated,
      candidate: {
        resourceType,
        label: "선택한 후보",
        description: null,
        status: null
      },
      selectionToken: ""
    };
  }

  private notFoundResourceResolution(): MeetingAgentResourceResolution {
    return {
      kind: "needs_clarification",
      reason: "not_found",
      candidates: [],
      totalCandidates: 0
    };
  }

  private async resolveSelectedWorkspaceMember(
    context: AgentToolContext,
    input: UpdateActionItemInput
  ): Promise<ResolvedUpdateActionItemInput> {
    const { useSelectedWorkspaceMemberCandidate: _selection, ...resolved } = input;
    if (!input.useSelectedWorkspaceMemberCandidate) return resolved;
    const reference = await this.requireAgentCandidateSelectionService().getLatestConsumedMeetingReference(
      context,
      "workspace_member"
    );
    if (!reference || reference.resourceType !== "workspace_member") {
      throw badRequest("A selected Workspace member candidate is required");
    }
    return { ...resolved, assigneeUserId: reference.resourceId };
  }

  private async toResourceClarification(
    context: AgentToolContext,
    resolution: Extract<MeetingAgentResourceResolution, { kind: "needs_clarification" }>
  ): Promise<AgentToolClarificationResult> {
    const resolver = this.requireMeetingResourceResolver();
    const candidateResources = (
      await Promise.all(
        resolution.candidates.map(async (candidate) => {
          if (!candidate.selectionToken) return null;
          const reference = await resolver.revalidateSelectionToken(
            context,
            candidate.selectionToken
          );
          return reference ? { reference, candidate } : null;
        })
      )
    ).filter(
      (
        candidate
      ): candidate is NonNullable<typeof candidate> => candidate !== null
    );
    return {
      kind: "needs_clarification",
      outputSummary: {
        status: "needs_clarification",
        question:
          resolution.reason === "ambiguous"
            ? "어떤 대상을 선택할지 후보에서 골라주세요."
            : "조건에 맞는 대상을 찾지 못했습니다. 이름이나 범위를 다시 알려주세요."
      },
      resourceRefs: [],
      ...(candidateResources.length > 0 ? { candidateResources } : {})
    };
  }

  private toResolvedResourceRef(
    reference: MeetingAgentResourceReference,
    label: string
  ): AgentResourceRef {
    return {
      domain: "meeting",
      resourceType: reference.resourceType,
      resourceId: reference.resourceId,
      label
    };
  }

  private requireMeetingResourceResolver(): MeetingAgentResourceResolver {
    if (!this.meetingAgentResourceResolver) {
      throw new Error("MeetingAgentResourceResolver is required");
    }
    return this.meetingAgentResourceResolver;
  }

  private requireAgentCandidateSelectionService(): AgentCandidateSelectionService {
    if (!this.agentCandidateSelectionService) {
      throw new Error("AgentCandidateSelectionService is required");
    }
    return this.agentCandidateSelectionService;
  }

  private validateListInput(input: unknown): ListMeetingReportsInput {
    const draft = input ?? {};
    const object = this.requirePlainObject(draft, "Meeting report list input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(
      object,
      LIST_INPUT_FIELDS,
      "Meeting report list input"
    );

    const from = this.readOptionalDateTime(object.from, "from");
    const to = this.readOptionalDateTime(object.to, "to");
    if (from && to && from >= to) {
      throw badRequest("from must be before to");
    }
    return {
      ...(object.status === undefined
        ? {}
        : { status: this.readOptionalStatus(object.status) }),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(object.roomName === undefined
        ? {}
        : { roomName: this.requireBoundedString(object.roomName, "roomName", 100) }),
      limit: this.readOptionalLimit(object.limit) ?? 1
    };
  }

  private validateMeetingSelectorInput(input: unknown): MeetingSelectorInput {
    const draft = input ?? {};
    const object = this.requirePlainObject(draft, "Meeting selector input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(
      object,
      MEETING_SELECTOR_INPUT_FIELDS,
      "Meeting selector input"
    );
    const current =
      object.current === undefined
        ? undefined
        : this.requireBoolean(object.current, "current");
    const contextRef =
      object.contextRef === undefined
        ? undefined
        : this.requireContextRef(object.contextRef, "contextRef");
    const roomName =
      object.roomName === undefined
        ? undefined
        : this.requireBoundedString(object.roomName, "roomName", 100);
    const useSelectedMeetingCandidate =
      object.useSelectedMeetingCandidate === undefined
        ? undefined
        : this.requireBoolean(
            object.useSelectedMeetingCandidate,
            "useSelectedMeetingCandidate"
          );
    if (current === false || useSelectedMeetingCandidate === false) {
      throw badRequest("Meeting selector booleans may only be true when provided");
    }
    if (
      [
        contextRef !== undefined,
        current === true,
        roomName !== undefined,
        useSelectedMeetingCandidate === true
      ]
        .filter(Boolean).length > 1
    ) {
      throw badRequest("Meeting selector may contain only one target");
    }
    return {
      ...(contextRef ? { contextRef } : {}),
      ...(current ? { current: true } : {}),
      ...(roomName ? { roomName } : {}),
      ...(useSelectedMeetingCandidate
        ? { useSelectedMeetingCandidate: true }
        : {})
    };
  }

  private validateMeetingReportSelectorInput(
    input: unknown
  ): MeetingReportSelectorInput {
    const draft = input ?? {};
    const object = this.requirePlainObject(draft, "Meeting report selector input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(
      object,
      REPORT_SELECTOR_INPUT_FIELDS,
      "Meeting report selector input"
    );
    const from = this.readOptionalDateTime(object.from, "from");
    const to = this.readOptionalDateTime(object.to, "to");
    if (from && to && from >= to) {
      throw badRequest("from must be before to");
    }
    const useSelectedMeetingReportCandidate =
      object.useSelectedMeetingReportCandidate === undefined
        ? undefined
        : this.requireBoolean(
            object.useSelectedMeetingReportCandidate,
            "useSelectedMeetingReportCandidate"
          );
    if (useSelectedMeetingReportCandidate === false) {
      throw badRequest(
        "useSelectedMeetingReportCandidate may only be true when provided"
      );
    }
    if (
      [
        object.contextRef !== undefined,
        useSelectedMeetingReportCandidate === true,
        Boolean(from || to || object.status !== undefined || object.roomName !== undefined)
      ].filter(Boolean).length > 1
    ) {
      throw badRequest(
        "Meeting report context reference, selected candidate, and filters may not be combined"
      );
    }
    return {
      ...(object.contextRef === undefined
        ? {}
        : {
            contextRef: this.requireContextRef(
              object.contextRef,
              "contextRef"
            )
          }),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(object.status === undefined
        ? {}
        : { status: this.readOptionalStatus(object.status) }),
      ...(object.roomName === undefined
        ? {}
        : { roomName: this.requireBoundedString(object.roomName, "roomName", 100) }),
      ...(useSelectedMeetingReportCandidate
        ? { useSelectedMeetingReportCandidate: true }
        : {})
    };
  }

  private adaptLegacyReportReferenceInput(
    input: unknown
  ): LegacyPersistedReportReferenceInput | null {
    try {
      const report = this.validateReportIdInput(input);
      return {
        legacyPersistedPlannerInput: true,
        reportId: report.reportId
      };
    } catch {
      return null;
    }
  }

  private adaptLegacyDecisionEvidenceInput(
    input: unknown
  ): LegacyPersistedDecisionEvidenceInput | null {
    try {
      const object = this.requirePlainObject(
        input,
        "Legacy Meeting decision evidence input"
      );
      this.rejectForbiddenMeetingToolFields(object);
      this.assertOnlyAllowedFields(
        object,
        LEGACY_DECISION_EVIDENCE_INPUT_FIELDS,
        "Legacy Meeting decision evidence input"
      );
      const decisionIndex = object.decisionIndex;
      if (
        decisionIndex !== undefined &&
        (!Number.isInteger(decisionIndex) || (decisionIndex as number) < 0)
      ) {
        return null;
      }
      return {
        legacyPersistedPlannerInput: true,
        reportId: this.requireReportId(object.reportId),
        ...(decisionIndex === undefined
          ? {}
          : { decisionIndex: decisionIndex as number })
      };
    } catch {
      return null;
    }
  }

  private isLegacyPersistedReportReferenceInput(
    input: unknown
  ): input is LegacyPersistedReportReferenceInput {
    if (!this.isPlainObject(input) || input.legacyPersistedPlannerInput !== true) {
      return false;
    }
    try {
      return this.requireReportId(input.reportId) === input.reportId;
    } catch {
      return false;
    }
  }

  private isLegacyPersistedDecisionEvidenceInput(
    input: unknown
  ): input is LegacyPersistedDecisionEvidenceInput {
    if (!this.isLegacyPersistedReportReferenceInput(input)) return false;
    const decisionIndex = (input as { decisionIndex?: unknown }).decisionIndex;
    return (
      decisionIndex === undefined ||
      (Number.isInteger(decisionIndex) && (decisionIndex as number) >= 0)
    );
  }

  private validateReportIdInput(input: unknown): ReportIdInput {
    const object = this.requirePlainObject(input, "Meeting report input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(
      object,
      REPORT_ID_INPUT_FIELDS,
      "Meeting report input"
    );

    return {
      reportId: this.requireReportId(object.reportId)
    };
  }

  private validateMeetingIdInput(input: unknown): MeetingIdInput {
    const object = this.requirePlainObject(input, "Meeting participant input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(
      object,
      MEETING_ID_INPUT_FIELDS,
      "Meeting participant input"
    );

    return {
      meetingId: this.requireMeetingId(object.meetingId)
    };
  }

  private validateStartMeetingInput(input: unknown): StartMeetingInput {
    const object = this.requirePlainObject(input, "Meeting start input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(
      object,
      START_MEETING_INPUT_FIELDS,
      "Meeting start input"
    );
    const roomName =
      object.roomName === undefined
        ? undefined
        : this.requireBoundedString(object.roomName, "roomName", 100);
    const useSelectedMeetingRoomCandidate =
      object.useSelectedMeetingRoomCandidate === undefined
        ? undefined
        : this.requireBoolean(
            object.useSelectedMeetingRoomCandidate,
            "useSelectedMeetingRoomCandidate"
          );
    if (useSelectedMeetingRoomCandidate === false) {
      throw badRequest("useSelectedMeetingRoomCandidate may only be true when provided");
    }
    if (!roomName && !useSelectedMeetingRoomCandidate) {
      throw badRequest(
        "Meeting start input requires roomName or useSelectedMeetingRoomCandidate"
      );
    }
    if (roomName && useSelectedMeetingRoomCandidate) {
      throw badRequest(
        "Meeting start input may not combine roomName and useSelectedMeetingRoomCandidate"
      );
    }
    return {
      ...(roomName ? { roomName } : {}),
      ...(useSelectedMeetingRoomCandidate
        ? { useSelectedMeetingRoomCandidate: true }
        : {}),
      ...(object.recordingConsent === undefined
        ? {}
        : {
            recordingConsent: this.validateRecordingConsent(
              object.recordingConsent
            )
          })
    };
  }

  private validateJoinMeetingInput(input: unknown): JoinMeetingInput {
    const object = this.requirePlainObject(input, "Meeting join input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(object, JOIN_MEETING_INPUT_FIELDS, "Meeting join input");
    const selector = this.validateMeetingSelectorInput({
      current: object.current,
      roomName: object.roomName,
      useSelectedMeetingCandidate: object.useSelectedMeetingCandidate
    });
    return {
      ...selector,
      ...(object.recordingConsent === undefined
        ? {}
        : {
            recordingConsent: this.validateRecordingConsent(
              object.recordingConsent
            )
          })
    };
  }

  private validateResolvedStartMeetingInput(
    input: unknown
  ): ResolvedStartMeetingInput {
    const object = this.requirePlainObject(input, "Resolved meeting start input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(
      object,
      ["meetingRoomId", "recordingConsent"],
      "Resolved meeting start input"
    );
    return {
      meetingRoomId: this.requireMeetingId(object.meetingRoomId),
      ...(object.recordingConsent === undefined
        ? {}
        : { recordingConsent: this.validateRecordingConsent(object.recordingConsent) })
    };
  }

  private validateResolvedJoinMeetingInput(input: unknown): ResolvedJoinMeetingInput {
    const object = this.requirePlainObject(input, "Resolved meeting join input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(
      object,
      ["meetingId", "recordingConsent"],
      "Resolved meeting join input"
    );
    return {
      meetingId: this.requireMeetingId(object.meetingId),
      ...(object.recordingConsent === undefined
        ? {}
        : { recordingConsent: this.validateRecordingConsent(object.recordingConsent) })
    };
  }

  private validateRecordingConsent(input: unknown): RecordingConsentInput {
    const object = this.requirePlainObject(input, "recordingConsent");
    this.assertOnlyAllowedFields(
      object,
      ["accepted", "policyVersion"],
      "recordingConsent"
    );
    if (object.accepted !== true) {
      throw badRequest("recordingConsent.accepted must be true");
    }
    if (object.policyVersion !== "v1") {
      throw badRequest("recordingConsent.policyVersion must be v1");
    }
    return { accepted: true, policyVersion: "v1" };
  }

  private meetingIdSchema(): AgentJsonObject {
    return {
      type: "object",
      required: ["meetingId"],
      additionalProperties: false,
      properties: { meetingId: { type: "string", format: "uuid" } }
    };
  }

  private meetingSelectorSchema(): AgentJsonObject {
    return {
      contextRef: {
        type: "string",
        pattern: "^ctx_[0-9a-f]{24}$"
      },
      current: { type: "boolean", const: true },
      roomName: { type: "string", minLength: 1, maxLength: 100 },
      useSelectedMeetingCandidate: { type: "boolean", const: true }
    };
  }

  private meetingSelectorInputSchema(): AgentJsonObject {
    return {
      type: "object",
      additionalProperties: false,
      properties: this.meetingSelectorSchema()
    };
  }

  private meetingReportSelectorSchema(): AgentJsonObject {
    return {
      contextRef: {
        type: "string",
        pattern: "^ctx_[0-9a-f]{24}$"
      },
      from: { type: "string", format: "date-time" },
      to: { type: "string", format: "date-time" },
      status: { type: "string", enum: [...MEETING_REPORT_STATUSES] },
      roomName: { type: "string", minLength: 1, maxLength: 100 },
      useSelectedMeetingReportCandidate: { type: "boolean", const: true }
    };
  }

  private actionItemContextSchema(): AgentJsonObject {
    return {
      actionItemContextRef: {
        type: "string",
        pattern: "^ctx_[0-9a-f]{24}$"
      },
      reportContextRef: {
        type: "string",
        pattern: "^ctx_[0-9a-f]{24}$"
      },
      ordinal: { type: "integer", minimum: 1, maximum: 20 },
      useSelectedMeetingActionItemCandidate: { type: "boolean", const: true }
    };
  }

  private recordingConsentSchema(): AgentJsonObject {
    return {
      type: "object",
      additionalProperties: false,
      required: ["accepted", "policyVersion"],
      properties: {
        accepted: { type: "boolean", const: true },
        policyVersion: { type: "string", const: "v1" }
      }
    };
  }

  private validateSearchTranscriptInput(input: unknown): SearchMeetingTranscriptInput {
    const object = this.requirePlainObject(input, "Meeting transcript search input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(object, SEARCH_TRANSCRIPT_INPUT_FIELDS, "Meeting transcript search input");
    const query = this.boundText(typeof object.query === "string" ? object.query : null, 1000);
    if (query === null) throw badRequest("query must be a non-empty string");
    return { query, reportId: object.reportId === undefined ? undefined : this.requireReportId(object.reportId) };
  }

  private validateActionItemInput(input: unknown): ActionItemInput {
    const object = this.requirePlainObject(input, "Meeting action item input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(object, ACTION_ITEM_INPUT_FIELDS, "Meeting action item input");
    return {
      reportId: this.requireReportId(object.reportId),
      actionItemId: this.requireActionItemId(object.actionItemId)
    };
  }

  private validateActionItemContextInput(input: unknown): ActionItemContextInput {
    const object = this.requirePlainObject(input, "Meeting action item context input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(
      object,
      ACTION_ITEM_CONTEXT_INPUT_FIELDS,
      "Meeting action item context input"
    );
    const actionItemContextRef =
      object.actionItemContextRef === undefined
        ? undefined
        : this.requireContextRef(object.actionItemContextRef, "actionItemContextRef");
    const reportContextRef =
      object.reportContextRef === undefined
        ? undefined
        : this.requireContextRef(object.reportContextRef, "reportContextRef");
    const ordinal = object.ordinal;
    const useSelectedMeetingActionItemCandidate =
      object.useSelectedMeetingActionItemCandidate === undefined
        ? undefined
        : this.requireBoolean(
            object.useSelectedMeetingActionItemCandidate,
            "useSelectedMeetingActionItemCandidate"
          );
    if (useSelectedMeetingActionItemCandidate === false) {
      throw badRequest(
        "useSelectedMeetingActionItemCandidate may only be true when provided"
      );
    }
    if (
      ordinal !== undefined &&
      (!Number.isInteger(ordinal) || (ordinal as number) < 1 || (ordinal as number) > 20)
    ) {
      throw badRequest("ordinal must be an integer from 1 to 20");
    }
    if (
      (reportContextRef === undefined) !== (ordinal === undefined) ||
      (actionItemContextRef ? 1 : 0) +
        (reportContextRef !== undefined && ordinal !== undefined ? 1 : 0) +
        (useSelectedMeetingActionItemCandidate ? 1 : 0) !==
        1
    ) {
      throw badRequest(
        "Use actionItemContextRef or reportContextRef with ordinal"
      );
    }
    return {
      ...(actionItemContextRef ? { actionItemContextRef } : {}),
      ...(reportContextRef ? { reportContextRef } : {}),
      ...(ordinal === undefined ? {} : { ordinal: ordinal as number }),
      ...(useSelectedMeetingActionItemCandidate
        ? { useSelectedMeetingActionItemCandidate: true }
        : {})
    };
  }

  private validateUpdateActionItemContextInput(
    input: unknown
  ): UpdateActionItemContextInput {
    const object = this.requirePlainObject(
      input,
      "Meeting action item update context input"
    );
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(
      object,
      UPDATE_ACTION_ITEM_INPUT_FIELDS,
      "Meeting action item update context input"
    );
    const base = this.validateActionItemContextInput({
      actionItemContextRef: object.actionItemContextRef,
      reportContextRef: object.reportContextRef,
      ordinal: object.ordinal,
      useSelectedMeetingActionItemCandidate:
        object.useSelectedMeetingActionItemCandidate
    });
    const changes = this.readActionItemUpdateChanges(object);
    return { ...base, ...changes };
  }

  private validateUpdateActionItemInput(input: unknown): UpdateActionItemInput {
    const object = this.requirePlainObject(input, "Meeting action item update input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(object, LEGACY_UPDATE_ACTION_ITEM_INPUT_FIELDS, "Meeting action item update input");
    const base = this.validateActionItemInput({ reportId: object.reportId, actionItemId: object.actionItemId });
    return { ...base, ...this.readActionItemUpdateChanges(object) };
  }

  private readActionItemUpdateChanges(
    object: Record<string, unknown>
  ): Omit<UpdateActionItemContextInput, keyof ActionItemContextInput> {
    const title = object.title === undefined ? undefined : this.requireBoundedString(object.title, "title", 500);
    const description = object.description === undefined ? undefined : this.requireBoundedString(object.description, "description", 5000);
    const priority = object.priority === undefined ? undefined : this.requirePriority(object.priority);
    const assigneeUserId = object.assigneeUserId === undefined ? undefined : object.assigneeUserId === null ? null : this.requireActionItemId(object.assigneeUserId);
    const assigneeDisplayName = object.assigneeDisplayName === undefined
      ? undefined
      : this.requireBoundedString(
          object.assigneeDisplayName,
          "assigneeDisplayName",
          120
        );
    const useSelectedWorkspaceMemberCandidate = object.useSelectedWorkspaceMemberCandidate === undefined
      ? undefined
      : this.requireBoolean(object.useSelectedWorkspaceMemberCandidate, "useSelectedWorkspaceMemberCandidate");
    if (useSelectedWorkspaceMemberCandidate === false) throw badRequest("useSelectedWorkspaceMemberCandidate may only be true when provided");
    if (
      [assigneeUserId !== undefined, assigneeDisplayName !== undefined, Boolean(useSelectedWorkspaceMemberCandidate)].filter(Boolean).length > 1
    ) throw badRequest("Use one assignee selector at a time");
    if (title === undefined && description === undefined && priority === undefined && assigneeUserId === undefined && assigneeDisplayName === undefined && !useSelectedWorkspaceMemberCandidate) throw badRequest("Meeting action item update requires at least one change");
    return { ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }), ...(priority === undefined ? {} : { priority }), ...(assigneeUserId === undefined ? {} : { assigneeUserId }), ...(assigneeDisplayName === undefined ? {} : { assigneeDisplayName }), ...(useSelectedWorkspaceMemberCandidate ? { useSelectedWorkspaceMemberCandidate: true } : {}) };
  }

  private validateApproveActionItemInput(input: unknown): ApproveActionItemInput {
    const object = this.requirePlainObject(input, "Meeting action item approval input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(object, LEGACY_APPROVE_ACTION_ITEM_INPUT_FIELDS, "Meeting action item approval input");
    const base = this.validateActionItemInput({ reportId: object.reportId, actionItemId: object.actionItemId });
    return { ...base, delivery: this.readActionItemDelivery(object.delivery) };
  }

  private validateApproveActionItemContextInput(
    input: unknown
  ): ApproveActionItemContextInput {
    const object = this.requirePlainObject(
      input,
      "Meeting action item approval context input"
    );
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(
      object,
      APPROVE_ACTION_ITEM_INPUT_FIELDS,
      "Meeting action item approval context input"
    );
    const base = this.validateActionItemContextInput({
      actionItemContextRef: object.actionItemContextRef,
      reportContextRef: object.reportContextRef,
      ordinal: object.ordinal,
      useSelectedMeetingActionItemCandidate:
        object.useSelectedMeetingActionItemCandidate
    });
    return { ...base, delivery: this.readActionItemDelivery(object.delivery) };
  }

  private readActionItemDelivery(
    value: unknown
  ): MeetingActionItemDeliveryInput {
    const deliveryObject = this.requirePlainObject(value, "delivery");
    const deliveryType = deliveryObject.deliveryType;
    if (deliveryType === "calendar_event") {
      const calendar = this.requirePlainObject(deliveryObject.calendar, "delivery.calendar");
      this.assertOnlyAllowedFields(deliveryObject, ["deliveryType", "calendar"], "delivery");
      this.assertOnlyAllowedFields(calendar, ["title", "description", "color", "isAllDay", "startDate", "endDate", "startTime", "endTime"], "delivery.calendar");
      return {
          deliveryType,
          calendar: {
            ...(calendar.title === undefined ? {} : { title: this.requireBoundedString(calendar.title, "calendar.title", 255) }),
            ...(calendar.description === undefined ? {} : { description: calendar.description === null ? null : this.requireBoundedString(calendar.description, "calendar.description", 5000) }),
            ...(calendar.color === undefined ? {} : { color: this.requireBoundedString(calendar.color, "calendar.color", 7) }),
            ...(calendar.isAllDay === undefined ? {} : { isAllDay: this.requireBoolean(calendar.isAllDay, "calendar.isAllDay") }),
            startDate: this.requireDate(calendar.startDate, "calendar.startDate"),
            endDate: this.requireDate(calendar.endDate, "calendar.endDate"),
            ...(calendar.startTime === undefined ? {} : { startTime: calendar.startTime === null ? null : this.requireTime(calendar.startTime, "calendar.startTime") }),
            ...(calendar.endTime === undefined ? {} : { endTime: calendar.endTime === null ? null : this.requireTime(calendar.endTime, "calendar.endTime") })
          }
      };
    }
    if (deliveryType === "pilo_issue") {
      const issue = this.requirePlainObject(deliveryObject.issue, "delivery.issue");
      this.assertOnlyAllowedFields(deliveryObject, ["deliveryType", "issue"], "delivery");
      this.assertOnlyAllowedFields(issue, ["boardId", "columnId", "title", "body"], "delivery.issue");
      return {
          deliveryType,
          issue: {
            boardId: this.requireActionItemId(issue.boardId),
            columnId: this.requireActionItemId(issue.columnId),
            ...(issue.title === undefined ? {} : { title: this.requireBoundedString(issue.title, "issue.title", 255) }),
            ...(issue.body === undefined ? {} : { body: this.requireBoundedString(issue.body, "issue.body", 65535) })
          }
      };
    }
    throw badRequest("delivery.deliveryType must be calendar_event or pilo_issue");
  }

  private validateDecisionEvidenceSelectorInput(
    input: unknown
  ): DecisionEvidenceSelectorInput {
    const object = this.requirePlainObject(input, "Meeting decision evidence input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(
      object,
      DECISION_EVIDENCE_SELECTOR_INPUT_FIELDS,
      "Meeting decision evidence input"
    );
    const decisionIndex = object.decisionIndex;
    if (decisionIndex !== undefined && (!Number.isInteger(decisionIndex) || (decisionIndex as number) < 0)) {
      throw badRequest("decisionIndex must be a non-negative integer");
    }
    const { decisionIndex: _decisionIndex, ...selector } = object;
    return {
      ...this.validateMeetingReportSelectorInput(selector),
      ...(decisionIndex === undefined
        ? {}
        : { decisionIndex: decisionIndex as number })
    };
  }

  private actionItemPatch(
    input: UpdateActionItemInput | UpdateActionItemContextInput
  ): AgentJsonObject {
    const patch: AgentJsonObject = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.assigneeUserId !== undefined) patch.assigneeUserId = input.assigneeUserId;
    return patch;
  }

  private readOptionalStatus(value: unknown): MeetingReportStatus | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (
      typeof value === "string" &&
      MEETING_REPORT_STATUSES.includes(value as MeetingReportStatus)
    ) {
      return value as MeetingReportStatus;
    }

    throw badRequest("status must be PROCESSING, COMPLETED, or FAILED");
  }

  private readOptionalLimit(value: unknown): number | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const rawLimit = typeof value === "number" ? String(value) : value;
    if (typeof rawLimit !== "string") {
      throw badRequest("limit must be a positive integer");
    }

    const parsed = Number(rawLimit.trim());
    if (!Number.isFinite(parsed)) {
      throw badRequest("limit must be a positive integer");
    }

    if (!Number.isInteger(parsed)) {
      throw badRequest("limit must be a positive integer");
    }

    if (parsed < 1 || parsed > 100) {
      throw badRequest("limit must be between 1 and 100");
    }

    return parsed;
  }

  private readOptionalDateTime(
    value: unknown,
    field: "from" | "to"
  ): string | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
      throw badRequest(`${field} must be an ISO 8601 date-time`);
    }
    return value;
  }

  private confirmationPlanInput(plan: AgentConfirmationPlan): AgentJsonObject {
    if ("kind" in plan && plan.kind === "choice") {
      throw badRequest("Meeting confirmation plan must be an approval plan");
    }
    const input = plan.call.input;
    if (!this.isPlainObject(input)) {
      throw badRequest("Meeting confirmation plan input is invalid");
    }
    return input;
  }

  private requireReportId(value: unknown): string {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      throw badRequest("reportId must be a valid UUID");
    }

    return value;
  }

  private requireContextRef(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^ctx_[0-9a-f]{24}$/.test(value)) {
      throw badRequest(`${field} must be a valid opaque context reference`);
    }
    return value;
  }

  private requireMeetingId(value: unknown): string {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      throw badRequest("meetingId must be a valid UUID");
    }

    return value;
  }

  private requireActionItemId(value: unknown): string {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      throw badRequest("actionItemId must be a valid UUID");
    }
    return value;
  }

  private requireBoundedString(value: unknown, field: string, maxLength: number): string {
    if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value.trim(), "utf8") > maxLength) {
      throw badRequest(`${field} must be a non-empty string within ${maxLength} bytes`);
    }
    return value.trim();
  }

  private requirePriority(value: unknown): "LOW" | "MEDIUM" | "HIGH" {
    if (value === "LOW" || value === "MEDIUM" || value === "HIGH") return value;
    throw badRequest("priority must be LOW, MEDIUM, or HIGH");
  }

  private requireBoolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") throw badRequest(`${field} must be a boolean`);
    return value;
  }

  private requireDate(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest(`${field} must be YYYY-MM-DD`);
    return value;
  }

  private requireTime(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw badRequest(`${field} must be HH:MM`);
    return value;
  }

  private rejectForbiddenMeetingToolFields(input: AgentJsonObject): void {
    for (const field of FORBIDDEN_MEETING_TOOL_FIELDS) {
      if (input[field] !== undefined) {
        throw badRequest(`${field} must not be provided to Meeting tools`);
      }
    }
  }

  private assertOnlyAllowedFields(
    input: AgentJsonObject,
    allowedFields: string[],
    label: string
  ): void {
    for (const key of Object.keys(input)) {
      if (!allowedFields.includes(key)) {
        throw badRequest(`${label}.${key} is not supported`);
      }
    }
  }

  private requirePlainObject(value: unknown, label: string): AgentJsonObject {
    if (!this.isPlainObject(value)) {
      throw badRequest(`${label} must be an object`);
    }

    return value;
  }

  private isPlainObject(value: unknown): value is AgentJsonObject {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    );
  }

  private copyBoundedString(
    source: AgentJsonObject,
    target: AgentJsonObject,
    key: string
  ): void {
    const value = source[key];
    const text = this.boundText(
      typeof value === "string" ? value : null,
      ACTION_ITEM_TEXT_LIMIT
    );

    if (text !== null) {
      target[key] = text;
    }
  }

  private boundText(value: string | null, maxLength: number): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    if (trimmed.length <= maxLength) {
      return trimmed;
    }

    return trimmed.slice(0, maxLength);
  }
}
