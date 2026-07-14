import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";

export const BOARD_SOURCE_REDIS_CHANNEL = "board:source-events";

export type BoardSourceUpdatedEvent = {
  workspaceId: string;
  boardId: string;
  changedAt: string;
};

@Injectable()
export class BoardSourcePublisherService implements OnModuleDestroy {
  private redisClient: RedisClientType | null = null;
  private redisUrl: string | null = null;

  async publishSourceUpdated(payload: BoardSourceUpdatedEvent): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    await client.publish(BOARD_SOURCE_REDIS_CHANNEL, JSON.stringify(payload));
  }

  async onModuleDestroy(): Promise<void> {
    await this.redisClient?.quit();
    this.redisClient = null;
    this.redisUrl = null;
  }

  private async getClient(): Promise<RedisClientType | null> {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) return null;
    if (this.redisClient && this.redisUrl === redisUrl) return this.redisClient;

    await this.redisClient?.quit();
    const client = createClient({ url: redisUrl });
    client.on("error", (error) => console.error("Board source Redis publish failed", error));
    await client.connect();
    this.redisClient = client as RedisClientType;
    this.redisUrl = redisUrl;
    return this.redisClient;
  }
}
