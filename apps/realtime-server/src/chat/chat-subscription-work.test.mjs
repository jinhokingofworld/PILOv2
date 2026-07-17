import assert from "node:assert/strict";
import test from "node:test";

let subscriptionWorkModule;
try {
  subscriptionWorkModule = await import(
    "../../dist/chat/chat-subscription-work.js"
  );
} catch {
  assert.fail("Chat subscription work queue is missing");
}
const { createChatSubscriptionWorkQueue } = subscriptionWorkModule;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

test("Chat Redis event work는 enqueue 순서대로 직렬 실행한다", async () => {
  const firstGate = deferred();
  const order = [];
  const queue = createChatSubscriptionWorkQueue({ onRejected() {} });

  queue.enqueueChatEvent(async () => {
    order.push("first:start");
    await firstGate.promise;
    order.push("first:end");
  });
  queue.enqueueChatEvent(async () => {
    order.push("second:start");
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(order, ["first:start"]);

  firstGate.resolve();
  await queue.drain();
  assert.deepEqual(order, ["first:start", "first:end", "second:start"]);
});

test("Chat work rejection을 처리하고 다음 serial event를 계속 실행한다", async () => {
  const rejected = [];
  const order = [];
  const queue = createChatSubscriptionWorkQueue({
    onRejected(error) {
      rejected.push(error.message);
    },
  });

  queue.enqueueChatEvent(async () => {
    order.push("first");
    throw new Error("fan-out failed");
  });
  queue.enqueueChatEvent(async () => {
    order.push("second");
  });
  await queue.drain();

  assert.deepEqual(order, ["first", "second"]);
  assert.deepEqual(rejected, ["fan-out failed"]);
});

test("drain은 추적 중인 revocation work가 settle할 때까지 기다린다", async () => {
  const gate = deferred();
  const queue = createChatSubscriptionWorkQueue({ onRejected() {} });
  queue.trackRevocation(async () => {
    await gate.promise;
  });

  let drained = false;
  const drain = queue.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);

  gate.resolve();
  await drain;
  assert.equal(drained, true);
});
