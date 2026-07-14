import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import { DatabaseService } from "../../database/database.service";

export const PR_REVIEW_DECISION_REDIS_CHANNEL = "pr-review:decision-events";
export const PR_REVIEW_DECISION_UPDATED_EVENT = "pr-review:decision:updated";

type PrReviewDecisionRealtimeRow = {
  workspace_id: string;
  canvas_id: string;
  review_room_id: string;
  review_session_id: string;
  review_file_id: string;
  room_file_id: string;
  current_status: "not_reviewed" | "approved" | "discussion_needed" | "unknown";
  decision_version: number | string;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | string | null;
  reviewed_count: number | string;
  total_file_count: number | string;
};

@Injectable()
export class PrReviewDecisionRealtimePublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(
    PrReviewDecisionRealtimePublisherService.name
  );
  private client: RedisClientType | null = null;

  constructor(private readonly database: DatabaseService) {}

  async publishDecisionUpdated(reviewFileId: string): Promise<void> {
    const row = await this.database.queryOne<PrReviewDecisionRealtimeRow>(
      `SELECT pull_request.workspace_id,
              review_room.canvas_id,
              review_room.id AS review_room_id,
              review_session.id AS review_session_id,
              review_file.id AS review_file_id,
              review_file.room_file_id,
              review_file.current_status,
              review_file.decision_version,
              review_file.reviewed_by_user_id,
              review_file.reviewed_at,
              review_session.reviewed_count,
              review_session.total_file_count
       FROM review_files review_file
       JOIN pr_review_sessions review_session
         ON review_session.id = review_file.session_id
       JOIN pr_review_rooms review_room
         ON review_room.id = review_session.room_id
       JOIN github_pull_requests pull_request
         ON pull_request.id = review_session.pull_request_id
       WHERE review_file.id = $1`,
      [reviewFileId]
    );

    if (!row) return;

    const client = await this.getClient();
    if (!client) return;

    const reviewedCount = Number(row.reviewed_count);
    const totalFileCount = Number(row.total_file_count);
    await client.publish(
      PR_REVIEW_DECISION_REDIS_CHANNEL,
      JSON.stringify({
        event: PR_REVIEW_DECISION_UPDATED_EVENT,
        workspaceId: row.workspace_id,
        canvasId: row.canvas_id,
        reviewRoomId: row.review_room_id,
        reviewSessionId: row.review_session_id,
        reviewFileId: row.review_file_id,
        roomFileId: row.room_file_id,
        currentStatus: row.current_status,
        decisionVersion: Number(row.decision_version),
        reviewedCount,
        totalFileCount,
        readyToSubmit:
          totalFileCount > 0 && reviewedCount === totalFileCount,
        reviewedByUserId: row.reviewed_by_user_id,
        reviewedAt: row.reviewed_at
          ? new Date(row.reviewed_at).toISOString()
          : null
      })
    );
  }

  async publishDecisionUpdatedSafely(reviewFileId: string): Promise<void> {
    try {
      await this.publishDecisionUpdated(reviewFileId);
    } catch {
      this.logger.warn(
        `PR Review decision realtime publish failed review_file_id=${reviewFileId}`
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
    this.client = null;
  }

  private async getClient(): Promise<RedisClientType | null> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) return null;
    if (this.client) return this.client;

    const client = createClient({ url });
    client.on("error", error =>
      this.logger.error("PR Review decision Redis publish failed", error)
    );
    await client.connect();
    this.client = client as RedisClientType;
    return this.client;
  }
}
