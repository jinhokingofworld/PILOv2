import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";

export const BOARD_INVALIDATION_REDIS_CHANNEL = "board:invalidations";

export type BoardInvalidationPayload = {
  workspaceId: string;
  boardId: string;
  updatedAt: string;
};

@Injectable()
export class GithubBoardInvalidationPublisherService implements OnModuleDestroy {
  private redisClient: RedisClientType | null = null;
  private redisUrl: string | null = null;

  async publishInvalidation(payload: BoardInvalidationPayload): Promise<void> {
    const client = await this.getClient();

    if (!client) {
      return;
    }

    await client.publish(
      BOARD_INVALIDATION_REDIS_CHANNEL,
      JSON.stringify(payload)
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.redisClient?.quit();
    this.redisClient = null;
    this.redisUrl = null;
  }

  private async getClient(): Promise<RedisClientType | null> {
    const redisUrl = process.env.REDIS_URL?.trim();

    if (!redisUrl) {
      return null;
    }

    if (this.redisClient && this.redisUrl === redisUrl) {
      return this.redisClient;
    }

    await this.redisClient?.quit();

    const client = createClient({ url: redisUrl });

    client.on("error", (error) => {
      console.error("Board invalidation Redis publish failed", error);
    });

    await client.connect();
    this.redisClient = client as RedisClientType;
    this.redisUrl = redisUrl;

    return this.redisClient;
  }
}
