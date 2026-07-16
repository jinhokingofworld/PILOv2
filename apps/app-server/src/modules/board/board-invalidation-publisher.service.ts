import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createClient } from "redis";

export const BOARD_INVALIDATION_REDIS_CHANNEL = "board:invalidations";

export type BoardInvalidationPayload = {
  workspaceId: string;
  boardId: string;
  updatedAt: string;
};

interface BoardInvalidationRedisClient {
  readonly isReady: boolean;
  connect(): Promise<unknown>;
  destroy(): void;
  on(event: "error", listener: (error: unknown) => void): unknown;
  publish(channel: string, message: string): Promise<number>;
}

type BoardInvalidationRedisClientFactory = (
  redisUrl: string
) => BoardInvalidationRedisClient;

type RedisClientFactory = (options: {
  url: string;
  disableOfflineQueue: boolean;
  socket: {
    connectTimeout: number;
    reconnectStrategy: false;
  };
}) => unknown;

interface BoardInvalidationRedisConnectionOptions {
  createClient?: BoardInvalidationRedisClientFactory;
  onError?: (error: unknown) => void;
  operationTimeoutMs?: number;
}

interface PublishOperationContext {
  client: BoardInvalidationRedisClient | null;
}

const BOARD_INVALIDATION_REDIS_CONNECT_TIMEOUT_MS = 500;
const BOARD_INVALIDATION_REDIS_OPERATION_TIMEOUT_MS = 1000;

export function createBoardInvalidationRedisClient(
  redisUrl: string,
  redisClientFactory: RedisClientFactory = createClient as RedisClientFactory
): BoardInvalidationRedisClient {
  return redisClientFactory({
    url: redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: BOARD_INVALIDATION_REDIS_CONNECT_TIMEOUT_MS,
      reconnectStrategy: false
    }
  }) as BoardInvalidationRedisClient;
}

class BoardInvalidationRedisConnection {
  private readonly createClient: BoardInvalidationRedisClientFactory;
  private readonly destroyedClients = new WeakSet<object>();
  private readonly onError: (error: unknown) => void;
  private readonly operationTimeoutMs: number;
  private redisClient: BoardInvalidationRedisClient | null = null;
  private redisClientPromise: Promise<BoardInvalidationRedisClient> | null = null;
  private redisUrl: string | null = null;
  private stopped = false;

  constructor(options: BoardInvalidationRedisConnectionOptions) {
    this.createClient = options.createClient ?? createBoardInvalidationRedisClient;
    this.onError = options.onError ?? (() => {});
    this.operationTimeoutMs =
      options.operationTimeoutMs ?? BOARD_INVALIDATION_REDIS_OPERATION_TIMEOUT_MS;
  }

  async publish(redisUrl: string, channel: string, message: string): Promise<void> {
    if (this.stopped) return;

    const context: PublishOperationContext = { client: null };
    const operation = this.publishWithClient(context, redisUrl, channel, message);
    await this.waitForOperation(operation, context);
  }

  destroy(): void {
    this.stopped = true;
    const client = this.redisClient;
    this.redisClient = null;
    this.redisClientPromise = null;
    this.redisUrl = null;
    if (client) {
      this.destroyClient(client);
    }
  }

  private async publishWithClient(
    context: PublishOperationContext,
    redisUrl: string,
    channel: string,
    message: string
  ): Promise<void> {
    const client = await this.getClient(context, redisUrl);
    if (!client || this.stopped) return;

    try {
      await client.publish(channel, message);
    } catch (error) {
      this.destroyAndResetClient(client);
      throw error;
    }
  }

  private async getClient(
    context: PublishOperationContext,
    redisUrl: string
  ): Promise<BoardInvalidationRedisClient | null> {
    if (this.stopped) return null;

    const currentClient = this.redisClient;
    if (currentClient && this.redisUrl === redisUrl) {
      context.client = currentClient;
      if (currentClient.isReady) {
        return currentClient;
      }
      if (this.redisClientPromise) {
        return this.redisClientPromise;
      }
      this.destroyAndResetClient(currentClient);
    } else if (currentClient) {
      this.destroyAndResetClient(currentClient);
    }

    if (this.stopped) return null;

    const client = this.createClient(redisUrl);
    context.client = client;
    client.on("error", this.onError);
    this.redisClient = client;
    this.redisUrl = redisUrl;

    let clientPromise: Promise<BoardInvalidationRedisClient>;
    clientPromise = Promise.resolve()
      .then(() => client.connect())
      .then(() => {
        if (this.stopped || this.redisClient !== client || !client.isReady) {
          throw new Error("Board invalidation Redis client did not become ready");
        }
        if (this.redisClientPromise === clientPromise) {
          this.redisClientPromise = null;
        }
        return client;
      })
      .catch((error: unknown) => {
        this.destroyAndResetClient(client);
        throw error;
      });
    this.redisClientPromise = clientPromise;
    return clientPromise;
  }

  private waitForOperation(
    operation: Promise<void>,
    context: PublishOperationContext
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (context.client) {
          this.destroyAndResetClient(context.client);
        }
        reject(new Error("Board invalidation Redis operation timed out"));
      }, this.operationTimeoutMs);

      operation.then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve();
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      );
    });
  }

  private destroyAndResetClient(client: BoardInvalidationRedisClient): void {
    if (this.redisClient === client) {
      this.redisClient = null;
      this.redisClientPromise = null;
      this.redisUrl = null;
    }
    this.destroyClient(client);
  }

  private destroyClient(client: BoardInvalidationRedisClient): void {
    if (this.destroyedClients.has(client)) return;
    try {
      client.destroy();
      this.destroyedClients.add(client);
    } catch {
      // Destruction is best-effort and must not hide the publish failure.
    }
  }
}

export function createBoardInvalidationRedisConnection(
  options: BoardInvalidationRedisConnectionOptions = {}
): BoardInvalidationRedisConnection {
  return new BoardInvalidationRedisConnection(options);
}

@Injectable()
export class BoardInvalidationPublisherService implements OnModuleDestroy {
  private readonly logger = new Logger(BoardInvalidationPublisherService.name);
  private readonly redisConnection = createBoardInvalidationRedisConnection({
    onError: (error) => {
      this.logger.error("Board invalidation Redis publish failed", error);
    }
  });

  async publishInvalidation(payload: BoardInvalidationPayload): Promise<void> {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) return;

    await this.redisConnection.publish(
      redisUrl,
      BOARD_INVALIDATION_REDIS_CHANNEL,
      JSON.stringify(payload)
    );
  }

  onModuleDestroy(): void {
    this.redisConnection.destroy();
  }
}
