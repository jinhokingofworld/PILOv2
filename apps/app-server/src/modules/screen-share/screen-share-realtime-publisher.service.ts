import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createClient } from "redis";
import { serviceUnavailable } from "./screen-share.errors";
import {
  WORKSPACE_SCREEN_SHARE_REDIS_CHANNEL,
  type WorkspaceScreenShareRedisEvent
} from "./screen-share.types";

type ScreenShareRedisPublisherClient = {
  connect(): Promise<unknown>;
  destroy(): void;
  on(event: "error", listener: (error: unknown) => void): unknown;
  publish(channel: string, message: string): Promise<unknown>;
  quit(): Promise<unknown>;
};

@Injectable()
export class ScreenShareRealtimePublisherService implements OnModuleDestroy {
  private client: ScreenShareRedisPublisherClient | null = null;
  private clientPromise: Promise<ScreenShareRedisPublisherClient> | null = null;

  async publish(event: WorkspaceScreenShareRedisEvent): Promise<void> {
    const client = await this.getClient();
    try {
      await client.publish(
        WORKSPACE_SCREEN_SHARE_REDIS_CHANNEL,
        JSON.stringify(event)
      );
    } catch {
      this.clearClient(client);
      throw serviceUnavailable("Screen sharing is unavailable");
    }
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.clientPromise = null;
    if (!client) return;

    try {
      await client.quit();
    } catch {
      this.destroyClient(client);
    }
  }

  protected createRedisClient(
    redisUrl: string
  ): ScreenShareRedisPublisherClient {
    return createClient({
      url: redisUrl
    }) as unknown as ScreenShareRedisPublisherClient;
  }

  private async getClient(): Promise<ScreenShareRedisPublisherClient> {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) {
      throw serviceUnavailable("Screen sharing is unavailable");
    }

    if (this.client) return this.client;

    if (!this.clientPromise) {
      try {
        const client = this.createRedisClient(redisUrl);
        client.on("error", () => undefined);
        const connectionPromise = client
          .connect()
          .then(() => {
            if (this.clientPromise === connectionPromise) {
              this.client = client;
            }
            return client;
          })
          .catch(() => {
            if (this.clientPromise === connectionPromise) {
              this.clientPromise = null;
            }
            this.destroyClient(client);
            throw serviceUnavailable("Screen sharing is unavailable");
          });
        this.clientPromise = connectionPromise;
      } catch {
        this.clientPromise = null;
        throw serviceUnavailable("Screen sharing is unavailable");
      }
    }

    return this.clientPromise;
  }

  private clearClient(client: ScreenShareRedisPublisherClient): void {
    if (this.client === client) {
      this.client = null;
      this.clientPromise = null;
    }
    this.destroyClient(client);
  }

  private destroyClient(client: ScreenShareRedisPublisherClient): void {
    try {
      client.destroy();
    } catch {
      // Preserve the original Redis failure as the API cause.
    }
  }
}
