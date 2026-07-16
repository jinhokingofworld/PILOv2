import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasRemoteCursorStore } from "./canvas-remote-cursor-store.ts";

function presence(userId, x, y, displayName = userId) {
  return {
    cursor: { x, y },
    displayName,
    userId,
  };
}

test("remote cursor store publishes only visual cursor changes", () => {
  const store = createCanvasRemoteCursorStore();
  let publishCount = 0;
  const unsubscribe = store.subscribe(() => {
    publishCount += 1;
  });

  store.replace([presence("user-b", 20, 30), presence("user-a", 10, 15)]);

  assert.equal(publishCount, 1);
  assert.deepEqual(
    store.getSnapshot().map((entry) => entry.userId),
    ["user-a", "user-b"],
  );

  store.upsert(presence("user-a", 10, 15));
  assert.equal(publishCount, 1);

  store.upsert(presence("user-a", 11, 16));
  assert.equal(publishCount, 2);
  assert.deepEqual(store.getSnapshot()[0]?.cursor, { x: 11, y: 16 });

  unsubscribe();
});

test("remote cursor store removes hidden, departed, and cleared cursors", () => {
  const store = createCanvasRemoteCursorStore();

  store.replace([
    presence("user-a", 10, 15),
    {
      cursor: null,
      displayName: "Hidden",
      userId: "user-hidden",
    },
  ]);

  assert.deepEqual(
    store.getSnapshot().map((entry) => entry.userId),
    ["user-a"],
  );

  store.upsert({
    cursor: null,
    displayName: "A",
    userId: "user-a",
  });
  assert.deepEqual(store.getSnapshot(), []);

  store.upsert(presence("user-b", 20, 30));
  store.remove("user-b");
  assert.deepEqual(store.getSnapshot(), []);

  store.upsert(presence("user-c", 40, 50));
  store.clear();
  assert.deepEqual(store.getSnapshot(), []);
});
