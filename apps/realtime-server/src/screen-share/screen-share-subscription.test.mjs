import assert from "node:assert/strict";
import test from "node:test";

const subscriptionModule = await import(
  "../../dist/screen-share/screen-share-subscription.js"
).catch(() => null);

test("socket screen-share subscription fans out the exact Redis channel and awaits close", async () => {
  assert.ok(
    subscriptionModule,
    "screen-share Redis subscription helper must exist",
  );

  const calls = [];
  let releaseUnsubscribe;
  let unsubscribeFinished = false;
  const unsubscribeGate = new Promise((resolve) => {
    releaseUnsubscribe = resolve;
  });
  const redisAdapter = {
    async subscribe(channel, handler) {
      calls.push({ channel, handler });
      return async () => {
        calls.push({ type: "unsubscribe" });
        await unsubscribeGate;
        unsubscribeFinished = true;
      };
    },
  };
  const fanOutValues = [];
  const subscription = await subscriptionModule.createScreenShareSubscription({
    fanOut: {
      fanOut(value) {
        fanOutValues.push(value);
        return true;
      },
    },
    redisAdapter,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].channel, "workspace-screen-share:events:v1");
  const payload = { event: "workspace-screen-share:started" };
  calls[0].handler(payload);
  assert.deepEqual(fanOutValues, [payload]);

  const closePromise = subscription.close();
  await Promise.resolve();
  assert.equal(unsubscribeFinished, false);
  assert.deepEqual(calls.at(-1), { type: "unsubscribe" });
  releaseUnsubscribe();
  await closePromise;
  assert.equal(unsubscribeFinished, true);
});
