import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";
import type { CanvasShapeOperationPayload } from "./canvas.types";

export const CANVAS_OPERATION_REDIS_CHANNEL = "canvas:operations";

@Injectable()
export class CanvasOperationPublisherService implements OnModuleDestroy {
  private redisClient: RedisClientType | null = null;
  private redisUrl: string | null = null;

  async publishOperation(operation: CanvasShapeOperationPayload): Promise<void> {
    const client = await this.getClient();

    if (!client) {
      return;
    }

    await client.publish(
      CANVAS_OPERATION_REDIS_CHANNEL,
      JSON.stringify(operation)
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
      console.error("Canvas operation Redis publish failed", error);
    });

    await client.connect();
    this.redisClient = client as RedisClientType;
    this.redisUrl = redisUrl;

    return this.redisClient;
  }
}
