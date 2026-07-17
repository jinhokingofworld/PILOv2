import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasRemoteShapePreviewStore } from "./canvas-remote-shape-preview-store.ts";

function createPreview(actorUserId, shapeIds, sentAt = "2026-07-17T00:00:00.000Z") {
  return {
    actorUserId,
    canvasId: "canvas-1",
    deletedShapeIds: [],
    phase: "unknown",
    sentAt,
    shapes: shapeIds.map((id) => ({ id, type: "draw" })),
    workspaceId: "workspace-1",
  };
}

test("사용자별 최신 preview만 외부 store에 유지한다", () => {
  const store = createCanvasRemoteShapePreviewStore();

  store.upsert(createPreview("user-b", ["shape:old"]));
  store.upsert(createPreview("user-b", ["shape:new"]));
  store.upsert(createPreview("user-a", ["shape:a"]));

  assert.deepEqual(
    store.getSnapshot().map((preview) => [
      preview.actorUserId,
      preview.shapes.map((shape) => shape.id),
    ]),
    [
      ["user-a", ["shape:a"]],
      ["user-b", ["shape:new"]],
    ],
  );
});

test("commit된 shape만 preview에서 제거하고 나머지는 유지한다", () => {
  const store = createCanvasRemoteShapePreviewStore();

  store.upsert(createPreview("user-b", ["shape:1", "shape:2"]));
  store.removeShapeIds("user-b", ["shape:1"]);

  assert.deepEqual(
    store.getSnapshot()[0].shapes.map((shape) => shape.id),
    ["shape:2"],
  );
  store.removeShapeIds("user-b", ["shape:2"]);
  assert.deepEqual(store.getSnapshot(), []);
});

test("오래된 preview를 정리한다", () => {
  const store = createCanvasRemoteShapePreviewStore();

  store.upsert(createPreview("user-a", ["shape:a"], "2026-07-17T00:00:00.000Z"));
  store.upsert(createPreview("user-b", ["shape:b"], "2026-07-17T00:00:10.000Z"));
  store.sweepStale(new Date("2026-07-17T00:00:05.000Z").getTime());

  assert.deepEqual(
    store.getSnapshot().map((preview) => preview.actorUserId),
    ["user-b"],
  );
});
