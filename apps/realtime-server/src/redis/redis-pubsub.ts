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

export type RedisStateClient = {
  del: (keys: string[]) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  keys: (pattern: string) => Promise<string[]>;
  set: (
    key: string,
    value: string,
    options?: { mode?: "NX"; px?: number },
  ) => Promise<"OK" | null>;
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
  stateClient: RedisStateClient;
  subscribe: (
    channel: string,
    handler: (payload: unknown) => void,
  ) => Promise<() => Promise<void>>;
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
    stateClient: {
      async del(keys) {
        if (!keys.length) return;

        await pubClient.del(keys);
      },
      async get(key) {
        return pubClient.get(key);
      },
      async keys(pattern) {
        return pubClient.keys(pattern);
      },
      async set(key, value, options) {
        const result =
          options?.mode === "NX"
            ? await pubClient.set(key, value, {
                NX: true,
                ...(options.px ? { PX: options.px } : {}),
              })
            : await pubClient.set(key, value, {
                ...(options?.px ? { PX: options.px } : {}),
              });

        return result === "OK" ? result : null;
      },
    },
    async subscribe(channel, handler) {
      await subClient.subscribe(channel, (message) => {
        try {
          handler(JSON.parse(message) as unknown);
        } catch (error) {
          console.error("Redis subscription payload parse failed", error);
        }
      });

      return async () => {
        await subClient.unsubscribe(channel);
      };
    },
  };
}
