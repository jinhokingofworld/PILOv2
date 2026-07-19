import { Injectable } from "@nestjs/common";
import { createClient } from "redis";
import { serviceUnavailable } from "./screen-share.errors";
import {
  parseWorkspaceScreenShareSession,
  SCREEN_SHARE_STATE_TTL_SECONDS,
  type WorkspaceScreenShareSession
} from "./screen-share.types";

type RedisEvalOptions = {
  keys: string[];
  arguments: string[];
};

type ScreenShareRedisClient = {
  connect(): Promise<unknown>;
  destroy(): void;
  eval(script: string, options: RedisEvalOptions): Promise<unknown>;
  get(key: string): Promise<string | null>;
  on(event: "error", listener: (error: unknown) => void): unknown;
};

export type ActivateScreenShareInput = {
  workspaceId: string;
  sessionId: string;
  livekitRoomName: string;
  startedAt: string;
};

export type EndScreenShareInput = {
  workspaceId: string;
  sessionId: string;
  livekitRoomName: string;
};

export type StartingReservationOwnershipInput = EndScreenShareInput & {
  rollbackAttemptId: string;
};

const RESERVE_SESSION_SCRIPT = `
-- RESERVE_WORKSPACE_SCREEN_SHARE
if redis.call("EXISTS", KEYS[1]) == 1 or redis.call("EXISTS", KEYS[2]) == 1 then
  return 0
end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], ARGV[3], "EX", ARGV[2])
redis.call("SET", KEYS[3], ARGV[4], "EX", ARGV[2])
return 1
`;

const ACTIVATE_SESSION_SCRIPT = `
-- ACTIVATE_WORKSPACE_SCREEN_SHARE
local encoded = redis.call("GET", KEYS[1])
if not encoded then
  return false
end
local session = cjson.decode(encoded)
if session.sessionId ~= ARGV[1] or session.livekitRoomName ~= ARGV[2] then
  return false
end
local workspaceId = redis.call("GET", KEYS[2])
if workspaceId ~= session.workspaceId then
  return false
end
if session.status == "active" then
  redis.call("DEL", KEYS[3])
  return encoded
end
if session.status ~= "starting" then
  return false
end
session.status = "active"
session.startedAt = ARGV[3]
local updated = cjson.encode(session)
redis.call("SET", KEYS[1], updated, "EX", ARGV[4])
redis.call("EXPIRE", KEYS[2], ARGV[4])
redis.call("DEL", KEYS[3])
return updated
`;

const END_SESSION_SCRIPT = `
-- END_WORKSPACE_SCREEN_SHARE
local encoded = redis.call("GET", KEYS[1])
if not encoded then
  return false
end
local session = cjson.decode(encoded)
if session.sessionId ~= ARGV[1] or session.livekitRoomName ~= ARGV[2] then
  return false
end
local workspaceId = redis.call("GET", KEYS[2])
if workspaceId ~= session.workspaceId then
  return false
end
redis.call("DEL", KEYS[1], KEYS[2], KEYS[3])
return encoded
`;

const CLAIM_STARTING_SESSION_SCRIPT = `
-- CLAIM_STARTING_WORKSPACE_SCREEN_SHARE
local encoded = redis.call("GET", KEYS[1])
if not encoded then
  return 0
end
local session = cjson.decode(encoded)
if session.sessionId ~= ARGV[1] or session.livekitRoomName ~= ARGV[2] or session.status ~= "starting" then
  return 0
end
local workspaceId = redis.call("GET", KEYS[2])
if workspaceId ~= session.workspaceId then
  return 0
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl <= 0 then
  return 0
end
redis.call("SET", KEYS[3], ARGV[3], "PX", ttl)
return 1
`;

const RELEASE_STARTING_SESSION_SCRIPT = `
-- RELEASE_STARTING_WORKSPACE_SCREEN_SHARE
local encoded = redis.call("GET", KEYS[1])
if not encoded then
  return false
end
local session = cjson.decode(encoded)
if session.sessionId ~= ARGV[1] or session.livekitRoomName ~= ARGV[2] or session.status ~= "starting" then
  return false
end
local rollbackAttemptId = redis.call("GET", KEYS[3])
if rollbackAttemptId ~= ARGV[3] then
  return false
end
local workspaceId = redis.call("GET", KEYS[2])
if workspaceId ~= session.workspaceId then
  return false
end
redis.call("DEL", KEYS[1], KEYS[2], KEYS[3])
return encoded
`;

@Injectable()
export class ScreenShareStateService {
  private client: ScreenShareRedisClient | null = null;
  private clientPromise: Promise<ScreenShareRedisClient> | null = null;

  async getCurrent(
    workspaceId: string
  ): Promise<WorkspaceScreenShareSession | null> {
    const value = await this.runRedisCommand(client =>
      client.get(this.workspaceKey(workspaceId))
    );
    return value === null ? null : parseWorkspaceScreenShareSession(value);
  }

  async getByRoom(
    livekitRoomName: string
  ): Promise<WorkspaceScreenShareSession | null> {
    const lookup = await this.runRedisCommand(async client => {
      const workspaceId = await client.get(this.roomKey(livekitRoomName));
      if (workspaceId === null) return null;
      const value = await client.get(this.workspaceKey(workspaceId));
      return value === null ? null : { workspaceId, value };
    });
    if (lookup === null) return null;

    const current = parseWorkspaceScreenShareSession(lookup.value);
    return current.workspaceId === lookup.workspaceId &&
      current.livekitRoomName === livekitRoomName
      ? current
      : null;
  }

  async reserve(
    session: WorkspaceScreenShareSession,
    rollbackAttemptId: string
  ): Promise<boolean> {
    const result = await this.runRedisCommand(client =>
      client.eval(RESERVE_SESSION_SCRIPT, {
        keys: [
          this.workspaceKey(session.workspaceId),
          this.roomKey(session.livekitRoomName),
          this.rollbackKey(session.sessionId)
        ],
        arguments: [
          JSON.stringify(session),
          String(SCREEN_SHARE_STATE_TTL_SECONDS),
          session.workspaceId,
          rollbackAttemptId
        ]
      })
    );
    return result === 1;
  }

  async activate(
    input: ActivateScreenShareInput
  ): Promise<WorkspaceScreenShareSession | null> {
    const value = await this.runRedisCommand(client =>
      client.eval(ACTIVATE_SESSION_SCRIPT, {
        keys: [
          this.workspaceKey(input.workspaceId),
          this.roomKey(input.livekitRoomName),
          this.rollbackKey(input.sessionId)
        ],
        arguments: [
          input.sessionId,
          input.livekitRoomName,
          input.startedAt,
          String(SCREEN_SHARE_STATE_TTL_SECONDS)
        ]
      })
    );
    return typeof value === "string"
      ? parseWorkspaceScreenShareSession(value)
      : null;
  }

  async endIfCurrent(
    input: EndScreenShareInput
  ): Promise<WorkspaceScreenShareSession | null> {
    const value = await this.runRedisCommand(client =>
      client.eval(END_SESSION_SCRIPT, {
        keys: [
          this.workspaceKey(input.workspaceId),
          this.roomKey(input.livekitRoomName),
          this.rollbackKey(input.sessionId)
        ],
        arguments: [input.sessionId, input.livekitRoomName]
      })
    );
    return typeof value === "string"
      ? parseWorkspaceScreenShareSession(value)
      : null;
  }

  async releaseStartingIfCurrent(
    input: StartingReservationOwnershipInput
  ): Promise<WorkspaceScreenShareSession | null> {
    const value = await this.runRedisCommand(client =>
      client.eval(RELEASE_STARTING_SESSION_SCRIPT, {
        keys: [
          this.workspaceKey(input.workspaceId),
          this.roomKey(input.livekitRoomName),
          this.rollbackKey(input.sessionId)
        ],
        arguments: [
          input.sessionId,
          input.livekitRoomName,
          input.rollbackAttemptId
        ]
      })
    );
    return typeof value === "string"
      ? parseWorkspaceScreenShareSession(value)
      : null;
  }

  async claimStartingReservation(
    input: StartingReservationOwnershipInput
  ): Promise<boolean> {
    const value = await this.runRedisCommand(client =>
      client.eval(CLAIM_STARTING_SESSION_SCRIPT, {
        keys: [
          this.workspaceKey(input.workspaceId),
          this.roomKey(input.livekitRoomName),
          this.rollbackKey(input.sessionId)
        ],
        arguments: [
          input.sessionId,
          input.livekitRoomName,
          input.rollbackAttemptId
        ]
      })
    );
    return value === 1;
  }

  protected createRedisClient(redisUrl: string): ScreenShareRedisClient {
    return createClient({ url: redisUrl }) as unknown as ScreenShareRedisClient;
  }

  private async getClient(): Promise<ScreenShareRedisClient> {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) {
      throw serviceUnavailable("Screen sharing is unavailable");
    }

    if (this.client) return this.client;

    if (!this.clientPromise) {
      let client: ScreenShareRedisClient | null = null;
      try {
        const createdClient = this.createRedisClient(redisUrl);
        client = createdClient;
        createdClient.on("error", () => undefined);
        const connectionPromise = createdClient
          .connect()
          .then(() => {
            if (this.clientPromise === connectionPromise) {
              this.client = createdClient;
            }
            return createdClient;
          })
          .catch(error => {
            if (this.clientPromise === connectionPromise) {
              this.clientPromise = null;
            }
            this.destroyClient(createdClient);
            throw error;
          });
        this.clientPromise = connectionPromise;
      } catch {
        this.clientPromise = null;
        this.destroyClient(client);
        throw serviceUnavailable("Screen sharing is unavailable");
      }
    }

    try {
      return await this.clientPromise;
    } catch {
      throw serviceUnavailable("Screen sharing is unavailable");
    }
  }

  private async runRedisCommand<T>(
    operation: (client: ScreenShareRedisClient) => Promise<T>
  ): Promise<T> {
    const client = await this.getClient();
    try {
      return await operation(client);
    } catch {
      if (this.client === client) {
        this.client = null;
        this.clientPromise = null;
        this.destroyClient(client);
      }
      throw serviceUnavailable("Screen sharing is unavailable");
    }
  }

  private destroyClient(client: ScreenShareRedisClient | null): void {
    if (!client) return;
    try {
      client.destroy();
    } catch {
      // The original connection or command failure remains the API cause.
    }
  }

  private workspaceKey(workspaceId: string): string {
    return `workspace-screen-share:workspace:v1:${workspaceId}`;
  }

  private roomKey(livekitRoomName: string): string {
    return `workspace-screen-share:room:v1:${livekitRoomName}`;
  }

  private rollbackKey(sessionId: string): string {
    return `workspace-screen-share:rollback:v1:${sessionId}`;
  }
}
