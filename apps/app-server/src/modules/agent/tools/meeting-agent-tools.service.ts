import { Injectable } from "@nestjs/common";
import { badRequest } from "../../../common/api-error";
import {
  MeetingReportDetailPayload,
  MeetingReportSummaryPayload,
  MeetingService
} from "../../meeting/meeting.service";
import type {
  AgentJsonObject,
  AgentJsonValue,
  AgentResourceRef,
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

@Injectable()
export class MeetingAgentToolsService {
  constructor(private readonly meetingService: MeetingService) {}

  listDefinitions(): AgentToolDefinition<unknown>[] {
    return [
      this.listMeetingReportsDefinition(),
      this.getMeetingReportDefinition(),
      this.summarizeMeetingReportDefinition()
    ];
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
    const reports = result.reports.map((report) =>
      this.normalizeMeetingReportForAgent(report, {
        sectionTextLimit: LIST_SECTION_TEXT_LIMIT
      })
    );

    return {
      outputSummary: {
        count: reports.length,
        reports
      },
      resourceRefs: result.reports.map((report) => this.toResourceRef(report)),
      status: "completed"
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
