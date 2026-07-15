import { Injectable } from "@nestjs/common";
import type { DatabaseTransaction } from "../database/database.service";

export type ActivityLogActorType =
  | "user"
  | "agent"
  | "system"
  | "integration";

export type ActivityLogAction =
  | "workspace_created"
  | "workspace_updated"
  | "workspace_archived"
  | "meeting_started"
  | "meeting_ended"
  | "meeting_participant_joined"
  | "meeting_participant_left"
  | "meeting_recording_started"
  | "meeting_recording_completed"
  | "meeting_recording_failed"
  | "meeting_report_completed"
  | "meeting_report_failed"
  | "pr_review_session_created"
  | "pr_review_session_updated"
  | "pr_review_session_submitted"
  | "file_review_decision_created"
  | "review_submission_created"
  | "review_submission_submitted"
  | "review_submission_failed"
  | "github_sync_started"
  | "github_sync_succeeded"
  | "github_sync_failed"
  | "github_repository_synced"
  | "github_issue_synced"
  | "github_project_v2_synced"
  | "canvas_created"
  | "canvas_updated"
  | "canvas_user_entered"
  | "canvas_user_left"
  | "canvas_shape_created"
  | "canvas_shape_updated"
  | "canvas_shape_deleted"
  | "board_created"
  | "board_updated"
  | "pilo_issue_created"
  | "pilo_issue_updated"
  | "pilo_issue_moved"
  | "pilo_issue_deleted"
  | "calendar_event_created"
  | "calendar_event_updated"
  | "calendar_event_deleted";

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

@Injectable()
export class ActivityLogService {
  async append(
    transaction: DatabaseTransaction,
    input: ActivityLogInput
  ): Promise<void> {
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
        JSON.stringify(input.metadata)
      ]
    );
  }
}
