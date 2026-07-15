import { Injectable } from "@nestjs/common";
import { badRequest } from "./api-error";
import type { DatabaseTransaction } from "../database/database.service";

export const ACTIVITY_LOG_ACTOR_TYPES = [
  "user",
  "agent",
  "system",
  "integration"
] as const;

export type ActivityLogActorType = (typeof ACTIVITY_LOG_ACTOR_TYPES)[number];

export const ACTIVITY_LOG_ACTIONS = [
  "workspace_created",
  "workspace_updated",
  "workspace_archived",
  "meeting_started",
  "meeting_ended",
  "meeting_participant_joined",
  "meeting_participant_left",
  "meeting_recording_started",
  "meeting_recording_completed",
  "meeting_recording_failed",
  "meeting_report_completed",
  "meeting_report_failed",
  "pr_review_session_created",
  "pr_review_session_updated",
  "pr_review_session_submitted",
  "file_review_decision_created",
  "review_submission_created",
  "review_submission_submitted",
  "review_submission_failed",
  "github_sync_started",
  "github_sync_succeeded",
  "github_sync_failed",
  "github_repository_synced",
  "github_issue_synced",
  "github_project_v2_synced",
  "canvas_created",
  "canvas_updated",
  "canvas_user_entered",
  "canvas_user_left",
  "canvas_shape_created",
  "canvas_shape_updated",
  "canvas_shape_deleted",
  "board_created",
  "board_updated",
  "pilo_issue_created",
  "pilo_issue_updated",
  "pilo_issue_moved",
  "pilo_issue_deleted",
  "calendar_event_created",
  "calendar_event_updated",
  "calendar_event_deleted"
] as const;

export type ActivityLogAction = (typeof ACTIVITY_LOG_ACTIONS)[number];

export interface ActivityLogInput {
  workspaceId: string;
  actor: {
    type: ActivityLogActorType;
    userId?: string | null;
  };
  action: ActivityLogAction;
  target: {
    type: string;
    id: string;
  };
  dedupeKey: string;
  metadata: {
    version: 1;
    summary: string;
    data: Record<string, unknown>;
  };
}

const ACTIVITY_LOG_ACTION_SET = new Set<string>(ACTIVITY_LOG_ACTIONS);
const ACTIVITY_LOG_ACTOR_TYPE_SET = new Set<string>(ACTIVITY_LOG_ACTOR_TYPES);
const MAX_DEDUPE_KEY_LENGTH = 512;
const MAX_METADATA_SUMMARY_LENGTH = 500;

@Injectable()
export class ActivityLogService {
  async append(
    transaction: DatabaseTransaction,
    input: ActivityLogInput
  ): Promise<void> {
    const metadata = validateActivityLogInput(input);

    await transaction.execute(
      `
        INSERT INTO activity_logs (
          workspace_id,
          actor_type,
          actor_user_id,
          action,
          target_type,
          target_id,
          dedupe_key,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        ON CONFLICT (workspace_id, dedupe_key) DO NOTHING
      `,
      [
        input.workspaceId,
        input.actor.type,
        input.actor.userId ?? null,
        input.action,
        input.target.type,
        input.target.id,
        input.dedupeKey,
        metadata
      ]
    );
  }
}

function validateActivityLogInput(input: ActivityLogInput): string {
  requireNonEmptyString(input.workspaceId, "Activity Log workspaceId", 128);
  requireNonEmptyString(input.target.type, "Activity Log target.type", 128);
  requireNonEmptyString(input.target.id, "Activity Log target.id", 512);
  requireNonEmptyString(
    input.dedupeKey,
    "Activity Log dedupeKey",
    MAX_DEDUPE_KEY_LENGTH
  );

  if (!ACTIVITY_LOG_ACTION_SET.has(input.action)) {
    throw badRequest("Activity Log action must be registered");
  }
  if (!ACTIVITY_LOG_ACTOR_TYPE_SET.has(input.actor.type)) {
    throw badRequest("Activity Log actor.type is invalid");
  }
  if (input.actor.type === "user" && !isNonEmptyString(input.actor.userId)) {
    throw badRequest("Activity Log user actor requires userId");
  }
  if (
    input.actor.userId !== undefined &&
    input.actor.userId !== null &&
    !isNonEmptyString(input.actor.userId)
  ) {
    throw badRequest("Activity Log actor.userId is invalid");
  }

  if (input.metadata.version !== 1) {
    throw badRequest("Activity Log metadata.version must be 1");
  }
  requireNonEmptyString(
    input.metadata.summary,
    "Activity Log metadata.summary",
    MAX_METADATA_SUMMARY_LENGTH
  );
  if (!isRecord(input.metadata.data)) {
    throw badRequest("Activity Log metadata.data must be an object");
  }

  try {
    return JSON.stringify(input.metadata);
  } catch {
    throw badRequest("Activity Log metadata must be JSON serializable");
  }
}

function requireNonEmptyString(
  value: unknown,
  field: string,
  maxLength: number
): asserts value is string {
  if (!isNonEmptyString(value) || value.length > maxLength) {
    throw badRequest(`${field} must be a non-empty string within ${maxLength} characters`);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
