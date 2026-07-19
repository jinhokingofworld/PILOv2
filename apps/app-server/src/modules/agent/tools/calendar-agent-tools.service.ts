import { Injectable } from "@nestjs/common";
import { badRequest } from "../../../common/api-error";
import {
  CalendarEventPayload,
  CalendarService
} from "../../calendar/calendar.service";
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

interface ListCalendarEventsInput {
  start: string;
  end: string;
}

interface CreateCalendarEventInput {
  title: string;
  description: string | null;
  color: string;
  isAllDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
}

interface UpdateCalendarEventInput {
  target: CalendarEventTarget;
  changes: Partial<CreateCalendarEventInput>;
}

interface ResolvedUpdateCalendarEventInput {
  eventId: string;
  changes: Partial<CreateCalendarEventInput>;
  expectedUpdatedAt: string;
}

interface CalendarEventTarget {
  title: string;
  startDate: string;
  endDate: string;
  isAllDay?: boolean;
  startTime?: string;
  endTime?: string;
}

const DEFAULT_COLOR = "#3B82F6";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const FORBIDDEN_CALENDAR_BODY_FIELDS = [
  "workspaceId",
  "userId",
  "currentUserId",
  "createdBy",
  "requestedByUserId"
];
const LIST_INPUT_FIELDS = ["start", "end"];
const CREATE_INPUT_FIELDS = [
  "title",
  "description",
  "color",
  "isAllDay",
  "startDate",
  "endDate",
  "startTime",
  "endTime"
];
const UPDATE_INPUT_FIELDS = ["target", "changes"];
const RESOLVED_UPDATE_INPUT_FIELDS = [
  "eventId",
  "changes",
  "expectedUpdatedAt"
];
const UPDATE_TARGET_FIELDS = [
  "title",
  "startDate",
  "endDate",
  "isAllDay",
  "startTime",
  "endTime"
];

@Injectable()
export class CalendarAgentToolsService {
  constructor(private readonly calendarService: CalendarService) {}

  listDefinitions(): AgentToolDefinition<unknown>[] {
    return [
      this.listCalendarEventsDefinition(),
      this.createCalendarEventDefinition(),
      this.updateCalendarEventDefinition()
    ];
  }

  private listCalendarEventsDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "list_calendar_events",
      description:
        "Calendar 일정 목록을 날짜 범위 기준으로 조회합니다. 제목·키워드·참석자·현재 시각 필터는 지원하지 않습니다.",
      riskLevel: "low",
      executionMode: "auto",
      inputSchema: {
        type: "object",
        required: ["start", "end"],
        additionalProperties: false,
        properties: {
          start: {
            type: "string",
            format: "date",
            description: "조회 시작일. YYYY-MM-DD"
          },
          end: {
            type: "string",
            format: "date",
            description: "조회 종료일. YYYY-MM-DD"
          }
        }
      },
      validateInput: (input) => this.validateListInput(input),
      execute: (context, input) =>
        this.executeListCalendarEvents(context, this.validateListInput(input))
    };
  }

  private createCalendarEventDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "create_calendar_event",
      description:
        "Calendar 일정을 생성합니다. 실행 전 confirmation이 필요합니다. 종료 날짜가 없으면 시작 날짜와 같게, 시간 일정의 종료 시각이 없으면 시작 시각 1시간 뒤로 정규화합니다. 종일 일정에는 시간을 넣지 않습니다. 반복 일정은 지원하지 않습니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: {
        type: "object",
        required: ["title", "startDate"],
        additionalProperties: false,
        properties: {
          title: {
            type: "string",
            maxLength: 255
          },
          description: {
            type: ["string", "null"]
          },
          color: {
            type: "string",
            pattern: "^#[0-9a-fA-F]{6}$"
          },
          isAllDay: {
            type: "boolean"
          },
          startDate: {
            type: "string",
            format: "date"
          },
          endDate: {
            type: "string",
            format: "date"
          },
          startTime: {
            type: ["string", "null"],
            pattern: "^([01]\\d|2[0-3]):([0-5]\\d)$"
          },
          endTime: {
            type: ["string", "null"],
            pattern: "^([01]\\d|2[0-3]):([0-5]\\d)$"
          }
        }
      },
      validateInput: (input) => this.validateCreateInput(input),
      buildConfirmation: (_context, input) =>
        this.buildCreateConfirmation(this.validateCreateInput(input)),
      execute: (context, input) =>
        this.executeCreateCalendarEvent(context, this.validateCreateInput(input))
    };
  }

  private updateCalendarEventDefinition(): AgentToolDefinition<unknown> {
    return {
      name: "update_calendar_event",
      description:
        "Calendar 일정을 제목과 명시적 대상 날짜로 정확히 찾아 변경값으로 수정합니다. eventId를 입력하거나 노출하지 않습니다. 후보가 정확히 하나일 때만 현재값을 확인해 confirmation을 만들며, 후보가 없거나 여러 개면 수정하지 않고 더 구체적인 정보를 요청합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: {
        type: "object",
        required: ["target", "changes"],
        additionalProperties: false,
        properties: {
          target: {
            type: "object",
            required: ["title", "startDate", "endDate"],
            additionalProperties: false,
            properties: {
              title: {
                type: "string",
                minLength: 1,
                maxLength: 255
              },
              startDate: {
                type: "string",
                format: "date"
              },
              endDate: {
                type: "string",
                format: "date"
              },
              isAllDay: {
                type: "boolean"
              },
              startTime: {
                type: "string",
                pattern: "^([01]\\d|2[0-3]):([0-5]\\d)$"
              },
              endTime: {
                type: "string",
                pattern: "^([01]\\d|2[0-3]):([0-5]\\d)$"
              }
            }
          },
          changes: {
            type: "object",
            minProperties: 1
          }
        }
      },
      validateInput: (input) => this.validateUpdateInput(input),
      buildConfirmationInput: (plan) => this.buildResolvedUpdateInput(plan),
      validateConfirmationInput: (input) =>
        this.validateResolvedUpdateInput(input),
      buildConfirmation: (context, input) =>
        this.buildUpdateConfirmation(
          context,
          this.validateUpdateInput(input)
        ),
      execute: (context, input) =>
        this.executeUpdateCalendarEvent(
          context,
          this.validateResolvedUpdateInput(input)
        )
    };
  }

  private async executeListCalendarEvents(
    context: AgentToolContext,
    input: ListCalendarEventsInput
  ): Promise<AgentToolExecutionResult> {
    const events = await this.calendarService.listEvents(
      context.currentUserId,
      context.workspaceId,
      input
    );

    return {
      outputSummary: {
        start: input.start,
        end: input.end,
        count: events.length,
        events: events.map((event) => this.summarizeEvent(event))
      },
      resourceRefs: events.map((event) => this.toResourceRef(event)),
      status: "completed"
    };
  }

  private async executeCreateCalendarEvent(
    context: AgentToolContext,
    input: CreateCalendarEventInput
  ): Promise<AgentToolExecutionResult> {
    const event = await this.calendarService.createEvent(
      context.currentUserId,
      context.workspaceId,
      this.toCalendarBody(input)
    );

    return {
      outputSummary: {
        action: "created",
        event: this.summarizeEvent(event)
      },
      resourceRefs: [this.toResourceRef(event, "created")],
      status: "created"
    };
  }

  private async executeUpdateCalendarEvent(
    context: AgentToolContext,
    input: ResolvedUpdateCalendarEventInput
  ): Promise<AgentToolExecutionResult> {
    const event = await this.calendarService.updateEvent(
      context.currentUserId,
      context.workspaceId,
      input.eventId,
      this.toCalendarBody(input.changes),
      { expectedUpdatedAt: input.expectedUpdatedAt }
    );

    return {
      outputSummary: {
        action: "updated",
        event: this.summarizeEvent(event)
      },
      resourceRefs: [this.toResourceRef(event, "updated")],
      status: "updated"
    };
  }

  private buildCreateConfirmation(
    input: CreateCalendarEventInput
  ): AgentConfirmationPlan {
    return {
      toolName: "create_calendar_event",
      summary: `${this.formatDraftTime(input)}에 ${input.title} 일정을 생성합니다.`,
      target: {
        domain: "calendar",
        resourceType: "event"
      },
      before: null,
      after: this.toCalendarBody(input),
      call: {
        service: "CalendarService.createEvent",
        method: "POST",
        path: "/api/v1/workspaces/{workspaceId}/calendar/events",
        body: this.toCalendarBody(input)
      }
    };
  }

  private async buildUpdateConfirmation(
    context: AgentToolContext,
    input: UpdateCalendarEventInput
  ): Promise<AgentConfirmationPlan | AgentToolClarificationResult> {
    const candidates = (
      await this.calendarService.listEvents(
        context.currentUserId,
        context.workspaceId,
        {
          start: input.target.startDate,
          end: input.target.endDate
        }
      )
    ).filter((event) => this.matchesTarget(event, input.target));

    if (candidates.length !== 1) {
      return this.buildUpdateClarification(input.target, candidates);
    }

    const event = await this.calendarService.getEvent(
      context.currentUserId,
      context.workspaceId,
      String(candidates[0].id)
    );

    if (!this.matchesTarget(event, input.target)) {
      return this.buildUpdateClarification(input.target, []);
    }

    return {
      toolName: "update_calendar_event",
      summary: `${event.title} 일정을 수정합니다.`,
      target: {
        domain: "calendar",
        resourceType: "event",
        resourceId: String(event.id)
      },
      before: this.toConfirmationBefore(event),
      after: this.toCalendarBody(input.changes),
      call: {
        service: "CalendarService.updateEvent",
        method: "PATCH",
        path: "/api/v1/workspaces/{workspaceId}/calendar/events/{eventId}",
        eventId: String(event.id),
        expectedUpdatedAt: event.updatedAt,
        body: this.toCalendarBody(input.changes)
      }
    };
  }

  private buildResolvedUpdateInput(plan: AgentConfirmationPlan): AgentJsonObject {
    if (plan.toolName !== "update_calendar_event" || !("after" in plan)) {
      throw badRequest("Calendar update confirmation plan is invalid");
    }

    const resolved = this.validateResolvedUpdateInput({
      eventId: plan.call.eventId,
      changes: plan.after,
      expectedUpdatedAt: plan.call.expectedUpdatedAt
    });

    return {
      eventId: resolved.eventId,
      changes: resolved.changes as AgentJsonObject,
      expectedUpdatedAt: resolved.expectedUpdatedAt
    };
  }

  private validateListInput(input: unknown): ListCalendarEventsInput {
    const draft = this.requirePlainObject(input, "Calendar list input");
    this.rejectForbiddenCalendarBodyFields(draft);
    this.assertOnlyAllowedFields(draft, LIST_INPUT_FIELDS, "Calendar list input");

    const start = this.requireDate(draft.start, "start");
    const end = this.requireDate(draft.end, "end");
    this.assertDateOrder(start, end);

    return {
      start,
      end
    };
  }

  private validateCreateInput(input: unknown): CreateCalendarEventInput {
    const draft = this.requirePlainObject(input, "Calendar create input");
    this.rejectForbiddenCalendarBodyFields(draft);
    this.assertOnlyAllowedFields(
      draft,
      CREATE_INPUT_FIELDS,
      "Calendar create input"
    );

    const startDate = this.requireDate(draft.startDate, "startDate");
    const startTime = this.readOptionalNullableTime(draft, "startTime");
    const endTime = this.readOptionalNullableTime(draft, "endTime");
    const isAllDay = this.resolveCreateIsAllDay(draft, startTime, endTime);

    this.assertScheduleTimeFields({
      isAllDay,
      startTime,
      endTime,
      label: "Calendar create input"
    });

    return this.calendarService.normalizeCreateEventInput({
      ...draft,
      isAllDay,
      endDate: draft.endDate ?? startDate
    });
  }

  private validateUpdateInput(input: unknown): UpdateCalendarEventInput {
    const draft = this.requirePlainObject(input, "Calendar update input");
    const target = this.requirePlainObject(
      draft.target,
      "Calendar update target"
    );
    const changes = this.requirePlainObject(
      draft.changes,
      "Calendar update changes"
    );
    this.rejectForbiddenCalendarBodyFields(draft);
    this.rejectForbiddenCalendarBodyFields(target);
    this.rejectForbiddenCalendarBodyFields(changes);
    this.assertOnlyAllowedFields(
      draft,
      UPDATE_INPUT_FIELDS,
      "Calendar update input"
    );
    this.assertOnlyAllowedFields(
      target,
      UPDATE_TARGET_FIELDS,
      "Calendar update target"
    );
    this.assertOnlyAllowedFields(
      changes,
      CREATE_INPUT_FIELDS,
      "Calendar update changes"
    );

    if (Object.keys(changes).length === 0) {
      throw badRequest("Calendar update changes are required");
    }

    return {
      target: this.validateUpdateTarget(target),
      changes: this.validateUpdateChanges(changes)
    };
  }

  private validateResolvedUpdateInput(
    input: unknown
  ): ResolvedUpdateCalendarEventInput {
    const draft = this.requirePlainObject(input, "Resolved Calendar update input");
    const changes = this.requirePlainObject(
      draft.changes,
      "Resolved Calendar update changes"
    );
    this.rejectForbiddenCalendarBodyFields(draft);
    this.rejectForbiddenCalendarBodyFields(changes);
    this.assertOnlyAllowedFields(
      draft,
      RESOLVED_UPDATE_INPUT_FIELDS,
      "Resolved Calendar update input"
    );
    this.assertOnlyAllowedFields(
      changes,
      CREATE_INPUT_FIELDS,
      "Resolved Calendar update changes"
    );
    if (Object.keys(changes).length === 0) {
      throw badRequest("Calendar update changes are required");
    }

    return {
      eventId: this.requireEventId(draft.eventId),
      changes: this.validateUpdateChanges(changes),
      expectedUpdatedAt: this.requireIsoTimestamp(
        draft.expectedUpdatedAt,
        "expectedUpdatedAt"
      )
    };
  }

  private validateUpdateTarget(input: AgentJsonObject): CalendarEventTarget {
    const startDate = this.requireDate(input.startDate, "target.startDate");
    const endDate = this.requireDate(input.endDate, "target.endDate");
    this.assertDateOrder(startDate, endDate);
    const isAllDay = this.readOptionalBoolean(input, "isAllDay");
    const startTime = this.readOptionalTime(input, "startTime");
    const endTime = this.readOptionalTime(input, "endTime");

    if (isAllDay === true && (startTime || endTime)) {
      throw badRequest("Calendar update target must not include time for all-day events");
    }

    return {
      title: this.requireTitle(input.title),
      startDate,
      endDate,
      ...(isAllDay === undefined ? {} : { isAllDay }),
      ...(startTime === undefined ? {} : { startTime }),
      ...(endTime === undefined ? {} : { endTime })
    };
  }

  private buildUpdateClarification(
    target: CalendarEventTarget,
    candidates: CalendarEventPayload[]
  ): AgentToolClarificationResult {
    return {
      kind: "needs_clarification",
      outputSummary: {
        status: "needs_clarification",
        selection: candidates.length === 0 ? "none" : "multiple",
        target: this.summarizeTarget(target),
        candidateCount: candidates.length
      },
      resourceRefs: candidates.map((event) => this.toResourceRef(event))
    };
  }

  private matchesTarget(
    event: CalendarEventPayload,
    target: CalendarEventTarget
  ): boolean {
    return (
      this.normalizeTitle(event.title) === this.normalizeTitle(target.title) &&
      event.startDate === target.startDate &&
      event.endDate === target.endDate &&
      (target.isAllDay === undefined || event.isAllDay === target.isAllDay) &&
      (target.startTime === undefined || event.startTime === target.startTime) &&
      (target.endTime === undefined || event.endTime === target.endTime)
    );
  }

  private summarizeTarget(target: CalendarEventTarget): AgentJsonObject {
    return {
      title: target.title,
      startDate: target.startDate,
      endDate: target.endDate,
      ...(target.isAllDay === undefined ? {} : { isAllDay: target.isAllDay }),
      ...(target.startTime === undefined ? {} : { startTime: target.startTime }),
      ...(target.endTime === undefined ? {} : { endTime: target.endTime })
    };
  }

  private normalizeTitle(title: string): string {
    return title.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
  }

  private validateUpdateChanges(
    input: AgentJsonObject
  ): Partial<CreateCalendarEventInput> {
    const changes: Partial<CreateCalendarEventInput> = {};

    if (input.title !== undefined) {
      changes.title = this.requireTitle(input.title);
    }

    if (input.description !== undefined) {
      changes.description = this.readOptionalNullableString(input, "description");
    }

    if (input.color !== undefined) {
      changes.color = this.readOptionalColor(input.color) ?? DEFAULT_COLOR;
    }

    if (input.isAllDay !== undefined) {
      changes.isAllDay = this.requireBoolean(input.isAllDay, "isAllDay");
    }

    if (input.startDate !== undefined) {
      changes.startDate = this.requireDate(input.startDate, "startDate");
    }

    if (input.endDate !== undefined) {
      changes.endDate = this.requireDate(input.endDate, "endDate");
    }

    if (
      changes.startDate !== undefined &&
      changes.endDate !== undefined
    ) {
      this.assertDateOrder(changes.startDate, changes.endDate);
    }

    if (input.startTime !== undefined) {
      changes.startTime = this.readOptionalNullableTime(input, "startTime");
    }

    if (input.endTime !== undefined) {
      changes.endTime = this.readOptionalNullableTime(input, "endTime");
    }

    if (changes.isAllDay !== undefined) {
      this.assertScheduleTimeFields({
        isAllDay: changes.isAllDay,
        startTime: changes.startTime ?? null,
        endTime: changes.endTime ?? null,
        label: "Calendar update changes"
      });
    }

    return changes;
  }

  private toCalendarBody(
    input: Partial<CreateCalendarEventInput>
  ): AgentJsonObject {
    const body: AgentJsonObject = {};

    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) {
        body[key] = value;
      }
    }

    return body;
  }

  private summarizeEvent(event: CalendarEventPayload): AgentJsonObject {
    return {
      id: event.id,
      title: event.title,
      isAllDay: event.isAllDay,
      startDate: event.startDate,
      endDate: event.endDate,
      startTime: event.startTime,
      endTime: event.endTime,
      status: "available"
    };
  }

  private toConfirmationBefore(event: CalendarEventPayload): AgentJsonObject {
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      color: event.color,
      isAllDay: event.isAllDay,
      startDate: event.startDate,
      endDate: event.endDate,
      startTime: event.startTime,
      endTime: event.endTime
    };
  }

  private toResourceRef(
    event: CalendarEventPayload,
    status = "available"
  ): AgentResourceRef {
    return {
      domain: "calendar",
      resourceType: "event",
      resourceId: String(event.id),
      label: event.title,
      status,
      metadata: {
        startDate: event.startDate,
        endDate: event.endDate,
        startTime: event.startTime,
        endTime: event.endTime
      }
    };
  }

  private formatDraftTime(input: CreateCalendarEventInput): string {
    if (input.isAllDay) {
      return input.startDate === input.endDate
        ? `${input.startDate} 종일`
        : `${input.startDate}부터 ${input.endDate}까지 종일`;
    }

    const start = `${input.startDate} ${input.startTime ?? ""}`.trim();
    const end = input.endTime
      ? `${input.endDate} ${input.endTime}`.trim()
      : "Calendar 기본 종료 시간";

    return `${start}-${end}`;
  }

  private requirePlainObject(input: unknown, label: string): AgentJsonObject {
    if (!this.isPlainObject(input)) {
      throw badRequest(`${label} must be an object`);
    }

    return input;
  }

  private requireIsoTimestamp(input: unknown, field: string): string {
    if (typeof input !== "string") {
      throw badRequest(`${field} is required`);
    }

    const date = new Date(input);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== input) {
      throw badRequest(`${field} must be an ISO 8601 timestamp`);
    }

    return input;
  }

  private rejectForbiddenCalendarBodyFields(input: AgentJsonObject): void {
    for (const field of FORBIDDEN_CALENDAR_BODY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(input, field)) {
        throw badRequest(`${field} must not be provided to Calendar tools`);
      }
    }
  }

  private assertOnlyAllowedFields(
    input: AgentJsonObject,
    allowedFields: string[],
    label: string
  ): void {
    const allowed = new Set(allowedFields);

    for (const field of Object.keys(input)) {
      if (!allowed.has(field)) {
        throw badRequest(`${label}.${field} is not supported`);
      }
    }
  }

  private requireTitle(input: unknown): string {
    if (typeof input !== "string") {
      throw badRequest("title is required");
    }

    const title = input.trim();
    if (!title) {
      throw badRequest("title is required");
    }

    if (title.length > 255) {
      throw badRequest("title must be 255 characters or less");
    }

    return title;
  }

  private readOptionalNullableString(
    input: AgentJsonObject,
    field: string
  ): string | null {
    const value = input[field];
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== "string") {
      throw badRequest(`${field} must be a string`);
    }

    return value;
  }

  private readOptionalBoolean(
    input: AgentJsonObject,
    field: string
  ): boolean | undefined {
    const value = input[field];
    if (value === undefined) {
      return undefined;
    }

    return this.requireBoolean(value, field);
  }

  private requireBoolean(input: AgentJsonValue, field: string): boolean {
    if (typeof input !== "boolean") {
      throw badRequest(`${field} must be a boolean`);
    }

    return input;
  }

  private resolveCreateIsAllDay(
    input: AgentJsonObject,
    startTime: string | null,
    endTime: string | null
  ): boolean {
    const provided = this.readOptionalBoolean(input, "isAllDay");

    if (provided !== undefined) {
      return provided;
    }

    return startTime !== null || endTime !== null ? false : true;
  }

  private assertScheduleTimeFields(input: {
    isAllDay: boolean;
    startTime: string | null;
    endTime: string | null;
    label: string;
  }): void {
    if (input.isAllDay) {
      if (input.startTime !== null || input.endTime !== null) {
        throw badRequest(`${input.label} must not include time for all-day events`);
      }

      return;
    }

    if (!input.startTime) {
      throw badRequest(`${input.label}.startTime is required for timed events`);
    }
  }

  private assertTimedScheduleOrder(input: {
    startDate: string;
    endDate: string;
    startTime: string | null;
    endTime: string | null;
    label: string;
  }): void {
    if (
      input.startDate === input.endDate &&
      input.startTime !== null &&
      input.endTime !== null &&
      input.endTime <= input.startTime
    ) {
      throw badRequest(`${input.label}.endTime must be later than startTime`);
    }
  }

  private readOptionalColor(input: unknown): string | undefined {
    if (input === undefined) {
      return undefined;
    }

    if (typeof input !== "string" || !COLOR_PATTERN.test(input)) {
      throw badRequest("color must be a hex color like #3B82F6");
    }

    return input;
  }

  private readOptionalNullableTime(
    input: AgentJsonObject,
    field: string
  ): string | null {
    const value = input[field];
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== "string" || !TIME_PATTERN.test(value)) {
      throw badRequest(`${field} must use HH:mm format`);
    }

    return value;
  }

  private readOptionalTime(
    input: AgentJsonObject,
    field: string
  ): string | undefined {
    const value = input[field];
    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== "string" || !TIME_PATTERN.test(value)) {
      throw badRequest(`${field} must use HH:mm format`);
    }

    return value;
  }

  private requireDate(input: unknown, field: string): string {
    if (typeof input !== "string" || !DATE_PATTERN.test(input)) {
      throw badRequest(`${field} must use YYYY-MM-DD format`);
    }

    const [year, month, day] = input.split("-").map((part) => Number(part));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw badRequest(`${field} must be a valid date`);
    }

    return input;
  }

  private assertDateOrder(startDate: string, endDate: string): void {
    if (endDate < startDate) {
      throw badRequest("endDate must be on or after startDate");
    }
  }

  private requireEventId(input: unknown): string {
    if (typeof input !== "string" || !/^[1-9][0-9]*$/.test(input)) {
      throw badRequest("eventId must be a positive integer string");
    }

    return input;
  }

  private isPlainObject(input: unknown): input is AgentJsonObject {
    return Boolean(input) && typeof input === "object" && !Array.isArray(input);
  }

}
