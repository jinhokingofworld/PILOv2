import { Injectable, Optional } from "@nestjs/common";
import { QueryResultRow } from "pg";
import { ActivityLogService } from "../../common/activity-log.service";
import { badRequest, conflict, notFound } from "../../common/api-error";
import {
  DatabaseService,
  DatabaseTransaction
} from "../../database/database.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { GoogleCalendarSyncService } from "./google-calendar-sync.service";

interface CalendarEventRow extends QueryResultRow {
  id: string | number;
  title: string;
  description: string | null;
  color: string;
  is_all_day: boolean;
  start_date: Date | string;
  end_date: Date | string;
  start_time: string | null;
  end_time: string | null;
  created_by: string;
  created_by_user_name: string | null;
  created_by_user_avatar_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  google_sync_status: "active" | "disconnected" | "failed" | null;
  google_sync_google_event_id: string | null;
  google_sync_last_error: string | null;
}

export interface NormalizedCalendarEventInput {
  title: string;
  description: string | null;
  color: string;
  isAllDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
}

interface ListCalendarEventsQuery {
  start?: string;
  end?: string;
}

interface CalendarEventDraft {
  title?: string;
  description?: string | null;
  color?: string;
  isAllDay?: boolean;
  startDate?: string;
  endDate?: string;
  startTime?: string | null;
  endTime?: string | null;
}

export interface CalendarEventPayload {
  id: number;
  title: string;
  description: string | null;
  color: string;
  isAllDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  createdBy: string;
  createdByUser: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  };
  createdAt: string;
  updatedAt: string;
  googleSync: {
    status: "pending" | "synced" | "failed";
    lastError: string | null;
  } | null;
}

export interface CalendarEventUpdateOptions {
  expectedUpdatedAt?: string;
}

export interface DeleteCalendarEventPayload {
  id: number;
}

const DEFAULT_COLOR = "#3B82F6";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MAX_TITLE_LENGTH = 255;
const CALENDAR_ACTIVITY_LOG_FIELDS = [
  "title",
  "color",
  "isAllDay",
  "startDate",
  "endDate",
  "startTime",
  "endTime"
] as const;

type CalendarActivityLogField = (typeof CALENDAR_ACTIVITY_LOG_FIELDS)[number];
type CalendarActivityChangedField = CalendarActivityLogField | "description";
type CalendarActivityLogSnapshot = Record<CalendarActivityLogField, string | boolean | null>;

const CALENDAR_EVENT_SELECT = `
  SELECT
    calendar_events.id,
    calendar_events.title,
    calendar_events.description,
    calendar_events.color,
    calendar_events.is_all_day,
    calendar_events.start_date,
    calendar_events.end_date,
    calendar_events.start_time,
    calendar_events.end_time,
    calendar_events.created_by,
    users.name AS created_by_user_name,
    users.avatar_url AS created_by_user_avatar_url,
    calendar_events.created_at,
    calendar_events.updated_at,
    google_sync.status AS google_sync_status,
    google_sync.google_event_id AS google_sync_google_event_id,
    google_sync.last_error AS google_sync_last_error
  FROM calendar_events
  JOIN users ON users.id = calendar_events.created_by
  LEFT JOIN calendar_event_google_syncs AS google_sync
    ON google_sync.calendar_event_id = calendar_events.id
`;

@Injectable()
export class CalendarService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly activityLogService: ActivityLogService,
    @Optional() private readonly googleCalendarSyncService?: GoogleCalendarSyncService
  ) {}

  getModuleInfo() {
    return {
      domain: "calendar",
      apiContract: "docs/api/calendar-api.md"
    };
  }

  async listEvents(
    currentUserId: string,
    workspaceId: string,
    query: ListCalendarEventsQuery
  ): Promise<CalendarEventPayload[]> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const start = this.requireDate(query.start, "start");
    const end = this.requireDate(query.end, "end");
    this.assertDateOrder(start, end);

    const events = await this.database.query<CalendarEventRow>(
      `
        ${CALENDAR_EVENT_SELECT}
        WHERE calendar_events.workspace_id = $1
          AND calendar_events.start_date <= $3
          AND calendar_events.end_date >= $2
        ORDER BY
          calendar_events.start_date ASC,
          calendar_events.start_time ASC NULLS FIRST,
          calendar_events.id ASC
      `,
      [workspaceId, start, end]
    );

    return events.map((event) => this.mapEvent(event));
  }

  async getEvent(
    currentUserId: string,
    workspaceId: string,
    eventId: string
  ): Promise<CalendarEventPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const event = await this.findEvent(workspaceId, eventId);
    if (!event) {
      throw notFound("Calendar event not found");
    }

    return this.mapEvent(event);
  }

  async createEvent(
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<CalendarEventPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const input = this.normalizeCreateEventInput(body);
    const event = await this.database.transaction(async (transaction) => {
      return this.createNormalizedEventInTransaction(transaction, {
        currentUserId,
        workspaceId,
        input
      });
    });

    return this.mapEvent(event);
  }

  async createEventInTransaction(
    transaction: DatabaseTransaction,
    currentUserId: string,
    workspaceId: string,
    body: unknown
  ): Promise<CalendarEventPayload> {
    const input = this.normalizeCreateEventInput(body);
    const created = await this.createNormalizedEventInTransaction(transaction, {
      currentUserId,
      workspaceId,
      input
    });
    return this.mapEvent(created);
  }

  /**
   * Reuses the Calendar create contract for callers that must reject an
   * invalid event before they persist their own side-effect or retry state.
   */
  validateCreateEventInput(body: unknown): NormalizedCalendarEventInput {
    return this.normalizeCreateEventInput(body);
  }

  private async createNormalizedEventInTransaction(
    transaction: DatabaseTransaction,
    input: { currentUserId: string; workspaceId: string; input: NormalizedCalendarEventInput }
  ): Promise<CalendarEventRow> {
    const created = await this.insertCalendarEvent(transaction, input);
    if (!created) throw badRequest("Calendar event could not be created");
    await this.activityLogService.append(transaction, {
      workspaceId: input.workspaceId,
      actor: { type: "user", userId: input.currentUserId },
      action: "calendar_event_created",
      target: { type: "calendar_event", id: String(created.id) },
      dedupeKey: `calendar:calendar_event_created:${created.id}`,
      metadata: { version: 1, summary: "일정을 생성했습니다.", data: { title: created.title } }
    });
    return created;
  }

  private async insertCalendarEvent(
    transaction: DatabaseTransaction,
    input: {
      currentUserId: string;
      workspaceId: string;
      input: NormalizedCalendarEventInput;
    }
  ): Promise<CalendarEventRow | null> {
    return transaction.queryOne<CalendarEventRow>(
      `
        WITH inserted AS (
          INSERT INTO calendar_events (
            workspace_id,
            title,
            description,
            color,
            is_all_day,
            start_date,
            end_date,
            start_time,
            end_time,
            created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *
        )
        SELECT
          inserted.id,
          inserted.title,
          inserted.description,
          inserted.color,
          inserted.is_all_day,
          inserted.start_date,
          inserted.end_date,
          inserted.start_time,
          inserted.end_time,
          inserted.created_by,
          users.name AS created_by_user_name,
          users.avatar_url AS created_by_user_avatar_url,
          inserted.created_at,
          inserted.updated_at
        FROM inserted
        JOIN users ON users.id = inserted.created_by
      `,
      [
        input.workspaceId,
        input.input.title,
        input.input.description,
        input.input.color,
        input.input.isAllDay,
        input.input.startDate,
        input.input.endDate,
        input.input.startTime,
        input.input.endTime,
        input.currentUserId
      ]
    );
  }

  async updateEvent(
    currentUserId: string,
    workspaceId: string,
    eventId: string,
    body: unknown,
    options: CalendarEventUpdateOptions = {}
  ): Promise<CalendarEventPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const event = await this.database.transaction(async (transaction) => {
      const existing = await this.findEventInTransaction(
        transaction,
        workspaceId,
        eventId
      );
      if (!existing) {
        throw notFound("Calendar event not found");
      }

      if (
        options.expectedUpdatedAt !== undefined &&
        this.toIsoString(existing.updated_at) !== options.expectedUpdatedAt
      ) {
        throw conflict(
          "Calendar event changed; review the latest event before updating"
        );
      }

      const input = this.normalizeUpdateInput(body, existing);
      const updated = await transaction.queryOne<CalendarEventRow>(
        `
          WITH updated AS (
            UPDATE calendar_events
            SET
              title = $3,
              description = $4,
              color = $5,
              is_all_day = $6,
              start_date = $7,
              end_date = $8,
              start_time = $9,
              end_time = $10
            WHERE workspace_id = $1
              AND id = $2
            RETURNING *
          )
          SELECT
            updated.id,
            updated.title,
            updated.description,
            updated.color,
            updated.is_all_day,
            updated.start_date,
            updated.end_date,
            updated.start_time,
            updated.end_time,
            updated.created_by,
            users.name AS created_by_user_name,
            users.avatar_url AS created_by_user_avatar_url,
            updated.created_at,
            updated.updated_at
          FROM updated
          JOIN users ON users.id = updated.created_by
        `,
        [
          workspaceId,
          this.parseEventId(eventId),
          input.title,
          input.description,
          input.color,
          input.isAllDay,
          input.startDate,
          input.endDate,
          input.startTime,
          input.endTime
        ]
      );

      if (!updated) {
        throw notFound("Calendar event not found");
      }

      const activityLog = this.buildUpdatedActivityLog(
        currentUserId,
        workspaceId,
        existing,
        updated
      );
      if (activityLog) {
        await this.activityLogService.append(transaction, activityLog);
      }
      await this.googleCalendarSyncService?.enqueueUpdatedEventInTransaction(
        transaction,
        workspaceId,
        this.mapEvent(updated)
      );
      return updated;
    });

    return this.mapEvent(event);
  }

  async deleteEvent(
    currentUserId: string,
    workspaceId: string,
    eventId: string
  ): Promise<DeleteCalendarEventPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);

    const deleted = await this.database.transaction(async (transaction) => {
      const existing = await this.findEventInTransaction(
        transaction,
        workspaceId,
        eventId
      );
      if (!existing) {
        throw notFound("Calendar event not found");
      }

      await this.googleCalendarSyncService?.enqueueDeletedEventInTransaction(
        transaction,
        workspaceId,
        this.mapEvent(existing)
      );

      const removed = await transaction.queryOne<{ id: string | number }>(
        `
          DELETE FROM calendar_events
          WHERE workspace_id = $1
            AND id = $2
          RETURNING id
        `,
        [workspaceId, this.parseEventId(eventId)]
      );

      if (!removed) {
        throw notFound("Calendar event not found");
      }

      await this.activityLogService.append(
        transaction,
        this.buildDeletedActivityLog(currentUserId, workspaceId, existing)
      );
      return removed;
    });

    return {
      id: Number(deleted.id)
    };
  }

  private async findEvent(
    workspaceId: string,
    eventId: string
  ): Promise<CalendarEventRow | null> {
    return this.database.queryOne<CalendarEventRow>(
      `
        ${CALENDAR_EVENT_SELECT}
        WHERE calendar_events.workspace_id = $1
          AND calendar_events.id = $2
      `,
      [workspaceId, this.parseEventId(eventId)]
    );
  }

  private async findEventInTransaction(
    transaction: DatabaseTransaction,
    workspaceId: string,
    eventId: string
  ): Promise<CalendarEventRow | null> {
    return transaction.queryOne<CalendarEventRow>(
      `
        ${CALENDAR_EVENT_SELECT}
        WHERE calendar_events.workspace_id = $1
          AND calendar_events.id = $2
        FOR UPDATE OF calendar_events
      `,
      [workspaceId, this.parseEventId(eventId)]
    );
  }

  private buildUpdatedActivityLog(
    currentUserId: string,
    workspaceId: string,
    previous: CalendarEventRow,
    updated: CalendarEventRow
  ) {
    const beforeSnapshot = this.toActivityLogSnapshot(previous);
    const afterSnapshot = this.toActivityLogSnapshot(updated);
    const changedFields: CalendarActivityChangedField[] = CALENDAR_ACTIVITY_LOG_FIELDS.filter(
      (field) => beforeSnapshot[field] !== afterSnapshot[field]
    );
    if (previous.description !== updated.description) {
      changedFields.push("description");
    }
    if (changedFields.length === 0) {
      return null;
    }

    const before = Object.fromEntries(
      changedFields
        .filter((field) => field !== "description")
        .map((field) => [field, beforeSnapshot[field]])
    );
    const after = Object.fromEntries(
      changedFields
        .filter((field) => field !== "description")
        .map((field) => [field, afterSnapshot[field]])
    );

    return {
      workspaceId,
      actor: { type: "user" as const, userId: currentUserId },
      action: "calendar_event_updated" as const,
      target: { type: "calendar_event", id: String(updated.id) },
      dedupeKey: `calendar:calendar_event_updated:${updated.id}:${this.toIsoString(updated.updated_at)}`,
      metadata: {
        version: 1 as const,
        summary: `${updated.title} 일정을 변경했습니다.`,
        data: {
          title: updated.title,
          changedFields,
          before,
          after
        }
      }
    };
  }

  private buildDeletedActivityLog(
    currentUserId: string,
    workspaceId: string,
    event: CalendarEventRow
  ) {
    return {
      workspaceId,
      actor: { type: "user" as const, userId: currentUserId },
      action: "calendar_event_deleted" as const,
      target: { type: "calendar_event", id: String(event.id) },
      dedupeKey: `calendar:calendar_event_deleted:${event.id}:${this.toIsoString(event.updated_at)}`,
      metadata: {
        version: 1 as const,
        summary: `${event.title} 일정을 삭제했습니다.`,
        data: { title: event.title }
      }
    };
  }

  private toActivityLogSnapshot(
    event: CalendarEventRow
  ): CalendarActivityLogSnapshot {
    return {
      title: event.title,
      color: event.color,
      isAllDay: event.is_all_day,
      startDate: this.toDateString(event.start_date),
      endDate: this.toDateString(event.end_date),
      startTime: this.toTimeString(event.start_time),
      endTime: this.toTimeString(event.end_time)
    };
  }

  /**
   * Applies the public Calendar creation defaults for callers that need the
   * final schedule before showing a confirmation or persisting a draft.
   */
  normalizeCreateEventInput(body: unknown): NormalizedCalendarEventInput {
    const draft = this.readBody(body);
    const isAllDay = this.readOptionalBoolean(draft, "isAllDay") ?? true;
    const title = this.requireTitle(draft.title);
    const description = this.readOptionalNullableString(draft, "description");
    const color = this.readOptionalColor(draft.color) ?? DEFAULT_COLOR;
    const startDate = this.requireDate(draft.startDate, "startDate");
    const endDate =
      draft.endDate === undefined
        ? startDate
        : this.requireDate(draft.endDate, "endDate");

    return this.normalizeSchedule({
      title,
      description,
      color,
      isAllDay,
      startDate,
      endDate,
      startTime: this.readOptionalNullableTime(draft, "startTime"),
      endTime: this.readOptionalNullableTime(draft, "endTime")
    });
  }

  private normalizeUpdateInput(
    body: unknown,
    existing: CalendarEventRow
  ): NormalizedCalendarEventInput {
    const draft = this.readBody(body);

    if (Object.keys(draft).length === 0) {
      throw badRequest("Calendar event update body is required");
    }

    const isAllDay =
      this.readOptionalBoolean(draft, "isAllDay") ?? existing.is_all_day;
    const title =
      draft.title === undefined ? existing.title : this.requireTitle(draft.title);
    const description =
      draft.description === undefined
        ? existing.description
        : this.readOptionalNullableString(draft, "description");
    const color =
      draft.color === undefined
        ? existing.color
        : this.readOptionalColor(draft.color) ?? DEFAULT_COLOR;
    const startDate =
      draft.startDate === undefined
        ? this.toDateString(existing.start_date)
        : this.requireDate(draft.startDate, "startDate");
    const endDate =
      draft.endDate === undefined
        ? this.toDateString(existing.end_date)
        : this.requireDate(draft.endDate, "endDate");
    const startTime =
      draft.startTime === undefined
        ? this.toTimeString(existing.start_time)
        : this.readOptionalNullableTime(draft, "startTime");
    const shouldNormalizeEndTime = this.shouldNormalizePatchEndTime(draft);
    const endTime = shouldNormalizeEndTime
      ? null
      : draft.endTime === undefined
        ? this.toTimeString(existing.end_time)
        : this.readOptionalNullableTime(draft, "endTime");

    return this.normalizeSchedule(
      {
        title,
        description,
        color,
        isAllDay,
        startDate,
        endDate,
        startTime,
        endTime
      },
      shouldNormalizeEndTime
    );
  }

  private normalizeSchedule(
    input: NormalizedCalendarEventInput,
    normalizeMissingEndTime = true
  ): NormalizedCalendarEventInput {
    if (input.isAllDay) {
      this.assertDateOrder(input.startDate, input.endDate);
      return {
        ...input,
        startTime: null,
        endTime: null
      };
    }

    if (!input.startTime) {
      throw badRequest("startTime is required for timed calendar events");
    }

    let endDate = input.endDate;
    let endTime = input.endTime;
    if (!endTime && normalizeMissingEndTime) {
      const normalizedEnd = this.addOneHour(input.startDate, input.startTime);
      if (input.endDate === input.startDate) {
        endDate = normalizedEnd.endDate;
      }
      endTime = normalizedEnd.endTime;
    }

    if (!endTime) {
      throw badRequest("endTime is required for timed calendar events");
    }

    this.assertDateOrder(input.startDate, endDate);
    if (input.startDate === endDate && endTime <= input.startTime) {
      throw badRequest("endTime must be later than startTime");
    }

    return {
      ...input,
      endDate,
      endTime
    };
  }

  private shouldNormalizePatchEndTime(draft: CalendarEventDraft): boolean {
    return (
      draft.endTime === undefined &&
      (draft.isAllDay !== undefined ||
        draft.startDate !== undefined ||
        draft.startTime !== undefined)
    );
  }

  private readBody(body: unknown): CalendarEventDraft {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw badRequest("Request body must be an object");
    }

    return body as CalendarEventDraft;
  }

  private requireTitle(value: unknown): string {
    if (typeof value !== "string") {
      throw badRequest("title is required");
    }

    const title = value.trim();
    if (!title) {
      throw badRequest("title is required");
    }

    if (title.length > MAX_TITLE_LENGTH) {
      throw badRequest("title must be 255 characters or less");
    }

    return title;
  }

  private readOptionalNullableString(
    draft: CalendarEventDraft,
    field: "description"
  ): string | null {
    const value = draft[field];
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== "string") {
      throw badRequest(`${field} must be a string`);
    }

    return value;
  }

  private readOptionalBoolean(
    draft: CalendarEventDraft,
    field: "isAllDay"
  ): boolean | undefined {
    const value = draft[field];
    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== "boolean") {
      throw badRequest(`${field} must be a boolean`);
    }

    return value;
  }

  private readOptionalColor(value: unknown): string | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== "string" || !COLOR_PATTERN.test(value)) {
      throw badRequest("color must be a hex color like #3B82F6");
    }

    return value;
  }

  private readOptionalNullableTime(
    draft: CalendarEventDraft,
    field: "startTime" | "endTime"
  ): string | null {
    const value = draft[field];
    if (value === undefined || value === null) {
      return null;
    }

    return this.requireTime(value, field);
  }

  private requireDate(value: unknown, field: string): string {
    if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
      throw badRequest(`${field} must use YYYY-MM-DD format`);
    }

    const [year, month, day] = value.split("-").map((part) => Number(part));
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw badRequest(`${field} must be a valid date`);
    }

    return value;
  }

  private requireTime(value: unknown, field: string): string {
    if (typeof value !== "string" || !TIME_PATTERN.test(value)) {
      throw badRequest(`${field} must use HH:mm format`);
    }

    return value;
  }

  private assertDateOrder(startDate: string, endDate: string): void {
    if (endDate < startDate) {
      throw badRequest("endDate must be on or after startDate");
    }
  }

  private addOneHour(
    startDate: string,
    startTime: string
  ): { endDate: string; endTime: string } {
    const minutes = this.timeToMinutes(startTime) + 60;
    const dayOffset = Math.floor(minutes / 1440);
    const endMinutes = minutes % 1440;

    return {
      endDate: this.addDays(startDate, dayOffset),
      endTime: this.minutesToTime(endMinutes)
    };
  }

  private addDays(dateString: string, days: number): string {
    const [year, month, day] = dateString.split("-").map((part) => Number(part));
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
  }

  private timeToMinutes(time: string): number {
    const [hour, minute] = time.split(":").map((part) => Number(part));
    return hour * 60 + minute;
  }

  private minutesToTime(minutes: number): string {
    const hour = Math.floor(minutes / 60)
      .toString()
      .padStart(2, "0");
    const minute = (minutes % 60).toString().padStart(2, "0");
    return `${hour}:${minute}`;
  }

  private parseEventId(eventId: string): number {
    if (!/^\d+$/.test(eventId)) {
      throw badRequest("eventId must be a positive integer");
    }

    const parsed = Number(eventId);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw badRequest("eventId must be a positive integer");
    }

    return parsed;
  }

  private mapEvent(event: CalendarEventRow): CalendarEventPayload {
    return {
      id: Number(event.id),
      title: event.title,
      description: event.description,
      color: event.color,
      isAllDay: event.is_all_day,
      startDate: this.toDateString(event.start_date),
      endDate: this.toDateString(event.end_date),
      startTime: this.toTimeString(event.start_time),
      endTime: this.toTimeString(event.end_time),
      createdBy: event.created_by,
      createdByUser: {
        id: event.created_by,
        name: event.created_by_user_name,
        avatarUrl: event.created_by_user_avatar_url
      },
      createdAt: this.toIsoString(event.created_at),
      updatedAt: this.toIsoString(event.updated_at),
      googleSync: this.mapGoogleSync(event)
    };
  }

  private mapGoogleSync(event: CalendarEventRow): CalendarEventPayload["googleSync"] {
    if (!event.google_sync_status || event.google_sync_status === "disconnected") return null;
    if (event.google_sync_status === "failed") {
      return { status: "failed", lastError: event.google_sync_last_error };
    }
    if (event.google_sync_google_event_id) return { status: "synced", lastError: null };
    return { status: "pending", lastError: null };
  }

  private toDateString(value: Date | string): string {
    if (value instanceof Date) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, "0");
      const day = String(value.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

    return value.slice(0, 10);
  }

  private toTimeString(value: string | null): string | null {
    if (!value) {
      return null;
    }

    return value.slice(0, 5);
  }

  private toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
