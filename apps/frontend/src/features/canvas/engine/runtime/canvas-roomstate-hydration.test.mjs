import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeCanvasRoomStateAndPersistedShapes,
  shouldAcceptPersistedCanvasShape,
} from "./canvas-roomstate-hydration.ts";
import { resolveCanvasShapeParentId } from "../../api/canvas-shape-parent.ts";

test("DB parent metadata가 비어 있어도 raw child parent를 보존한다", () => {
  const parentId = resolveCanvasShapeParentId({
    parentShapeId: null,
    rawParentId: "shape:parent",
    shapeId: "shape:child",
  });

  assert.equal(parentId, "shape:parent");
});

test("API parent metadata는 stale raw parent보다 우선한다", () => {
  const parentId = resolveCanvasShapeParentId({
    parentShapeId: "shape:current-parent",
    rawParentId: "shape:stale-parent",
    shapeId: "shape:child",
  });

  assert.equal(parentId, "shape:current-parent");
});

test("최상위 Shape의 page parent는 정규화 결과에서 제거한다", () => {
  const parentId = resolveCanvasShapeParentId({
    parentShapeId: null,
    rawParentId: "page:page",
    shapeId: "shape:root",
  });

  assert.equal(parentId, null);
});

test("DB Shape는 roomState와 tombstone에 없는 ID만 hydrate한다", () => {
  const deletedShapeIds = new Set(["shape:deleted"]);
  const roomStateShapeIds = new Set(["shape:room-latest"]);

  assert.equal(
    shouldAcceptPersistedCanvasShape({
      deletedShapeIds,
      roomStateShapeIds,
      shapeId: "shape:db-only",
    }),
    true,
  );
  assert.equal(
    shouldAcceptPersistedCanvasShape({
      deletedShapeIds,
      roomStateShapeIds,
      shapeId: "shape:room-latest",
    }),
    false,
  );
  assert.equal(
    shouldAcceptPersistedCanvasShape({
      deletedShapeIds,
      roomStateShapeIds,
      shapeId: "shape:deleted",
    }),
    false,
  );
});

test("roomState cache가 DB의 오래된 동일 Shape보다 우선한다", () => {
  const roomShape = { id: "shape:shared", revision: 3, text: "room-latest" };
  const persistedShapes = [
    { id: "shape:shared", revision: 2, text: "db-stale" },
    { id: "shape:db-only", revision: 1, text: "db-only" },
    { id: "shape:deleted", revision: 1, text: "deleted" },
  ];

  const mergedShapes = mergeCanvasRoomStateAndPersistedShapes({
    cachedShapes: [roomShape, { id: "shape:stale-cache", revision: 1 }],
    deletedShapeIds: new Set(["shape:deleted"]),
    persistedShapes,
    roomStateShapeIds: new Set(["shape:shared"]),
  });

  assert.deepEqual(mergedShapes, [roomShape, persistedShapes[1]]);
});
