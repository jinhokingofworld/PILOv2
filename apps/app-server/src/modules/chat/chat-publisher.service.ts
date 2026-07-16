import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import type { ChatRedisEventV1 } from "./chat-types";

export const CHAT_REDIS_CHANNEL = "chat:events";

type ChatRedisConnectionAttempt = {
  client: RedisClientType;
  destroyed: boolean;
  promise?: Promise<RedisClientType | null>;
  redisUrl: string;
};

@Injectable()
export class ChatPublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(ChatPublisherService.name);
  private redisClient: RedisClientType | null = null;
  private redisUrl: string | null = null;
  private redisConnectionAttempt: ChatRedisConnectionAttempt | null = null;
  private shuttingDown = false;

  async publish(event: ChatRedisEventV1): Promise<void> {
    try {
      const client = await this.getClient();
      if (!client || this.shuttingDown) return;

      await client.publish(CHAT_REDIS_CHANNEL, JSON.stringify(event));
    } catch {
      this.logger.warn(
        `Chat Redis publish failed type=${event.type} workspace_id=${event.workspaceId}`
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;

    const pendingAttempt = this.redisConnectionAttempt;
    if (pendingAttempt) {
      this.destroyConnectionAttempt(pendingAttempt);
      await pendingAttempt.promise?.catch(() => undefined);
      if (this.redisConnectionAttempt === pendingAttempt) {
        this.redisConnectionAttempt = null;
      }
    }

    const connectedClient = this.redisClient;
    this.redisClient = null;
    this.redisUrl = null;
    if (connectedClient) {
      await connectedClient.quit();
    }
  }

  private async getClient(): Promise<RedisClientType | null> {
    if (this.shuttingDown) return null;

    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) return null;

    if (this.redisClient && this.redisUrl === redisUrl) {
      return this.redisClient;
    }

    const pendingAttempt = this.redisConnectionAttempt;
    if (pendingAttempt?.redisUrl === redisUrl && pendingAttempt.promise) {
      return pendingAttempt.promise;
    }

    if (pendingAttempt?.promise) {
      await pendingAttempt.promise.catch(() => undefined);
    }

    if (this.shuttingDown) return null;

    if (this.redisClient) {
      await this.redisClient.quit();
    }
    this.redisClient = null;
    this.redisUrl = null;

    const client = createClient({ url: redisUrl }) as RedisClientType;
    client.on("error", () => {
      this.logger.error("Chat Redis connection error");
    });

    const attempt: ChatRedisConnectionAttempt = {
      client,
      destroyed: false,
      redisUrl
    };
    this.redisConnectionAttempt = attempt;
    const connectionPromise = this.connectRedisClient(attempt);
    attempt.promise = connectionPromise;
    return connectionPromise;
  }

  private async connectRedisClient(
    attempt: ChatRedisConnectionAttempt
  ): Promise<RedisClientType | null> {
    try {
      await attempt.client.connect();
      if (
        this.shuttingDown ||
        this.redisConnectionAttempt !== attempt
      ) {
        await this.closeConnectedAttempt(attempt);
        return null;
      }

      this.redisClient = attempt.client;
      this.redisUrl = attempt.redisUrl;
      return attempt.client;
    } catch (error) {
      this.destroyConnectionAttempt(attempt);
      if (this.shuttingDown) return null;
      throw error;
    } finally {
      if (this.redisConnectionAttempt === attempt) {
        this.redisConnectionAttempt = null;
      }
    }
  }

  private destroyConnectionAttempt(
    attempt: ChatRedisConnectionAttempt
  ): void {
    if (attempt.destroyed) return;
    attempt.destroyed = true;
    attempt.client.destroy();
  }

  private async closeConnectedAttempt(
    attempt: ChatRedisConnectionAttempt
  ): Promise<void> {
    try {
      await attempt.client.quit();
    } catch {
      attempt.client.destroy();
    }
  }
}
