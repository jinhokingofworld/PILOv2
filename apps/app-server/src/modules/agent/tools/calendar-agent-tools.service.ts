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
  eventId: string;
  changes: Partial<CreateCalendarEventInput>;
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
const UPDATE_INPUT_FIELDS = ["eventId", "changes"];

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
        "Calendar 일정을 생성합니다. 실행 전 confirmation이 필요합니다. 반복 일정은 지원하지 않습니다. 여러 날짜 일정은 종일 여부를 명시하거나 시간을 제공해야 합니다. 종료 시각이 없으면 생략하고, 시작·종료 시각이 같거나 역전되면 추가 정보를 요청합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: {
        type: "object",
        required: ["title", "startDate", "endDate"],
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
        "Calendar 일정을 사용자가 제공한 양의 정수 eventId와 변경값으로 수정합니다. 현재값과 Workspace 접근은 서버가 조회하며 실행 전 confirmation이 필요합니다.",
      riskLevel: "medium",
      executionMode: "confirmation_required",
      inputSchema: {
        type: "object",
        required: ["eventId", "changes"],
        additionalProperties: false,
        properties: {
          eventId: {
            type: "string",
            pattern: "^[1-9][0-9]*$"
          },
          changes: {
            type: "object",
            minProperties: 1
          }
        }
      },
      validateInput: (input) => this.validateUpdateInput(input),
      buildConfirmation: (context, input) =>
        this.buildUpdateConfirmation(
          context,
          this.validateUpdateInput(input)
        ),
      execute: (context, input) =>
        this.executeUpdateCalendarEvent(context, this.validateUpdateInput(input))
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
    input: UpdateCalendarEventInput
  ): Promise<AgentToolExecutionResult> {
    const event = await this.calendarService.updateEvent(
      context.currentUserId,
      context.workspaceId,
      input.eventId,
      this.toCalendarBody(input.changes)
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
  ): Promise<AgentConfirmationPlan> {
    const event = await this.calendarService.getEvent(
      context.currentUserId,
      context.workspaceId,
      input.eventId
    );

    return {
      toolName: "update_calendar_event",
      summary: `Calendar 일정 #${input.eventId}을 수정합니다.`,
      target: {
        domain: "calendar",
        resourceType: "event",
        resourceId: input.eventId
      },
      before: this.toConfirmationBefore(event),
      after: this.toCalendarBody(input.changes),
      call: {
        service: "CalendarService.updateEvent",
        method: "PATCH",
        path: "/api/v1/workspaces/{workspaceId}/calendar/events/{eventId}",
        eventId: input.eventId,
        body: this.toCalendarBody(input.changes)
      }
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
    const endDate = this.requireDate(draft.endDate, "endDate");
    const startTime = this.readOptionalNullableTime(draft, "startTime");
    const endTime = this.readOptionalNullableTime(draft, "endTime");
    const isAllDay = this.resolveCreateIsAllDay(draft, startTime, endTime);

    this.assertDateOrder(startDate, endDate);
    this.assertScheduleTimeFields({
      isAllDay,
      startTime,
      endTime,
      label: "Calendar create input"
    });
    this.assertTimedScheduleOrder({
      startDate,
      endDate,
      startTime,
      endTime,
      label: "Calendar create input"
    });

    return {
      title: this.requireTitle(draft.title),
      description: this.readOptionalNullableString(draft, "description"),
      color: this.readOptionalColor(draft.color) ?? DEFAULT_COLOR,
      isAllDay,
      startDate,
      endDate,
      startTime,
      endTime
    };
  }

  private validateUpdateInput(input: unknown): UpdateCalendarEventInput {
    const draft = this.requirePlainObject(input, "Calendar update input");
    const changes = this.requirePlainObject(
      draft.changes,
      "Calendar update changes"
    );
    this.rejectForbiddenCalendarBodyFields(draft);
    this.rejectForbiddenCalendarBodyFields(changes);
    this.assertOnlyAllowedFields(
      draft,
      UPDATE_INPUT_FIELDS,
      "Calendar update input"
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
      eventId: this.requireEventId(draft.eventId),
      changes: this.validateUpdateChanges(changes)
    };
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
