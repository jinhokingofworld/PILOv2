import { randomUUID } from "node:crypto";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import { createClient } from "redis";
import { serviceUnavailable } from "./screen-share.errors";
import { ScreenShareRoomService } from "./screen-share-room.service";
import type { ScreenShareCleanupMode } from "./screen-share-state.service";
import {
  parseWorkspaceScreenShareSession,
  WORKSPACE_SCREEN_SHARE_CLEANUP_STREAM,
  type WorkspaceScreenShareSession
} from "./screen-share.types";

type RedisEvalOptions = {
  keys: string[];
  arguments: string[];
};

type ScreenShareCleanupEntry = {
  id: string;
  message: Record<string, string>;
};

type ScreenShareCleanupRedisClient = {
  connect(): Promise<unknown>;
  destroy(): void;
  eval(script: string, options: RedisEvalOptions): Promise<unknown>;
  on(event: "error", listener: (error: unknown) => void): unknown;
  quit(): Promise<unknown>;
  xRange(
    key: string,
    start: string,
    end: string,
    options: { COUNT: number }
  ): Promise<ScreenShareCleanupEntry[]>;
};

type ClaimedCleanup = {
  session: WorkspaceScreenShareSession;
  mode: ScreenShareCleanupMode;
};

const SCREEN_SHARE_CLEANUP_RETRY_INTERVAL_MS = 1000;
const SCREEN_SHARE_CLEANUP_BATCH_SIZE = 100;
const SCREEN_SHARE_CLEANUP_LOCK_TTL_MS = 30 * 1000;

const CLAIM_CLEANUP_SCRIPT = `
-- CLAIM_WORKSPACE_SCREEN_SHARE_CLEANUP
local entries = redis.call("XRANGE", KEYS[1], ARGV[1], ARGV[1])
if #entries == 0 then
  return false
end
if not redis.call("SET", KEYS[2], ARGV[2], "NX", "PX", ARGV[3]) then
  return false
end
local fields = entries[1][2]
local session = nil
local mode = nil
for index = 1, #fields, 2 do
  if fields[index] == "session" then
    session = fields[index + 1]
  elseif fields[index] == "mode" then
    mode = fields[index + 1]
  end
end
if not session or not mode then
  redis.call("DEL", KEYS[2])
  return false
end
return {session, mode}
`;

const ACK_CLEANUP_SCRIPT = `
-- ACK_WORKSPACE_SCREEN_SHARE_CLEANUP
if redis.call("GET", KEYS[2]) ~= ARGV[2] then
  return 0
end
local removed = redis.call("XDEL", KEYS[1], ARGV[1])
redis.call("DEL", KEYS[2])
return removed
`;

const RELEASE_CLEANUP_SCRIPT = `
-- RELEASE_WORKSPACE_SCREEN_SHARE_CLEANUP
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
  return 0
end
return redis.call("DEL", KEYS[1])
`;

@Injectable()
export class ScreenShareCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ScreenShareCleanupService.name);
  private readonly workerId = randomUUID();
  private client: ScreenShareCleanupRedisClient | null = null;
  private clientPromise: Promise<ScreenShareCleanupRedisClient> | null = null;
  private flushPromise: Promise<number> | null = null;
  private retryInterval: NodeJS.Timeout | null = null;

  constructor(private readonly rooms: ScreenShareRoomService) {}

  onModuleInit(): void {
    if (
      process.env.APP_SERVER_RUNTIME === "github-sync-worker" ||
      !process.env.REDIS_URL?.trim()
    ) {
      return;
    }
    this.retryInterval = setInterval(() => {
      void this.flushPendingCleanups().catch(() => {
        this.logger.error("Screen share LiveKit cleanup retry failed");
      });
    }, SCREEN_SHARE_CLEANUP_RETRY_INTERVAL_MS);
    this.retryInterval.unref();
    void this.flushPendingCleanups().catch(() => {
      this.logger.error("Screen share LiveKit cleanup retry failed");
    });
  }

  async flushPendingCleanups(): Promise<number> {
    if (this.flushPromise) return this.flushPromise;
    const promise = this.flushPendingCleanupsOnce().finally(() => {
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

  protected createRedisClient(redisUrl: string): ScreenShareCleanupRedisClient {
    return createClient({ url: redisUrl }) as unknown as ScreenShareCleanupRedisClient;
  }

  private async flushPendingCleanupsOnce(): Promise<number> {
    const client = await this.getClient();
    try {
      const entries = await client.xRange(
        WORKSPACE_SCREEN_SHARE_CLEANUP_STREAM,
        "-",
        "+",
        { COUNT: SCREEN_SHARE_CLEANUP_BATCH_SIZE }
      );
      let completed = 0;
      for (const entry of entries) {
        const lockKey = this.lockKey(entry.id);
        const claimed = this.parseClaim(
          await client.eval(CLAIM_CLEANUP_SCRIPT, {
            keys: [WORKSPACE_SCREEN_SHARE_CLEANUP_STREAM, lockKey],
            arguments: [
              entry.id,
              this.workerId,
              String(SCREEN_SHARE_CLEANUP_LOCK_TTL_MS)
            ]
          })
        );
        if (!claimed) continue;

        try {
          await this.cleanupRoom(claimed);
        } catch {
          await client.eval(RELEASE_CLEANUP_SCRIPT, {
            keys: [lockKey],
            arguments: [this.workerId]
          });
          continue;
        }

        const acknowledged = await client.eval(ACK_CLEANUP_SCRIPT, {
          keys: [WORKSPACE_SCREEN_SHARE_CLEANUP_STREAM, lockKey],
          arguments: [entry.id, this.workerId]
        });
        if (acknowledged === 1) completed += 1;
      }
      return completed;
    } catch {
      this.clearClient(client);
      throw serviceUnavailable("Screen sharing is unavailable");
    }
  }

  private async cleanupRoom(claimed: ClaimedCleanup): Promise<void> {
    if (claimed.mode === "revocation") {
      await this.rooms.removeParticipantForRevocation(claimed.session);
    } else {
      await this.rooms.removeParticipant(claimed.session);
    }
    await this.rooms.deleteRoom(claimed.session);
  }

  private parseClaim(value: unknown): ClaimedCleanup | null {
    if (
      !Array.isArray(value) ||
      typeof value[0] !== "string" ||
      (value[1] !== "normal" && value[1] !== "revocation")
    ) {
      return null;
    }
    return {
      session: parseWorkspaceScreenShareSession(value[0]),
      mode: value[1]
    };
  }

  private async getClient(): Promise<ScreenShareCleanupRedisClient> {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) throw serviceUnavailable("Screen sharing is unavailable");
    if (this.client) return this.client;
    if (!this.clientPromise) {
      try {
        const client = this.createRedisClient(redisUrl);
        client.on("error", () => undefined);
        const connectionPromise = client
          .connect()
          .then(() => {
            if (this.clientPromise === connectionPromise) this.client = client;
            return client;
          })
          .catch(() => {
            if (this.clientPromise === connectionPromise) this.clientPromise = null;
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

  private clearClient(client: ScreenShareCleanupRedisClient): void {
    if (this.client === client) {
      this.client = null;
      this.clientPromise = null;
    }
    this.destroyClient(client);
  }

  private destroyClient(client: ScreenShareCleanupRedisClient): void {
    try {
      client.destroy();
    } catch {
      // Preserve the original Redis failure as the cause.
    }
  }

  private lockKey(entryId: string): string {
    return `workspace-screen-share:cleanup-lock:v1:${entryId}`;
  }
}
