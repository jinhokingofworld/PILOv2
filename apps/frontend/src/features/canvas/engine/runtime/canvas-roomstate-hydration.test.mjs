import assert from "node:assert/strict";
import test from "node:test";

import { shouldAcceptPersistedCanvasShape } from "./canvas-roomstate-hydration.ts";

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
