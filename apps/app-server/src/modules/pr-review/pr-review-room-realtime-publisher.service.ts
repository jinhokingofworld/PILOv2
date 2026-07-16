import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";

export const PR_REVIEW_ROOM_REDIS_CHANNEL = "pr-review:room-events";
export const PR_REVIEW_ROOM_DELETED_EVENT = "pr-review:room:deleted";

type PrReviewRoomDeletedEvent = {
  event: typeof PR_REVIEW_ROOM_DELETED_EVENT;
  workspaceId: string;
  canvasId: string;
  reviewRoomId: string;
};

@Injectable()
export class PrReviewRoomRealtimePublisherService
  implements OnModuleDestroy
{
  private readonly logger = new Logger(PrReviewRoomRealtimePublisherService.name);
  private client: RedisClientType | null = null;

  async publishRoomDeleted(input: Omit<PrReviewRoomDeletedEvent, "event">) {
    const client = await this.getClient();
    if (!client) return;

    await client.publish(
      PR_REVIEW_ROOM_REDIS_CHANNEL,
      JSON.stringify({
        event: PR_REVIEW_ROOM_DELETED_EVENT,
        ...input
      } satisfies PrReviewRoomDeletedEvent)
    );
  }

  async publishRoomDeletedSafely(
    input: Omit<PrReviewRoomDeletedEvent, "event">
  ) {
    try {
      await this.publishRoomDeleted(input);
    } catch {
      this.logger.warn(
        `PR Review room deletion realtime publish failed review_room_id=${input.reviewRoomId}`
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
      this.logger.error("PR Review room realtime publish failed", error)
    );
    await client.connect();
    this.client = client as RedisClientType;
    return this.client;
  }
}
