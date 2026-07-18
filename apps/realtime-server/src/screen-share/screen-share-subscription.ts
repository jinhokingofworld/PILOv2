import type { SocketIoRedisAdapterHandle } from "../redis/redis-pubsub";
import { WORKSPACE_SCREEN_SHARE_REDIS_CHANNEL } from "./screen-share-events";

export type ScreenShareSubscriptionOptions = {
  fanOut: {
    fanOut(value: unknown): boolean;
  };
  onInvalid?: (value: unknown) => void;
  redisAdapter: Pick<SocketIoRedisAdapterHandle, "subscribe">;
};

export async function createScreenShareSubscription({
  fanOut,
  onInvalid,
  redisAdapter,
}: ScreenShareSubscriptionOptions) {
  const unsubscribe = await redisAdapter.subscribe(
    WORKSPACE_SCREEN_SHARE_REDIS_CHANNEL,
    (payload) => {
      if (!fanOut.fanOut(payload)) onInvalid?.(payload);
    },
  );

  return {
    async close() {
      await unsubscribe();
    },
  };
}
