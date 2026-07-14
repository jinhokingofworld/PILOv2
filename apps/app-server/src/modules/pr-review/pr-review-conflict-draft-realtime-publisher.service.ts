import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import { DatabaseService } from "../../database/database.service";
import type { PrReviewConflictDraftResolutionState } from "./pr-review.service";

export const PR_REVIEW_CONFLICT_DRAFT_REDIS_CHANNEL =
  "pr-review:conflict-draft-events";
export const PR_REVIEW_CONFLICT_DRAFT_UPDATED_EVENT =
  "pr-review:conflict-draft:updated";
export const PR_REVIEW_CONFLICT_DRAFT_INVALIDATED_EVENT =
  "pr-review:conflict-draft:invalidated";

type ConflictDraftRealtimeRow = {
  workspace_id: string;
  canvas_id: string;
  review_room_id: string;
  review_session_id: string;
  review_file_id: string;
  source_head_blob_sha: string;
  resolved_content: string;
  resolution_state: PrReviewConflictDraftResolutionState;
  draft_version: number | string;
  updated_by_user_id: string;
  updated_at: Date | string;
};

@Injectable()
export class PrReviewConflictDraftRealtimePublisherService
  implements OnModuleDestroy
{
  private readonly logger = new Logger(
    PrReviewConflictDraftRealtimePublisherService.name
  );
  private client: RedisClientType | null = null;

  constructor(private readonly database: DatabaseService) {}

  async publishDraftUpdated(reviewFileId: string): Promise<void> {
    const row = await this.database.queryOne<ConflictDraftRealtimeRow>(
      `SELECT pull_request.workspace_id,
              review_room.canvas_id,
              review_room.id AS review_room_id,
              review_session.id AS review_session_id,
              review_file.id AS review_file_id,
              draft.source_head_blob_sha,
              draft.resolved_content,
              draft.resolution_state,
              draft.draft_version,
              draft.updated_by_user_id,
              draft.updated_at
       FROM pr_review_conflict_drafts AS draft
       JOIN review_files AS review_file ON review_file.id = draft.review_file_id
       JOIN pr_review_sessions AS review_session ON review_session.id = review_file.session_id
       JOIN pr_review_rooms AS review_room ON review_room.id = review_session.room_id
       JOIN github_pull_requests AS pull_request ON pull_request.id = review_session.pull_request_id
       WHERE draft.review_file_id = $1`,
      [reviewFileId]
    );
    if (!row) return;

    await this.publish({
      event: PR_REVIEW_CONFLICT_DRAFT_UPDATED_EVENT,
      workspaceId: row.workspace_id,
      canvasId: row.canvas_id,
      reviewRoomId: row.review_room_id,
      reviewSessionId: row.review_session_id,
      reviewFileId: row.review_file_id,
      sourceHeadBlobSha: row.source_head_blob_sha,
      resolvedContent: row.resolved_content,
      resolutionState: row.resolution_state,
      draftVersion: Number(row.draft_version),
      updatedByUserId: row.updated_by_user_id,
      updatedAt: new Date(row.updated_at).toISOString()
    });
  }

  async publishDraftInvalidated(input: {
    workspaceId: string;
    canvasId: string;
    reviewRoomId: string;
    reviewSessionId: string;
    reviewFileIds: string[];
  }): Promise<void> {
    if (!input.reviewFileIds.length) return;
    await this.publish({
      event: PR_REVIEW_CONFLICT_DRAFT_INVALIDATED_EVENT,
      ...input
    });
  }

  async publishDraftUpdatedSafely(reviewFileId: string): Promise<void> {
    try {
      await this.publishDraftUpdated(reviewFileId);
    } catch {
      this.logger.warn(
        `PR Review Conflict draft realtime publish failed review_file_id=${reviewFileId}`
      );
    }
  }

  async publishDraftInvalidatedSafely(input: {
    workspaceId: string;
    canvasId: string;
    reviewRoomId: string;
    reviewSessionId: string;
    reviewFileIds: string[];
  }): Promise<void> {
    try {
      await this.publishDraftInvalidated(input);
    } catch {
      this.logger.warn(
        `PR Review Conflict draft invalidation publish failed review_session_id=${input.reviewSessionId}`
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
    this.client = null;
  }

  private async publish(payload: Record<string, unknown>): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    await client.publish(PR_REVIEW_CONFLICT_DRAFT_REDIS_CHANNEL, JSON.stringify(payload));
  }

  private async getClient(): Promise<RedisClientType | null> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) return null;
    if (this.client) return this.client;

    const client = createClient({ url });
    client.on("error", error =>
      this.logger.error("PR Review Conflict draft Redis publish failed", error)
    );
    await client.connect();
    this.client = client as RedisClientType;
    return this.client;
  }
}
