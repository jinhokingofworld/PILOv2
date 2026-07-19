import assert from "node:assert/strict";
import test from "node:test";

import { orderCanvasShapesByParentDependency } from "./canvas-shape-dependency-order.ts";

test("부모와 자식이 역순으로 들어와도 부모부터 적용한다", () => {
  const result = orderCanvasShapesByParentDependency({
    candidateShapes: [
      { id: "shape:grandchild", parentId: "shape:child" },
      { id: "shape:child", parentId: "shape:parent" },
      { id: "shape:parent", parentId: "page:page" },
    ],
    visibleShapeIds: new Set(),
  });

  assert.deepEqual(result.orderedShapeIds, [
    "shape:parent",
    "shape:child",
    "shape:grandchild",
  ]);
  assert.deepEqual(result.unresolvedShapeIds, []);
});

test("다음 patch에서 부모가 들어오면 보류된 자식을 적용한다", () => {
  const firstPatch = orderCanvasShapesByParentDependency({
    candidateShapes: [{ id: "shape:child", parentId: "shape:parent" }],
    visibleShapeIds: new Set(),
  });
  const secondPatch = orderCanvasShapesByParentDependency({
    candidateShapes: [
      { id: "shape:child", parentId: "shape:parent" },
      { id: "shape:parent", parentId: "page:page" },
    ],
    visibleShapeIds: new Set(),
  });

  assert.deepEqual(firstPatch.unresolvedShapeIds, ["shape:child"]);
  assert.deepEqual(secondPatch.orderedShapeIds, ["shape:parent", "shape:child"]);
  assert.deepEqual(secondPatch.unresolvedShapeIds, []);
});

test("존재하지 않는 부모와 순환 관계는 보류한다", () => {
  const result = orderCanvasShapesByParentDependency({
    candidateShapes: [
      { id: "shape:missing-child", parentId: "shape:missing" },
      { id: "shape:a", parentId: "shape:b" },
      { id: "shape:b", parentId: "shape:a" },
    ],
    visibleShapeIds: new Set(),
  });

  assert.deepEqual(result.orderedShapeIds, []);
  assert.deepEqual(new Set(result.unresolvedShapeIds), new Set([
    "shape:missing-child",
    "shape:a",
    "shape:b",
  ]));
});
