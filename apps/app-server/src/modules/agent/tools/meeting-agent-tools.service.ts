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

type MeetingReportStatus = "PROCESSING" | "COMPLETED" | "FAILED";

interface ListMeetingReportsInput {
  status?: MeetingReportStatus;
  limit?: number;
}

interface ReportIdInput {
  reportId: string;
}

interface MeetingIdInput {
  meetingId: string;
}

interface RecordingConsentInput {
  accepted: true;
  policyVersion: string;
}

interface StartMeetingInput {
  meetingRoomId: string;
  recordingConsent?: RecordingConsentInput;
}

interface JoinMeetingInput extends MeetingIdInput {
  recordingConsent?: RecordingConsentInput;
}

interface SearchMeetingTranscriptInput { query: string; reportId?: string }

interface ActionItemInput extends ReportIdInput { actionItemId: string }

interface UpdateActionItemInput extends ActionItemInput {
  title?: string;
  description?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  assigneeUserId?: string | null;
}

interface ApproveActionItemInput extends ActionItemInput {
  delivery: MeetingActionItemDeliveryInput;
}

interface DecisionEvidenceInput extends ReportIdInput { decisionIndex?: number }

interface ProjectionOptions {
  sectionTextLimit: number;
}

const MEETING_REPORT_STATUSES: readonly MeetingReportStatus[] = [
  "PROCESSING",
  "COMPLETED",
  "FAILED"
];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIST_INPUT_FIELDS = ["status", "limit"];
const REPORT_ID_INPUT_FIELDS = ["reportId"];
const MEETING_ID_INPUT_FIELDS = ["meetingId"];
const START_MEETING_INPUT_FIELDS = ["meetingRoomId", "recordingConsent"];
const JOIN_MEETING_INPUT_FIELDS = ["meetingId", "recordingConsent"];
const SEARCH_TRANSCRIPT_INPUT_FIELDS = ["query", "reportId"];
const ACTION_ITEM_INPUT_FIELDS = ["reportId", "actionItemId"];
const UPDATE_ACTION_ITEM_INPUT_FIELDS = [
  "reportId",
  "actionItemId",
  "title",
  "description",
  "priority",
  "assigneeUserId"
];
const APPROVE_ACTION_ITEM_INPUT_FIELDS = ["reportId", "actionItemId", "delivery"];
const DECISION_EVIDENCE_INPUT_FIELDS = ["reportId", "decisionIndex"];
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
    private readonly meetingActionItemDeliveryService: MeetingActionItemDeliveryService
  ) {}

  listDefinitions(): AgentToolDefinition<unknown>[] {
    return [
      this.listMeetingRoomsDefinition(),
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

  private startMeetingDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "start_meeting_in_room",
      description:
        "선택한 MeetingRoom에서 회의를 시작합니다. recordingConsent는 사용자가 현재 정책에 명시적으로 동의한 경우에만 전달합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: {
        type: "object",
        required: ["meetingRoomId"],
        additionalProperties: false,
        properties: {
          meetingRoomId: { type: "string", format: "uuid" },
          recordingConsent: this.recordingConsentSchema()
        }
      },
      validateInput: (input) => this.validateStartMeetingInput(input),
      buildConfirmation: (context, input) =>
        this.buildStartMeetingConfirmation(
          context,
          this.validateStartMeetingInput(input)
        ),
      execute: (context, input) =>
        this.executeStartMeeting(context, this.validateStartMeetingInput(input))
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
        required: ["meetingId"],
        additionalProperties: false,
        properties: {
          meetingId: { type: "string", format: "uuid" },
          recordingConsent: this.recordingConsentSchema()
        }
      },
      validateInput: (input) => this.validateJoinMeetingInput(input),
      buildConfirmation: (context, input) =>
        this.buildJoinMeetingConfirmation(
          context,
          this.validateJoinMeetingInput(input)
        ),
      execute: (context, input) =>
        this.executeJoinMeeting(context, this.validateJoinMeetingInput(input))
    };
  }

  private leaveMeetingDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "leave_meeting",
      description:
        "현재 참여 중인 Meeting에서 나갑니다. 마지막 참여자면 기존 Meeting 규칙에 따라 녹음·회의가 종료될 수 있습니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: this.meetingIdSchema(),
      validateInput: (input) => this.validateMeetingIdInput(input),
      execute: (context, input) =>
        this.executeLeaveMeeting(context, this.validateMeetingIdInput(input))
    };
  }

  private startMeetingRecordingDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "start_meeting_recording",
      description:
        "현재 active participant인 Meeting의 녹음을 시작합니다. 모든 active participant의 동의를 서버가 재검증합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: this.meetingIdSchema(),
      validateInput: (input) => this.validateMeetingIdInput(input),
      buildConfirmation: (context, input) =>
        this.buildRecordingConfirmation(
          context,
          "start_meeting_recording",
          this.validateMeetingIdInput(input)
        ),
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
      inputSchema: this.meetingIdSchema(),
      validateInput: (input) => this.validateMeetingIdInput(input),
      buildConfirmation: (context, input) =>
        this.buildRecordingConfirmation(
          context,
          "end_meeting_recording",
          this.validateMeetingIdInput(input)
        ),
      execute: (context, input) =>
        this.executeEndRecording(context, this.validateMeetingIdInput(input))
    };
  }

  private findActionItemsDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "find_action_items",
      description: "특정 MeetingReport에 저장된 후속작업의 상태와 담당자를 조회합니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: { type: "object", required: ["reportId"], additionalProperties: false, properties: { reportId: { type: "string", format: "uuid" } } },
      validateInput: (input) => this.validateReportIdInput(input),
      execute: (context, input) => this.executeFindActionItems(context, this.validateReportIdInput(input))
    };
  }

  private getMeetingDecisionEvidenceDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "get_meeting_decision_evidence",
      description: "MeetingReport 결정사항에 직접 연결된 transcript와 Activity evidence만 조회합니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: { type: "object", required: ["reportId"], additionalProperties: false, properties: { reportId: { type: "string", format: "uuid" }, decisionIndex: { type: "integer", minimum: 0 } } },
      validateInput: (input) => this.validateDecisionEvidenceInput(input),
      execute: (context, input) => this.executeDecisionEvidence(context, this.validateDecisionEvidenceInput(input))
    };
  }

  private updateActionItemDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "update_meeting_report_action_item",
      description: "저장된 회의 후속작업의 제목, 설명, 우선순위, 담당자를 수정합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: { type: "object", required: ["reportId", "actionItemId"], additionalProperties: false, properties: { reportId: { type: "string", format: "uuid" }, actionItemId: { type: "string", format: "uuid" }, title: { type: "string" }, description: { type: "string" }, priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] }, assigneeUserId: { type: ["string", "null"], format: "uuid" } } },
      validateInput: (input) => this.validateUpdateActionItemInput(input),
      buildConfirmation: (context, input) => this.buildActionItemConfirmation(context, "update_meeting_report_action_item", this.validateUpdateActionItemInput(input)),
      execute: (context, input) => this.executeUpdateActionItem(context, this.validateUpdateActionItemInput(input))
    };
  }

  private dismissActionItemDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "dismiss_meeting_report_action_item",
      description: "저장된 회의 후속작업을 반려합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: { type: "object", required: ["reportId", "actionItemId"], additionalProperties: false, properties: { reportId: { type: "string", format: "uuid" }, actionItemId: { type: "string", format: "uuid" } } },
      validateInput: (input) => this.validateActionItemInput(input),
      buildConfirmation: (context, input) => this.buildActionItemConfirmation(context, "dismiss_meeting_report_action_item", this.validateActionItemInput(input)),
      execute: (context, input) => this.executeDismissActionItem(context, this.validateActionItemInput(input))
    };
  }

  private approveActionItemDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "approve_meeting_report_action_item",
      description: "회의 후속작업을 승인하고 선택한 하나의 Calendar 일정 또는 Board issue를 생성합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: { type: "object", required: ["reportId", "actionItemId", "delivery"], additionalProperties: false, properties: { reportId: { type: "string", format: "uuid" }, actionItemId: { type: "string", format: "uuid" }, delivery: { type: "object" } } },
      validateInput: (input) => this.validateApproveActionItemInput(input),
      buildConfirmation: (context, input) => this.buildActionItemConfirmation(context, "approve_meeting_report_action_item", this.validateApproveActionItemInput(input)),
      execute: (context, input) => this.executeApproveActionItem(context, this.validateApproveActionItemInput(input))
    };
  }

  private regenerateMeetingReportDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "regenerate_meeting_report",
      description: "원본 audio가 남아 있는 실패 MeetingReport의 재생성을 요청합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: { type: "object", required: ["reportId"], additionalProperties: false, properties: { reportId: { type: "string", format: "uuid" } } },
      validateInput: (input) => this.validateReportIdInput(input),
      buildConfirmation: (context, input) => this.buildRegenerateConfirmation(context, this.validateReportIdInput(input)),
      execute: (context, input) => this.executeRegenerateMeetingReport(context, this.validateReportIdInput(input))
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
      executionMode: "auto",
      inputSchema: {
        type: "object",
        required: ["meetingId"],
        additionalProperties: false,
        properties: {
          meetingId: {
            type: "string",
            format: "uuid"
          }
        }
      },
      validateInput: (input) => this.validateMeetingIdInput(input),
      execute: (context, input) =>
        this.executeGetMeetingParticipants(
          context,
          this.validateMeetingIdInput(input)
        )
    };
  }

  private searchMeetingTranscriptDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "search_meeting_transcript",
      description: "권한이 있는 MeetingReport transcript에서 질문과 의미적으로 관련된 발언을 검색하고 근거 기반 답변을 생성합니다.",
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
        "Workspace MeetingReport 목록을 최신 생성 시각 순으로 조회합니다. 최신 회의록 결과가 필요하면 limit을 1로 설정합니다.",
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
      executionMode: "auto",
      inputSchema: {
        type: "object",
        required: ["reportId"],
        additionalProperties: false,
        properties: {
          reportId: {
            type: "string",
            format: "uuid"
          }
        }
      },
      validateInput: (input) => this.validateReportIdInput(input),
      execute: (context, input) =>
        this.executeGetMeetingReport(context, this.validateReportIdInput(input))
    };
  }

  private summarizeMeetingReportDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "summarize_meeting_report",
      description:
        "MeetingReport를 Agent가 소비할 수 있는 sections/actionItems projection으로 요약합니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        required: ["reportId"],
        additionalProperties: false,
        properties: {
          reportId: {
            type: "string",
            format: "uuid"
          }
        }
      },
      validateInput: (input) => this.validateReportIdInput(input),
      execute: (context, input) =>
        this.executeSummarizeMeetingReport(
          context,
          this.validateReportIdInput(input)
        )
    };
  }

  private async executeListMeetingReports(
    context: AgentToolContext,
    input: ListMeetingReportsInput
  ): Promise<AgentToolExecutionResult> {
    const result = await this.meetingService.listReports(
      context.currentUserId,
      context.workspaceId,
      input
    );
    const selectedReports =
      input.limit === undefined ? result.reports : result.reports.slice(0, input.limit);
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
      resourceRefs: actionItems.map((item) => ({
        domain: "meeting",
        resourceType: "meeting_report_action_item",
        resourceId: item.actionItemId,
        label: item.title ?? undefined,
        status: item.status
      })),
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
    return this.actionItemExecutionResult(result.actionItem, "updated");
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
    return this.actionItemExecutionResult(result.actionItem, "dismissed");
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
      status: result.status
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

  private async buildStartMeetingConfirmation(
    context: AgentToolContext,
    input: StartMeetingInput
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
    input: JoinMeetingInput
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
    action: string
  ): AgentToolExecutionResult {
    return {
      outputSummary: { action, actionItemId: item.id, title: this.boundText(item.title, ACTION_ITEM_TEXT_LIMIT), status: item.status },
      resourceRefs: [{ domain: "meeting", resourceType: "meeting_report_action_item", resourceId: item.id, label: item.title, status: item.status }],
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
    input: StartMeetingInput
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
    input: JoinMeetingInput
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

  private validateListInput(input: unknown): ListMeetingReportsInput {
    const draft = input ?? {};
    const object = this.requirePlainObject(draft, "Meeting report list input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(
      object,
      LIST_INPUT_FIELDS,
      "Meeting report list input"
    );

    return {
      status: this.readOptionalStatus(object.status),
      limit: this.readOptionalLimit(object.limit)
    };
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
    return {
      meetingRoomId: this.requireMeetingId(object.meetingRoomId),
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
    return {
      meetingId: this.requireMeetingId(object.meetingId),
      ...(object.recordingConsent === undefined
        ? {}
        : {
            recordingConsent: this.validateRecordingConsent(
              object.recordingConsent
            )
          })
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

  private validateUpdateActionItemInput(input: unknown): UpdateActionItemInput {
    const object = this.requirePlainObject(input, "Meeting action item update input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(object, UPDATE_ACTION_ITEM_INPUT_FIELDS, "Meeting action item update input");
    const base = this.validateActionItemInput({ reportId: object.reportId, actionItemId: object.actionItemId });
    const title = object.title === undefined ? undefined : this.requireBoundedString(object.title, "title", 500);
    const description = object.description === undefined ? undefined : this.requireBoundedString(object.description, "description", 5000);
    const priority = object.priority === undefined ? undefined : this.requirePriority(object.priority);
    const assigneeUserId = object.assigneeUserId === undefined ? undefined : object.assigneeUserId === null ? null : this.requireActionItemId(object.assigneeUserId);
    if (title === undefined && description === undefined && priority === undefined && assigneeUserId === undefined) {
      throw badRequest("Meeting action item update requires at least one change");
    }
    return { ...base, ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }), ...(priority === undefined ? {} : { priority }), ...(assigneeUserId === undefined ? {} : { assigneeUserId }) };
  }

  private validateApproveActionItemInput(input: unknown): ApproveActionItemInput {
    const object = this.requirePlainObject(input, "Meeting action item approval input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(object, APPROVE_ACTION_ITEM_INPUT_FIELDS, "Meeting action item approval input");
    const base = this.validateActionItemInput({ reportId: object.reportId, actionItemId: object.actionItemId });
    const deliveryObject = this.requirePlainObject(object.delivery, "delivery");
    const deliveryType = deliveryObject.deliveryType;
    if (deliveryType === "calendar_event") {
      const calendar = this.requirePlainObject(deliveryObject.calendar, "delivery.calendar");
      this.assertOnlyAllowedFields(deliveryObject, ["deliveryType", "calendar"], "delivery");
      this.assertOnlyAllowedFields(calendar, ["title", "description", "color", "isAllDay", "startDate", "endDate", "startTime", "endTime"], "delivery.calendar");
      return {
        ...base,
        delivery: {
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
        }
      };
    }
    if (deliveryType === "pilo_issue") {
      const issue = this.requirePlainObject(deliveryObject.issue, "delivery.issue");
      this.assertOnlyAllowedFields(deliveryObject, ["deliveryType", "issue"], "delivery");
      this.assertOnlyAllowedFields(issue, ["boardId", "columnId", "title", "body"], "delivery.issue");
      return {
        ...base,
        delivery: {
          deliveryType,
          issue: {
            boardId: this.requireActionItemId(issue.boardId),
            columnId: this.requireActionItemId(issue.columnId),
            ...(issue.title === undefined ? {} : { title: this.requireBoundedString(issue.title, "issue.title", 255) }),
            ...(issue.body === undefined ? {} : { body: this.requireBoundedString(issue.body, "issue.body", 65535) })
          }
        }
      };
    }
    throw badRequest("delivery.deliveryType must be calendar_event or pilo_issue");
  }

  private validateDecisionEvidenceInput(input: unknown): DecisionEvidenceInput {
    const object = this.requirePlainObject(input, "Meeting decision evidence input");
    this.rejectForbiddenMeetingToolFields(object);
    this.assertOnlyAllowedFields(object, DECISION_EVIDENCE_INPUT_FIELDS, "Meeting decision evidence input");
    const decisionIndex = object.decisionIndex;
    if (decisionIndex !== undefined && (!Number.isInteger(decisionIndex) || (decisionIndex as number) < 0)) {
      throw badRequest("decisionIndex must be a non-negative integer");
    }
    return { reportId: this.requireReportId(object.reportId), ...(decisionIndex === undefined ? {} : { decisionIndex: decisionIndex as number }) };
  }

  private actionItemPatch(input: UpdateActionItemInput): AgentJsonObject {
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

  private requireReportId(value: unknown): string {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      throw badRequest("reportId must be a valid UUID");
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
