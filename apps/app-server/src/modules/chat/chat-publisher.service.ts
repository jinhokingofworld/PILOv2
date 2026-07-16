import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import type { ChatRedisEventV1 } from "./chat-types";

export const CHAT_REDIS_CHANNEL = "chat:events";

@Injectable()
export class ChatPublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(ChatPublisherService.name);
  private redisClient: RedisClientType | null = null;
  private redisUrl: string | null = null;
  private redisConnectionPromise: Promise<RedisClientType> | null = null;
  private redisConnectionUrl: string | null = null;

  async publish(event: ChatRedisEventV1): Promise<void> {
    try {
      const client = await this.getClient();
      if (!client) return;

      await client.publish(CHAT_REDIS_CHANNEL, JSON.stringify(event));
    } catch {
      this.logger.warn(
        `Chat Redis publish failed type=${event.type} workspace_id=${event.workspaceId}`
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.quit();
    }
    this.redisClient = null;
    this.redisUrl = null;
    this.redisConnectionPromise = null;
    this.redisConnectionUrl = null;
  }

  private async getClient(): Promise<RedisClientType | null> {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) return null;

    if (this.redisClient && this.redisUrl === redisUrl) {
      return this.redisClient;
    }

    if (
      this.redisConnectionPromise &&
      this.redisConnectionUrl === redisUrl
    ) {
      return this.redisConnectionPromise;
    }

    if (this.redisConnectionPromise) {
      await this.redisConnectionPromise.catch(() => undefined);
    }

    if (this.redisClient) {
      await this.redisClient.quit();
    }
    this.redisClient = null;
    this.redisUrl = null;

    const client = createClient({ url: redisUrl });
    client.on("error", () => {
      this.logger.error("Chat Redis connection error");
    });

    const connectionPromise = (async (): Promise<RedisClientType> => {
      try {
        await client.connect();
        return client as RedisClientType;
      } catch (error) {
        client.destroy();
        throw error;
      }
    })();
    this.redisConnectionPromise = connectionPromise;
    this.redisConnectionUrl = redisUrl;

    try {
      const connectedClient = await connectionPromise;
      this.redisClient = connectedClient;
      this.redisUrl = redisUrl;
      return connectedClient;
    } finally {
      if (this.redisConnectionPromise === connectionPromise) {
        this.redisConnectionPromise = null;
        this.redisConnectionUrl = null;
      }
    }
  }
}
