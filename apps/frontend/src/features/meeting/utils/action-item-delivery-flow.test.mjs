import assert from "node:assert/strict";
import test from "node:test";

import { saveThenDeliverActionItem } from "./action-item-delivery-flow.ts";

test("후속 작업 저장이 실패하면 외부 전달을 실행하지 않는다", async () => {
  const calls = [];

  const delivered = await saveThenDeliverActionItem({
    needsSave: true,
    save: async () => {
      calls.push("save");
      return false;
    },
    deliver: async () => {
      calls.push("deliver");
    }
  });

  assert.equal(delivered, false);
  assert.deepEqual(calls, ["save"]);
});

test("후속 작업 저장이 예외로 실패하면 외부 전달을 실행하지 않는다", async () => {
  const calls = [];

  await assert.rejects(
    saveThenDeliverActionItem({
      needsSave: true,
      save: async () => {
        calls.push("save");
        throw new Error("PATCH failed");
      },
      deliver: async () => {
        calls.push("deliver");
      }
    }),
    /PATCH failed/
  );

  assert.deepEqual(calls, ["save"]);
});

test("후속 작업 저장이 성공하면 저장 후 외부 전달을 실행한다", async () => {
  const calls = [];

  const delivered = await saveThenDeliverActionItem({
    needsSave: true,
    save: async () => {
      calls.push("save");
      return true;
    },
    deliver: async () => {
      calls.push("deliver");
    }
  });

  assert.equal(delivered, true);
  assert.deepEqual(calls, ["save", "deliver"]);
});
