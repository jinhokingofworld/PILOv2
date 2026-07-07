import { createAdapter } from "@socket.io/redis-adapter";
import { createClient, type RedisClientType } from "redis";

export type RedisPubSubStatus = "disabled" | "connected";

export type RedisPubSubClient = {
  publish: (channel: string, payload: unknown) => Promise<void>;
  status: RedisPubSubStatus;
  subscribe: (
    channel: string,
    handler: (payload: unknown) => void,
  ) => Promise<() => Promise<void>>;
};

export function createNoopRedisPubSub(): RedisPubSubClient {
  return {
    status: "disabled",
    async publish() {
      return Promise.resolve();
    },
    async subscribe() {
      return async () => Promise.resolve();
    },
  };
}

export type SocketIoRedisAdapterHandle = {
  adapter: ReturnType<typeof createAdapter>;
  close: () => Promise<void>;
};

export async function createSocketIoRedisAdapter(
  redisUrl: string,
): Promise<SocketIoRedisAdapterHandle> {
  const pubClient = createClient({ url: redisUrl });
  const subClient = pubClient.duplicate();

  pubClient.on("error", (error) => {
    console.error("Redis pub client error", error);
  });

  subClient.on("error", (error) => {
    console.error("Redis sub client error", error);
  });

  await pubClient.connect();
  await subClient.connect();

  return {
    adapter: createAdapter(
      pubClient as RedisClientType,
      subClient as RedisClientType,
    ),
    async close() {
      await Promise.allSettled([pubClient.quit(), subClient.quit()]);
    },
  };
}
