import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import {
  WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL,
  type WorkspaceMembershipRevokedEventV1
} from "./workspace-membership-revocation.types";

export { WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL } from "./workspace-membership-revocation.types";

type RedisConnectionAttempt = {
  client: RedisClientType;
  destroyed: boolean;
  promise?: Promise<RedisClientType | null>;
  redisUrl: string;
};

type RedisClientLease = {
  clientPromise: Promise<RedisClientType | null>;
};

@Injectable()
export class WorkspaceMembershipRevocationPublisherService
  implements OnModuleDestroy
{
  private readonly logger = new Logger(
    WorkspaceMembershipRevocationPublisherService.name
  );
  private redisClient: RedisClientType | null = null;
  private redisUrl: string | null = null;
  private redisConnectionAttempt: RedisConnectionAttempt | null = null;
  private redisOwnershipTransition: Promise<void> = Promise.resolve();
  private shuttingDown = false;

  async publishMembershipRevoked(
    event: WorkspaceMembershipRevokedEventV1
  ): Promise<boolean> {
    try {
      const client = await this.getClient();
      if (!client || this.shuttingDown) return false;

      await client.publish(
        WORKSPACE_MEMBERSHIP_REVOCATION_REDIS_CHANNEL,
        JSON.stringify(event)
      );
      return true;
    } catch {
      this.logger.warn("Workspace membership revocation Redis publish failed");
      return false;
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

  private async resolveRedisClientLease(): Promise<RedisClientLease> {
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
        this.logger.error("Workspace membership revocation Redis connection error");
      });

      const attempt: RedisConnectionAttempt = {
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
    attempt: RedisConnectionAttempt
  ): Promise<RedisClientType | null> {
    try {
      await attempt.client.connect();
      if (this.shuttingDown || this.redisConnectionAttempt !== attempt) {
        await this.closeRedisClient(attempt.client);
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

  private destroyConnectionAttempt(attempt: RedisConnectionAttempt): void {
    if (attempt.destroyed) return;
    attempt.destroyed = true;
    attempt.client.destroy();
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
