import { Injectable } from "@nestjs/common";
import { createClient } from "redis";
import { serviceUnavailable } from "./screen-share.errors";
import {
  parseWorkspaceScreenShareSession,
  SCREEN_SHARE_ENDED_ROOM_TOMBSTONE_TTL_SECONDS,
  SCREEN_SHARE_STATE_TTL_SECONDS,
  SCREEN_SHARE_VIEWER_REGISTRY_TTL_SECONDS,
  WORKSPACE_SCREEN_SHARE_CLEANUP_STREAM,
  WORKSPACE_SCREEN_SHARE_OUTBOX_STREAM,
  WORKSPACE_SCREEN_SHARE_VIEWER_REVOCATIONS,
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

export type ClaimStartingReservationInput = StartingReservationOwnershipInput & {
  claimedAt: string;
};

export type ScreenShareStateTransition = {
  session: WorkspaceScreenShareSession;
  outboxId: string | null;
  cleanupId: string | null;
};

export type ScreenShareCleanupMode = "normal" | "revocation";

export type ReplaceExpiredStartingInput = EndScreenShareInput & {
  createdAt: string;
  expiredBefore: string;
};

export type ViewerIdentityInput = EndScreenShareInput & {
  userId: string;
  identity: string;
};

export type DrainViewerIdentitiesInput = EndScreenShareInput & {
  userId: string;
};

export type ViewerRevocationTask = DrainViewerIdentitiesInput;

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
  return {encoded, "", ""}
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
local event = cjson.encode({
  version = 1,
  event = "workspace-screen-share:started",
  workspaceId = session.workspaceId,
  session = {
    id = session.sessionId,
    sharer = {
      userId = session.sharerUserId,
      displayName = session.sharerDisplayName,
      avatarUrl = session.sharerAvatarUrl
    },
    startedAt = session.startedAt
  }
})
local outboxId = redis.call("XADD", KEYS[4], "*", "event", event)
return {updated, outboxId, ""}
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
local event = cjson.encode({
  version = 1,
  event = "workspace-screen-share:ended",
  workspaceId = session.workspaceId,
  sessionId = session.sessionId
})
local outboxId = redis.call("XADD", KEYS[4], "*", "event", event)
local cleanupId = redis.call("XADD", KEYS[6], "*", "session", encoded, "mode", ARGV[4])
local viewerKeys = redis.call("SMEMBERS", KEYS[7])
for _, viewerKey in ipairs(viewerKeys) do
  redis.call("DEL", viewerKey)
end
redis.call("DEL", KEYS[7])
redis.call("DEL", KEYS[1], KEYS[2], KEYS[3])
redis.call("SET", KEYS[5], session.sessionId, "EX", ARGV[3])
return {encoded, outboxId, cleanupId}
`;

const REGISTER_VIEWER_IDENTITY_SCRIPT = `
-- REGISTER_WORKSPACE_SCREEN_SHARE_VIEWER_IDENTITY
local encoded = redis.call("GET", KEYS[1])
if not encoded then
  return 0
end
local session = cjson.decode(encoded)
if session.sessionId ~= ARGV[1] or session.livekitRoomName ~= ARGV[2] or session.status ~= "active" then
  return 0
end
local workspaceId = redis.call("GET", KEYS[2])
if workspaceId ~= session.workspaceId then
  return 0
end
redis.call("SADD", KEYS[3], ARGV[3])
redis.call("EXPIRE", KEYS[3], ARGV[4])
redis.call("SADD", KEYS[4], KEYS[3])
redis.call("EXPIRE", KEYS[4], ARGV[4])
return 1
`;

const REMOVE_VIEWER_IDENTITY_SCRIPT = `
-- REMOVE_WORKSPACE_SCREEN_SHARE_VIEWER_IDENTITY
local encoded = redis.call("GET", KEYS[1])
if not encoded then
  return 0
end
local session = cjson.decode(encoded)
if session.sessionId ~= ARGV[1] or session.livekitRoomName ~= ARGV[2] then
  return 0
end
redis.call("SREM", KEYS[2], ARGV[3])
if redis.call("SCARD", KEYS[2]) == 0 then
  redis.call("DEL", KEYS[2])
  redis.call("SREM", KEYS[3], KEYS[2])
end
return 1
`;

const LIST_VIEWER_IDENTITIES_SCRIPT = `
-- LIST_WORKSPACE_SCREEN_SHARE_VIEWER_IDENTITIES
local encoded = redis.call("GET", KEYS[1])
if not encoded then
  return false
end
local session = cjson.decode(encoded)
if session.sessionId ~= ARGV[1] or session.livekitRoomName ~= ARGV[2] then
  return false
end
return redis.call("SMEMBERS", KEYS[2])
`;

const DRAIN_VIEWER_IDENTITIES_SCRIPT = `
-- DRAIN_WORKSPACE_SCREEN_SHARE_VIEWER_IDENTITIES
local encoded = redis.call("GET", KEYS[1])
if not encoded then
  return false
end
local session = cjson.decode(encoded)
if session.sessionId ~= ARGV[1] or session.livekitRoomName ~= ARGV[2] then
  return false
end
local identities = redis.call("SMEMBERS", KEYS[2])
redis.call("DEL", KEYS[2])
redis.call("SREM", KEYS[3], KEYS[2])
return identities
`;

const ENQUEUE_VIEWER_REVOCATION_SCRIPT = `
-- ENQUEUE_WORKSPACE_SCREEN_SHARE_VIEWER_REVOCATION
local encoded = redis.call("GET", KEYS[1])
if not encoded then
  return 0
end
local session = cjson.decode(encoded)
if session.sessionId ~= ARGV[1] or session.livekitRoomName ~= ARGV[2] then
  return 0
end
return redis.call("ZADD", KEYS[2], "NX", ARGV[4], ARGV[3])
`;

const CLAIM_VIEWER_REVOCATION_SCRIPT = `
-- CLAIM_WORKSPACE_SCREEN_SHARE_VIEWER_REVOCATION
local tasks = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", ARGV[1], "LIMIT", 0, 1)
if #tasks == 0 then
  return false
end
redis.call("ZADD", KEYS[1], ARGV[2], tasks[1])
return tasks[1]
`;

const COMPLETE_VIEWER_REVOCATION_SCRIPT = `
-- COMPLETE_WORKSPACE_SCREEN_SHARE_VIEWER_REVOCATION
if redis.call("SCARD", KEYS[2]) == 0 then
  redis.call("ZREM", KEYS[1], ARGV[1])
  return 1
end
redis.call("ZADD", KEYS[1], ARGV[2], ARGV[1])
return 0
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
session.createdAt = ARGV[4]
local updated = cjson.encode(session)
redis.call("SET", KEYS[1], updated, "PX", ttl)
return updated
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

const REPLACE_EXPIRED_STARTING_SESSION_SCRIPT = `
-- REPLACE_EXPIRED_STARTING_WORKSPACE_SCREEN_SHARE
local encoded = redis.call("GET", KEYS[1])
if not encoded then
  return 0
end
local session = cjson.decode(encoded)
if session.sessionId ~= ARGV[1] or session.livekitRoomName ~= ARGV[2] or session.status ~= "starting" then
  return 0
end
if session.createdAt ~= ARGV[3] or session.createdAt > ARGV[4] then
  return 0
end
local workspaceId = redis.call("GET", KEYS[2])
if workspaceId ~= session.workspaceId then
  return 0
end
if redis.call("EXISTS", KEYS[4]) == 1 then
  return 0
end
local candidate = cjson.decode(ARGV[5])
if candidate.workspaceId ~= session.workspaceId or candidate.status ~= "starting" then
  return 0
end
redis.call("DEL", KEYS[2], KEYS[3])
redis.call("SET", KEYS[1], ARGV[5], "EX", ARGV[6])
redis.call("SET", KEYS[4], candidate.workspaceId, "EX", ARGV[6])
redis.call("SET", KEYS[5], ARGV[7], "EX", ARGV[6])
redis.call("SET", KEYS[6], session.sessionId, "EX", ARGV[8])
redis.call("XADD", KEYS[7], "*", "session", encoded, "mode", "revocation")
return 1
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

  async isKnownScreenShareRoom(livekitRoomName: string): Promise<boolean> {
    return this.runRedisCommand(async client =>
      (await client.get(this.roomKey(livekitRoomName))) !== null ||
      (await client.get(this.endedRoomKey(livekitRoomName))) !== null
    );
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
  ): Promise<ScreenShareStateTransition | null> {
    const value = await this.runRedisCommand(client =>
      client.eval(ACTIVATE_SESSION_SCRIPT, {
        keys: [
          this.workspaceKey(input.workspaceId),
          this.roomKey(input.livekitRoomName),
          this.rollbackKey(input.sessionId),
          WORKSPACE_SCREEN_SHARE_OUTBOX_STREAM
        ],
        arguments: [
          input.sessionId,
          input.livekitRoomName,
          input.startedAt,
          String(SCREEN_SHARE_STATE_TTL_SECONDS)
        ]
      })
    );
    return this.parseTransition(value);
  }

  async terminateIfCurrent(
    input: EndScreenShareInput,
    cleanupMode: ScreenShareCleanupMode = "revocation"
  ): Promise<ScreenShareStateTransition | null> {
    const value = await this.runRedisCommand(client =>
      client.eval(END_SESSION_SCRIPT, {
        keys: [
          this.workspaceKey(input.workspaceId),
          this.roomKey(input.livekitRoomName),
          this.rollbackKey(input.sessionId),
          WORKSPACE_SCREEN_SHARE_OUTBOX_STREAM,
          this.endedRoomKey(input.livekitRoomName),
          WORKSPACE_SCREEN_SHARE_CLEANUP_STREAM,
          this.viewerIndexKey(input.workspaceId, input.sessionId)
        ],
        arguments: [
          input.sessionId,
          input.livekitRoomName,
          String(SCREEN_SHARE_ENDED_ROOM_TOMBSTONE_TTL_SECONDS),
          cleanupMode
        ]
      })
    );
    return this.parseTransition(value);
  }

  async registerViewerIdentity(input: ViewerIdentityInput): Promise<boolean> {
    const value = await this.runRedisCommand(client =>
      client.eval(REGISTER_VIEWER_IDENTITY_SCRIPT, {
        keys: [
          this.workspaceKey(input.workspaceId),
          this.roomKey(input.livekitRoomName),
          this.viewerIdentityKey(
            input.workspaceId,
            input.sessionId,
            input.userId
          ),
          this.viewerIndexKey(input.workspaceId, input.sessionId)
        ],
        arguments: [
          input.sessionId,
          input.livekitRoomName,
          input.identity,
          String(SCREEN_SHARE_VIEWER_REGISTRY_TTL_SECONDS)
        ]
      })
    );
    return value === 1;
  }

  async removeViewerIdentityIfCurrent(
    input: ViewerIdentityInput
  ): Promise<boolean> {
    const value = await this.runRedisCommand(client =>
      client.eval(REMOVE_VIEWER_IDENTITY_SCRIPT, {
        keys: [
          this.workspaceKey(input.workspaceId),
          this.viewerIdentityKey(
            input.workspaceId,
            input.sessionId,
            input.userId
          ),
          this.viewerIndexKey(input.workspaceId, input.sessionId)
        ],
        arguments: [
          input.sessionId,
          input.livekitRoomName,
          input.identity
        ]
      })
    );
    return value === 1;
  }

  async drainViewerIdentities(
    input: DrainViewerIdentitiesInput
  ): Promise<string[]> {
    const value = await this.runRedisCommand(client =>
      client.eval(DRAIN_VIEWER_IDENTITIES_SCRIPT, {
        keys: [
          this.workspaceKey(input.workspaceId),
          this.viewerIdentityKey(
            input.workspaceId,
            input.sessionId,
            input.userId
          ),
          this.viewerIndexKey(input.workspaceId, input.sessionId)
        ],
        arguments: [input.sessionId, input.livekitRoomName]
      })
    );
    return Array.isArray(value)
      ? value.filter((identity): identity is string =>
          typeof identity === "string"
        )
      : [];
  }

  async listViewerIdentities(
    input: DrainViewerIdentitiesInput
  ): Promise<string[]> {
    const value = await this.runRedisCommand(client =>
      client.eval(LIST_VIEWER_IDENTITIES_SCRIPT, {
        keys: [
          this.workspaceKey(input.workspaceId),
          this.viewerIdentityKey(
            input.workspaceId,
            input.sessionId,
            input.userId
          )
        ],
        arguments: [input.sessionId, input.livekitRoomName]
      })
    );
    return Array.isArray(value)
      ? value.filter((identity): identity is string =>
          typeof identity === "string"
        )
      : [];
  }

  async enqueueViewerRevocation(
    input: ViewerRevocationTask,
    dueAtMs: number
  ): Promise<boolean> {
    const encoded = JSON.stringify(input);
    const value = await this.runRedisCommand(client =>
      client.eval(ENQUEUE_VIEWER_REVOCATION_SCRIPT, {
        keys: [
          this.workspaceKey(input.workspaceId),
          WORKSPACE_SCREEN_SHARE_VIEWER_REVOCATIONS
        ],
        arguments: [
          input.sessionId,
          input.livekitRoomName,
          encoded,
          String(dueAtMs)
        ]
      })
    );
    return value === 1;
  }

  async claimDueViewerRevocation(
    nowMs: number,
    leaseUntilMs: number
  ): Promise<ViewerRevocationTask | null> {
    const value = await this.runRedisCommand(client =>
      client.eval(CLAIM_VIEWER_REVOCATION_SCRIPT, {
        keys: [WORKSPACE_SCREEN_SHARE_VIEWER_REVOCATIONS],
        arguments: [String(nowMs), String(leaseUntilMs)]
      })
    );
    if (typeof value !== "string") return null;
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("workspaceId" in parsed) ||
      !("sessionId" in parsed) ||
      !("livekitRoomName" in parsed) ||
      !("userId" in parsed) ||
      typeof parsed.workspaceId !== "string" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.livekitRoomName !== "string" ||
      typeof parsed.userId !== "string"
    ) {
      throw new Error("Invalid screen share viewer revocation task");
    }
    return {
      workspaceId: parsed.workspaceId,
      sessionId: parsed.sessionId,
      livekitRoomName: parsed.livekitRoomName,
      userId: parsed.userId
    };
  }

  async completeViewerRevocation(
    input: ViewerRevocationTask,
    retryAtMs: number
  ): Promise<boolean> {
    const encoded = JSON.stringify(input);
    const value = await this.runRedisCommand(client =>
      client.eval(COMPLETE_VIEWER_REVOCATION_SCRIPT, {
        keys: [
          WORKSPACE_SCREEN_SHARE_VIEWER_REVOCATIONS,
          this.viewerIdentityKey(
            input.workspaceId,
            input.sessionId,
            input.userId
          )
        ],
        arguments: [encoded, String(retryAtMs)]
      })
    );
    return value === 1;
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
    input: ClaimStartingReservationInput
  ): Promise<WorkspaceScreenShareSession | null> {
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
          input.rollbackAttemptId,
          input.claimedAt
        ]
      })
    );
    return typeof value === "string"
      ? parseWorkspaceScreenShareSession(value)
      : null;
  }

  async replaceExpiredStartingIfCurrent(
    input: ReplaceExpiredStartingInput,
    candidate: WorkspaceScreenShareSession,
    rollbackAttemptId: string
  ): Promise<boolean> {
    const value = await this.runRedisCommand(client =>
      client.eval(REPLACE_EXPIRED_STARTING_SESSION_SCRIPT, {
        keys: [
          this.workspaceKey(input.workspaceId),
          this.roomKey(input.livekitRoomName),
          this.rollbackKey(input.sessionId),
          this.roomKey(candidate.livekitRoomName),
          this.rollbackKey(candidate.sessionId),
          this.endedRoomKey(input.livekitRoomName),
          WORKSPACE_SCREEN_SHARE_CLEANUP_STREAM
        ],
        arguments: [
          input.sessionId,
          input.livekitRoomName,
          input.createdAt,
          input.expiredBefore,
          JSON.stringify(candidate),
          String(SCREEN_SHARE_STATE_TTL_SECONDS),
          rollbackAttemptId,
          String(SCREEN_SHARE_ENDED_ROOM_TOMBSTONE_TTL_SECONDS)
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

  private endedRoomKey(livekitRoomName: string): string {
    return `workspace-screen-share:ended-room:v1:${livekitRoomName}`;
  }

  private viewerIdentityKey(
    workspaceId: string,
    sessionId: string,
    userId: string
  ): string {
    return `workspace-screen-share:viewers:v1:${workspaceId}:${sessionId}:${userId}`;
  }

  private viewerIndexKey(workspaceId: string, sessionId: string): string {
    return `workspace-screen-share:viewer-index:v1:${workspaceId}:${sessionId}`;
  }

  private parseTransition(value: unknown): ScreenShareStateTransition | null {
    if (
      !Array.isArray(value) ||
      typeof value[0] !== "string" ||
      typeof value[1] !== "string" ||
      typeof value[2] !== "string"
    ) {
      return null;
    }
    return {
      session: parseWorkspaceScreenShareSession(value[0]),
      outboxId: value[1] || null,
      cleanupId: value[2] || null
    };
  }
}
