import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { QueryResultRow } from "pg";
import { badRequest, notFound } from "../../common/api-error";
import { DatabaseService, DatabaseTransaction } from "../../database/database.service";
import { BoardService } from "../board/board.service";
import { CalendarService } from "../calendar/calendar.service";
import { WorkspaceService } from "../workspace/workspace.service";

export type MeetingActionItemDeliveryType = "calendar_event" | "pilo_issue";

export interface MeetingActionItemDeliveryInput {
  deliveryType: MeetingActionItemDeliveryType;
  calendar?: {
    title?: string;
    description?: string | null;
    color?: string;
    isAllDay?: boolean;
    startDate: string;
    endDate: string;
    startTime?: string | null;
    endTime?: string | null;
  };
  issue?: {
    boardId: string;
    columnId: string;
    title?: string;
    body?: string;
  };
}

export interface MeetingActionItemDeliveryPayload {
  actionItemId: string;
  deliveryType: MeetingActionItemDeliveryType;
  status: "COMPLETED" | "FAILED";
  calendarEventId?: number;
  piloIssueId?: string;
  errorCode?: string;
}

export interface MeetingActionItemIssueDeliveryOption {
  id: string;
  name: string;
  columns: Array<{ id: string; name: string }>;
}

export interface MeetingActionItemDeliveryOptionsPayload {
  boards: MeetingActionItemIssueDeliveryOption[];
}

interface ActionItemRow extends QueryResultRow {
  id: string;
  title: string;
  description: string;
  status: string;
}

interface DeliveryRow extends QueryResultRow {
  id: string;
  delivery_type: MeetingActionItemDeliveryType;
  draft_json: MeetingActionItemDeliveryInput;
  idempotency_key: string;
  requested_by_user_id: string | null;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  locked_until: Date | string | null;
}

interface PreparedDelivery {
  actionItem: ActionItemRow;
  claimToken: string;
  delivery: DeliveryRow;
  input: MeetingActionItemDeliveryInput;
}

@Injectable()
export class MeetingActionItemDeliveryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspaceService: WorkspaceService,
    private readonly calendarService: CalendarService,
    private readonly boardService: BoardService
  ) {}

  async deliver(
    currentUserId: string,
    workspaceId: string,
    reportId: string,
    actionItemId: string,
    input: unknown
  ): Promise<MeetingActionItemDeliveryPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const normalizedInput = this.normalizeDeliveryInput(input);
    const prepared = await this.prepareDelivery(
      currentUserId,
      workspaceId,
      reportId,
      actionItemId,
      normalizedInput.deliveryType,
      normalizedInput
    );

    try {
      if (prepared.delivery.delivery_type === "calendar_event") {
        if (!prepared.input.calendar) {
          throw badRequest("calendar delivery input is required");
        }
        const calendarInput = {
          title: prepared.input.calendar.title ?? prepared.actionItem.title,
          description:
            prepared.input.calendar.description ?? prepared.actionItem.description,
          color: prepared.input.calendar.color,
          isAllDay: prepared.input.calendar.isAllDay,
          startDate: prepared.input.calendar.startDate,
          endDate: prepared.input.calendar.endDate,
          startTime: prepared.input.calendar.startTime,
          endTime: prepared.input.calendar.endTime
        };
        const event = await this.database.transaction(async (transaction) => {
          const created = await this.calendarService.createEventInTransaction(
            transaction,
            currentUserId,
            workspaceId,
            calendarInput
          );
          await this.completeDeliveryInTransaction(
            transaction,
            prepared.delivery.id,
            prepared.actionItem.id,
            currentUserId,
            prepared.claimToken,
            { calendarEventId: created.id }
          );
          return created;
        });
        return {
          actionItemId,
          deliveryType: "calendar_event",
          status: "COMPLETED",
          calendarEventId: event.id
        };
      }

      if (!prepared.input.issue) {
        throw badRequest("issue delivery input is required");
      }
      const result = await this.boardService.createBoardIssue(
        currentUserId,
        workspaceId,
        prepared.input.issue.boardId,
        {
          columnId: prepared.input.issue.columnId,
          title: prepared.input.issue.title ?? prepared.actionItem.title,
          body: prepared.input.issue.body ?? prepared.actionItem.description
        },
        prepared.delivery.idempotency_key
      );
      await this.completeIssueDelivery(
        prepared.delivery.id,
        prepared.actionItem.id,
        currentUserId,
        prepared.claimToken,
        result.issue.id
      );
      return {
        actionItemId,
        deliveryType: "pilo_issue",
        status: "COMPLETED",
        piloIssueId: result.issue.id
      };
    } catch (error) {
      const errorCode = this.toSafeErrorCode(error);
      await this.failDelivery(
        prepared.delivery.id,
        prepared.actionItem.id,
        prepared.claimToken,
        errorCode
      );
      return {
        actionItemId,
        deliveryType: prepared.delivery.delivery_type,
        status: "FAILED",
        errorCode
      };
    }
  }

  async listIssueDeliveryOptions(
    currentUserId: string,
    workspaceId: string,
    reportId: string,
    actionItemId: string
  ): Promise<MeetingActionItemDeliveryOptionsPayload> {
    await this.workspaceService.assertWorkspaceAccess(currentUserId, workspaceId);
    const actionItem = await this.database.queryOne<{ id: string }>(
      `SELECT action_items.id
       FROM meeting_report_action_items AS action_items
       JOIN meeting_reports AS reports ON reports.id = action_items.meeting_report_id
       JOIN meetings ON meetings.id = reports.meeting_id
       WHERE action_items.id = $1
         AND reports.id = $2
         AND meetings.workspace_id = $3`,
      [actionItemId, reportId, workspaceId]
    );
    if (!actionItem) {
      throw notFound("Meeting report action item not found");
    }
    return {
      boards: await this.boardService.listBoardDeliveryOptions(
        currentUserId,
        workspaceId
      )
    };
  }

  private async prepareDelivery(
    currentUserId: string,
    workspaceId: string,
    reportId: string,
    actionItemId: string,
    deliveryType: MeetingActionItemDeliveryType,
    draft: MeetingActionItemDeliveryInput
  ): Promise<PreparedDelivery> {
    const claimToken = randomUUID();
    return this.database.transaction(async (transaction) => {
      const actionItem = await transaction.queryOne<ActionItemRow>(
        `
          SELECT action_items.id, action_items.title, action_items.description, action_items.status
          FROM meeting_report_action_items AS action_items
          JOIN meeting_reports AS reports
            ON reports.id = action_items.meeting_report_id
          JOIN meetings
            ON meetings.id = reports.meeting_id
          WHERE action_items.id = $1
            AND reports.id = $2
            AND meetings.workspace_id = $3
          FOR UPDATE OF action_items
        `,
        [actionItemId, reportId, workspaceId]
      );
      if (!actionItem) {
        throw notFound("Meeting report action item not found");
      }
      let delivery = await transaction.queryOne<DeliveryRow>(
        `
          SELECT id, delivery_type, draft_json, idempotency_key,
                 requested_by_user_id, status, locked_until
          FROM meeting_report_action_item_deliveries
          WHERE action_item_id = $1
          FOR UPDATE
        `,
        [actionItem.id]
      );
      if (delivery && delivery.delivery_type !== deliveryType) {
        throw badRequest("Action item delivery type cannot be changed after a failed delivery");
      }
      if (
        actionItem.status === "DELIVERING" &&
        (!delivery ||
          delivery.status !== "RUNNING" ||
          delivery.locked_until === null)
      ) {
        throw badRequest("Action item delivery is already processing");
      }
      if (
        actionItem.status !== "PENDING" &&
        actionItem.status !== "DELIVERY_FAILED" &&
        actionItem.status !== "DELIVERING"
      ) {
        throw badRequest("Action item is not ready for delivery");
      }
      await this.validateDeliveryDraft(
        currentUserId,
        workspaceId,
        actionItem,
        delivery?.draft_json ?? draft
      );
      if (!delivery) {
        if (actionItem.status !== "PENDING") {
          throw badRequest("Action item is not ready for delivery");
        }
        delivery = await transaction.queryOne<DeliveryRow>(
          `
            INSERT INTO meeting_report_action_item_deliveries (
              action_item_id, delivery_type, requested_by_user_id,
              draft_json, idempotency_key
            )
            VALUES ($1, $2, $3, $4::jsonb, $5)
            RETURNING id, delivery_type, draft_json, idempotency_key,
                      requested_by_user_id, status, locked_until
          `,
          [
            actionItem.id,
            deliveryType,
            currentUserId,
            JSON.stringify(draft),
            `meeting-action-item:${actionItem.id}:${randomUUID()}`
          ]
        );
      }
      if (!delivery) {
        throw new Error("Action item delivery could not be prepared");
      }

      await transaction.execute(
        `
          UPDATE meeting_report_action_items
          SET status = 'DELIVERING', updated_at = now()
          WHERE id = $1
        `,
        [actionItem.id]
      );
      const claimed = await transaction.queryOne<DeliveryRow>(
        `
          UPDATE meeting_report_action_item_deliveries
          SET status = 'RUNNING',
              attempt_count = attempt_count + 1,
              last_error_code = NULL,
              last_attempted_by_user_id = $3,
              last_attempted_at = now(),
              claim_token = $2::uuid,
              locked_until = now() + INTERVAL '5 minutes',
              updated_at = now()
          WHERE id = $1
            AND (
              status IN ('PENDING', 'FAILED')
              OR (status = 'RUNNING' AND locked_until <= now())
            )
          RETURNING id, delivery_type, draft_json, idempotency_key,
                    requested_by_user_id, status, locked_until
        `,
        [delivery.id, claimToken, currentUserId]
      );
      if (!claimed) {
        throw badRequest("Action item delivery is already processing");
      }

      return {
        actionItem,
        claimToken,
        delivery: claimed,
        input: claimed.draft_json
      };
    });
  }

  async recoverStaleDeliveries(): Promise<number> {
    const recovered = await this.database.query<{ id: string }>(
      `
        WITH candidates AS (
          SELECT delivery.id, delivery.action_item_id
          FROM meeting_report_action_item_deliveries AS delivery
          JOIN meeting_report_action_items AS action_item
            ON action_item.id = delivery.action_item_id
          WHERE delivery.status = 'RUNNING'
            AND delivery.locked_until <= now()
            AND action_item.status = 'DELIVERING'
          ORDER BY delivery.locked_until ASC
          FOR UPDATE OF delivery, action_item SKIP LOCKED
          LIMIT 50
        ), failed_deliveries AS (
          UPDATE meeting_report_action_item_deliveries AS delivery
          SET status = 'FAILED',
              last_error_code = 'ACTION_ITEM_DELIVERY_STALE',
              claim_token = NULL,
              locked_until = NULL,
              updated_at = now()
          FROM candidates
          WHERE delivery.id = candidates.id
            AND delivery.status = 'RUNNING'
          RETURNING delivery.action_item_id
        )
        UPDATE meeting_report_action_items AS action_item
        SET status = 'DELIVERY_FAILED', updated_at = now()
        FROM failed_deliveries
        WHERE action_item.id = failed_deliveries.action_item_id
          AND action_item.status = 'DELIVERING'
        RETURNING action_item.id
      `
    );

    return recovered.length;
  }

  private async completeIssueDelivery(
    deliveryId: string,
    actionItemId: string,
    currentUserId: string,
    claimToken: string,
    piloIssueId: string
  ): Promise<void> {
    await this.completeDelivery(deliveryId, actionItemId, currentUserId, claimToken, {
      piloIssueId
    });
  }

  private async completeDelivery(
    deliveryId: string,
    actionItemId: string,
    currentUserId: string,
    claimToken: string,
    target: { calendarEventId?: number; piloIssueId?: string }
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await this.completeDeliveryInTransaction(
        transaction,
        deliveryId,
        actionItemId,
        currentUserId,
        claimToken,
        target
      );
    });
  }

  private async completeDeliveryInTransaction(
    transaction: DatabaseTransaction,
    deliveryId: string,
    actionItemId: string,
    currentUserId: string,
    claimToken: string,
    target: { calendarEventId?: number; piloIssueId?: string }
  ): Promise<void> {
    const completed = await transaction.queryOne<{ id: string }>(
      `
          UPDATE meeting_report_action_item_deliveries
          SET status = 'COMPLETED',
              calendar_event_id = $2,
              pilo_issue_id = $3::bigint,
              target_resource_id = COALESCE($2::text, $3::text),
              claim_token = NULL,
              locked_until = NULL,
              updated_at = now()
          WHERE id = $1
            AND status = 'RUNNING'
            AND claim_token = $4::uuid
          RETURNING id
      `,
      [
        deliveryId,
        target.calendarEventId ?? null,
        target.piloIssueId ?? null,
        claimToken
      ]
    );
    if (!completed) {
      throw new Error("Action item delivery completion was lost");
    }
    const approved = await transaction.queryOne<{ id: string }>(
      `
          UPDATE meeting_report_action_items
          SET status = 'APPROVED',
              approved_by_user_id = $2,
              approved_at = now(),
              updated_by_user_id = $2,
              updated_at = now()
          WHERE id = $1
            AND status = 'DELIVERING'
          RETURNING id
      `,
      [actionItemId, currentUserId]
    );
    if (!approved) {
      throw new Error("Action item approval completion was lost");
    }
  }

  private async failDelivery(
    deliveryId: string,
    actionItemId: string,
    claimToken: string,
    errorCode: string
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const failed = await transaction.queryOne<{ id: string }>(
        `
          UPDATE meeting_report_action_item_deliveries
          SET status = 'FAILED',
              last_error_code = $2,
              claim_token = NULL,
              locked_until = NULL,
              updated_at = now()
          WHERE id = $1
            AND status = 'RUNNING'
            AND claim_token = $3::uuid
          RETURNING id
        `,
        [deliveryId, errorCode, claimToken]
      );
      if (!failed) {
        return;
      }
      await transaction.execute(
        `
          UPDATE meeting_report_action_items
          SET status = 'DELIVERY_FAILED', updated_at = now()
          WHERE id = $1 AND status = 'DELIVERING'
        `,
        [actionItemId]
      );
    });
  }

  private toSafeErrorCode(error: unknown): string {
    if (typeof error === "object" && error !== null && "code" in error) {
      const value = (error as { code?: unknown }).code;
      if (typeof value === "string" && /^[A-Z0-9_]{1,80}$/.test(value)) {
        return value;
      }
    }
    return "ACTION_ITEM_DELIVERY_FAILED";
  }

  private async validateDeliveryDraft(
    currentUserId: string,
    workspaceId: string,
    actionItem: ActionItemRow,
    draft: MeetingActionItemDeliveryInput
  ): Promise<void> {
    if (draft.deliveryType === "calendar_event") {
      if (!draft.calendar) {
        throw badRequest("calendar delivery input is required");
      }
      this.calendarService.validateCreateEventInput({
        title: draft.calendar.title ?? actionItem.title,
        description: draft.calendar.description ?? actionItem.description,
        color: draft.calendar.color,
        isAllDay: draft.calendar.isAllDay,
        startDate: draft.calendar.startDate,
        endDate: draft.calendar.endDate,
        startTime: draft.calendar.startTime,
        endTime: draft.calendar.endTime
      });
      return;
    }

    if (!draft.issue) {
      throw badRequest("issue delivery input is required");
    }
    await this.boardService.validateBoardIssueCreateInput(
      currentUserId,
      workspaceId,
      draft.issue.boardId,
      {
        columnId: draft.issue.columnId,
        title: draft.issue.title ?? actionItem.title,
        body: draft.issue.body ?? actionItem.description
      }
    );
  }

  private normalizeDeliveryInput(input: unknown): MeetingActionItemDeliveryInput {
    if (!this.isRecord(input)) {
      throw badRequest("Action item delivery input must be an object");
    }
    const keys = Object.keys(input);
    if (keys.some((key) => !["deliveryType", "calendar", "issue"].includes(key))) {
      throw badRequest("Invalid action item delivery input");
    }
    if (input.deliveryType === "calendar_event") {
      if (input.issue !== undefined || !this.isRecord(input.calendar)) {
        throw badRequest("calendar delivery input is required");
      }
      return {
        deliveryType: "calendar_event",
        calendar: {
          title: this.normalizeOptionalText(input.calendar.title, "calendar title"),
          description: this.normalizeOptionalNullableText(
            input.calendar.description,
            "calendar description"
          ),
          color: this.normalizeOptionalText(input.calendar.color, "calendar color"),
          isAllDay: this.normalizeOptionalBoolean(input.calendar.isAllDay, "calendar isAllDay"),
          startDate: this.normalizeRequiredDate(input.calendar.startDate, "calendar startDate"),
          endDate: this.normalizeRequiredDate(input.calendar.endDate, "calendar endDate"),
          startTime: this.normalizeOptionalTime(input.calendar.startTime, "calendar startTime"),
          endTime: this.normalizeOptionalTime(input.calendar.endTime, "calendar endTime")
        }
      };
    }
    if (input.deliveryType === "pilo_issue") {
      if (input.calendar !== undefined || !this.isRecord(input.issue)) {
        throw badRequest("issue delivery input is required");
      }
      return {
        deliveryType: "pilo_issue",
        issue: {
          boardId: this.normalizePositiveId(input.issue.boardId, "issue boardId"),
          columnId: this.normalizePositiveId(input.issue.columnId, "issue columnId"),
          title: this.normalizeOptionalText(input.issue.title, "issue title"),
          body: this.normalizeOptionalText(input.issue.body, "issue body")
        }
      };
    }
    throw badRequest("Invalid action item delivery type");
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private normalizeRequiredDate(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw badRequest(`${field} must be an ISO date`);
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw badRequest(`${field} must be an ISO date`);
    }
    return value;
  }

  private normalizeOptionalTime(value: unknown, field: string): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (
      typeof value !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ) {
      throw badRequest(`${field} must be an HH:MM time`);
    }
    return value;
  }

  private normalizeOptionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") throw badRequest(`${field} must be a boolean`);
    return value;
  }

  private normalizePositiveId(value: unknown, field: string): string {
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
      throw badRequest(`${field} must be a positive integer`);
    }
    return value;
  }

  private normalizeOptionalText(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim()) {
      throw badRequest(`${field} must be a non-empty string`);
    }
    return value.trim();
  }

  private normalizeOptionalNullableText(
    value: unknown,
    field: string
  ): string | null | undefined {
    if (value === undefined || value === null) return value;
    return this.normalizeOptionalText(value, field);
  }
}
