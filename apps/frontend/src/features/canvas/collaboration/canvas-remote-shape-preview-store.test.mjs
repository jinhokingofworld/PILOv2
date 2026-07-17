import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasRemoteShapePreviewStore } from "./canvas-remote-shape-preview-store.ts";
import {
  getRemoteConnectionPreviewPath,
  readRemoteConnectionPreviewShape,
} from "../engine/editor/overlays/canvas-remote-connection-preview.ts";

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

test("committed preview remains visible until the surface applies it", () => {
  const store = createCanvasRemoteShapePreviewStore();

  store.upsert(createPreview("user-a", ["shape:a", "shape:b"]));
  store.markCommittedShapeIds("user-a", ["shape:a"]);
  store.clearActor("user-a", ["shape:a", "shape:b"]);
  store.sweepStale(new Date("2026-07-18T00:00:00.000Z").getTime());

  assert.deepEqual(
    store.getSnapshot()[0].shapes.map((shape) => shape.id),
    ["shape:a"],
  );

  store.acknowledgeAppliedShapeIds(["shape:a"]);
  assert.deepEqual(store.getSnapshot(), []);
});

test("a later live preview does not replace a committed preview awaiting apply", () => {
  const store = createCanvasRemoteShapePreviewStore();

  store.upsert(createPreview("user-a", ["shape:first"]));
  store.markCommittedShapeIds("user-a", ["shape:first"]);
  store.upsert(createPreview("user-a", ["shape:second"]));

  assert.deepEqual(
    store.getSnapshot()[0].shapes.map((shape) => shape.id),
    ["shape:second", "shape:first"],
  );

  store.acknowledgeAppliedShapeIds(["shape:first"]);
  assert.deepEqual(
    store.getSnapshot()[0].shapes.map((shape) => shape.id),
    ["shape:second"],
  );
});

test("three actors keep independent committed previews while surface apply catches up", () => {
  const store = createCanvasRemoteShapePreviewStore();

  ["user-a", "user-b", "user-c"].forEach((actorUserId) => {
    store.upsert(createPreview(actorUserId, [`shape:${actorUserId}`]));
    store.markCommittedShapeIds(actorUserId, [`shape:${actorUserId}`]);
  });

  store.acknowledgeAppliedShapeIds(["shape:user-a"]);

  assert.deepEqual(
    store.getSnapshot().map((preview) => [
      preview.actorUserId,
      preview.shapes.map((shape) => shape.id),
    ]),
    [
      ["user-b", ["shape:user-b"]],
      ["user-c", ["shape:user-c"]],
    ],
  );
});

test("line preview points are rendered in tldraw index order", () => {
  const shape = readRemoteConnectionPreviewShape({
    id: "shape:line",
    parentId: "page:page",
    props: {
      points: {
        end: { index: "a3", x: 120, y: 40 },
        start: { index: "a1", x: 0, y: 0 },
        middle: { index: "a2", x: 60, y: 20 },
      },
    },
    type: "line",
  });

  assert.ok(shape);
  assert.deepEqual(getRemoteConnectionPreviewPath(shape), {
    kind: "polyline",
    points: [
      { x: 0, y: 0 },
      { x: 60, y: 20 },
      { x: 120, y: 40 },
    ],
  });
});

test("elbow arrow preview keeps start, route, and end points", () => {
  const shape = readRemoteConnectionPreviewShape({
    id: "shape:arrow",
    parentId: "page:page",
    props: {
      elbowMidPoint: 0.25,
      end: { x: 200, y: 100 },
      kind: "elbow",
      start: { x: 0, y: 0 },
    },
    type: "arrow",
  });

  assert.ok(shape);
  assert.deepEqual(getRemoteConnectionPreviewPath(shape), {
    kind: "polyline",
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 100 },
      { x: 200, y: 100 },
    ],
  });
});
