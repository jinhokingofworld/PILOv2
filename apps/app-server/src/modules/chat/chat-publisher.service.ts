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

type ChatRedisClientLease = {
  clientPromise: Promise<RedisClientType | null>;
};

@Injectable()
export class ChatPublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(ChatPublisherService.name);
  private redisClient: RedisClientType | null = null;
  private redisUrl: string | null = null;
  private redisConnectionAttempt: ChatRedisConnectionAttempt | null = null;
  private redisOwnershipTransition: Promise<void> = Promise.resolve();
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
    const activeAttempt = this.redisConnectionAttempt;
    if (activeAttempt) {
      this.destroyConnectionAttempt(activeAttempt);
    }

    await this.withRedisOwnershipTransition(async () => {
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
        await this.closeRedisClient(connectedClient);
      }
    });
  }

  private async getClient(): Promise<RedisClientType | null> {
    if (this.shuttingDown) return null;

    const lease = await this.withRedisOwnershipTransition(() =>
      this.resolveRedisClientLease()
    );
    return lease.clientPromise;
  }

  private async resolveRedisClientLease(): Promise<ChatRedisClientLease> {
    while (true) {
      if (this.shuttingDown) {
        return { clientPromise: Promise.resolve(null) };
      }

      const redisUrl = process.env.REDIS_URL?.trim() || null;
      if (redisUrl && this.redisClient && this.redisUrl === redisUrl) {
        return { clientPromise: Promise.resolve(this.redisClient) };
      }

      const pendingAttempt = this.redisConnectionAttempt;
      if (
        redisUrl &&
        pendingAttempt?.redisUrl === redisUrl &&
        pendingAttempt.promise
      ) {
        return { clientPromise: pendingAttempt.promise };
      }

      if (pendingAttempt?.promise) {
        await pendingAttempt.promise.catch(() => undefined);
        continue;
      }

      const connectedClient = this.redisClient;
      if (connectedClient) {
        this.redisClient = null;
        this.redisUrl = null;
        await this.closeRedisClient(connectedClient);
        continue;
      }

      if (!redisUrl) {
        return { clientPromise: Promise.resolve(null) };
      }

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
      return { clientPromise: connectionPromise };
    }
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
    await this.closeRedisClient(attempt.client);
  }

  private async closeRedisClient(client: RedisClientType): Promise<void> {
    try {
      await client.quit();
    } catch {
      client.destroy();
    }
  }

  private async withRedisOwnershipTransition<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    const previousTransition = this.redisOwnershipTransition;
    let releaseTransition: () => void = () => undefined;
    this.redisOwnershipTransition = new Promise(resolve => {
      releaseTransition = resolve;
    });

    await previousTransition;
    try {
      return await operation();
    } finally {
      releaseTransition();
    }
  }
}
