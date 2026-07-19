import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import { createClient } from "redis";
import { serviceUnavailable } from "./screen-share.errors";
import {
  WORKSPACE_SCREEN_SHARE_REDIS_CHANNEL,
  WORKSPACE_SCREEN_SHARE_OUTBOX_STREAM,
  type WorkspaceScreenShareRedisEvent
} from "./screen-share.types";

type RedisEvalOptions = {
  keys: string[];
  arguments: string[];
};

type ScreenShareOutboxEntry = {
  id: string;
  message: Record<string, string>;
};

type ScreenShareRedisPublisherClient = {
  connect(): Promise<unknown>;
  destroy(): void;
  on(event: "error", listener: (error: unknown) => void): unknown;
  eval(script: string, options: RedisEvalOptions): Promise<unknown>;
  publish(channel: string, message: string): Promise<unknown>;
  quit(): Promise<unknown>;
  xRange(
    key: string,
    start: string,
    end: string,
    options: { COUNT: number }
  ): Promise<ScreenShareOutboxEntry[]>;
};

const SCREEN_SHARE_OUTBOX_RETRY_INTERVAL_MS = 1000;
const SCREEN_SHARE_OUTBOX_BATCH_SIZE = 100;

const DELIVER_OUTBOX_EVENT_SCRIPT = `
-- DELIVER_WORKSPACE_SCREEN_SHARE_OUTBOX_EVENT
local entries = redis.call("XRANGE", KEYS[1], ARGV[1], ARGV[1])
if #entries == 0 then
  return 0
end
local fields = entries[1][2]
local event = nil
for index = 1, #fields, 2 do
  if fields[index] == "event" then
    event = fields[index + 1]
    break
  end
end
if not event then
  return 0
end
local receivers = redis.call("PUBLISH", ARGV[2], event)
if receivers < 1 then
  return 0
end
redis.call("XDEL", KEYS[1], ARGV[1])
return 1
`;

@Injectable()
export class ScreenShareRealtimePublisherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    ScreenShareRealtimePublisherService.name
  );
  private client: ScreenShareRedisPublisherClient | null = null;
  private clientPromise: Promise<ScreenShareRedisPublisherClient> | null = null;
  private flushPromise: Promise<number> | null = null;
  private retryInterval: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    if (
      process.env.APP_SERVER_RUNTIME === "github-sync-worker" ||
      !process.env.REDIS_URL?.trim()
    ) {
      return;
    }
    this.retryInterval = setInterval(() => {
      void this.flushPendingEvents().catch(() => {
        this.logger.error("Screen share realtime outbox delivery failed");
      });
    }, SCREEN_SHARE_OUTBOX_RETRY_INTERVAL_MS);
    this.retryInterval.unref();
    void this.flushPendingEvents().catch(() => {
      this.logger.error("Screen share realtime outbox delivery failed");
    });
  }

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

  async flushPendingEvents(): Promise<number> {
    if (this.flushPromise) return this.flushPromise;
    const promise = this.flushPendingEventsOnce().finally(() => {
      if (this.flushPromise === promise) this.flushPromise = null;
    });
    this.flushPromise = promise;
    return promise;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }
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

  private async flushPendingEventsOnce(): Promise<number> {
    const client = await this.getClient();
    try {
      const entries = await client.xRange(
        WORKSPACE_SCREEN_SHARE_OUTBOX_STREAM,
        "-",
        "+",
        { COUNT: SCREEN_SHARE_OUTBOX_BATCH_SIZE }
      );
      let delivered = 0;
      for (const entry of entries) {
        const result = await client.eval(DELIVER_OUTBOX_EVENT_SCRIPT, {
          keys: [WORKSPACE_SCREEN_SHARE_OUTBOX_STREAM],
          arguments: [entry.id, WORKSPACE_SCREEN_SHARE_REDIS_CHANNEL]
        });
        if (result === 1) delivered += 1;
      }
      return delivered;
    } catch {
      this.clearClient(client);
      throw serviceUnavailable("Screen sharing is unavailable");
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
