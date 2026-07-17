import assert from "node:assert/strict";
import test from "node:test";

import {
  getCanvasActiveMutationShapeIds,
  isCanvasFreehandInteractionActive,
  isCanvasFreehandToolId,
  isCanvasShapeMutationInteractionActive,
} from "./canvas-local-interaction-policy.ts";

test("draw와 highlight 도구만 freehand 도구로 분류한다", () => {
  assert.equal(isCanvasFreehandToolId("draw.drawing"), true);
  assert.equal(isCanvasFreehandToolId("highlight.drawing"), true);
  assert.equal(isCanvasFreehandToolId("select.translating"), false);
});

test("freehand 도구에서 pointer가 활성화된 동안만 원격 적용을 보호한다", () => {
  assert.equal(
    isCanvasFreehandInteractionActive({
      currentToolId: "draw.drawing",
      isDragging: false,
      isPointing: true,
    }),
    true,
  );
  assert.equal(
    isCanvasFreehandInteractionActive({
      currentToolId: "highlight.drawing",
      isDragging: true,
      isPointing: false,
    }),
    true,
  );
  assert.equal(
    isCanvasFreehandInteractionActive({
      currentToolId: "draw.idle",
      isDragging: false,
      isPointing: false,
    }),
    false,
  );
  assert.equal(
    isCanvasFreehandInteractionActive({
      currentToolId: "select.translating",
      isDragging: true,
      isPointing: true,
    }),
    false,
  );
});

test("실제 shape 변경 상태만 mutation interaction으로 분류한다", () => {
  assert.equal(
    isCanvasShapeMutationInteractionActive({
      currentToolId: "select.translating",
      isDragging: true,
      isPointing: true,
    }),
    true,
  );
  assert.equal(
    isCanvasShapeMutationInteractionActive({
      currentToolId: "select.resizing",
      isDragging: true,
      isPointing: true,
    }),
    true,
  );
  assert.equal(
    isCanvasShapeMutationInteractionActive({
      currentToolId: "select.idle",
      isDragging: false,
      isPointing: false,
    }),
    false,
  );
  assert.equal(
    isCanvasShapeMutationInteractionActive({
      currentToolId: "select.brushing",
      isDragging: true,
      isPointing: true,
    }),
    false,
  );
});

test("선택만 한 shape는 보호하지 않고 실제 조작 shape만 보호한다", () => {
  assert.deepEqual(
    getCanvasActiveMutationShapeIds({
      currentToolId: "select.idle",
      editingShapeId: null,
      isDragging: false,
      isPointing: false,
      selectedShapeIds: ["shape:selected"],
    }),
    [],
  );
  assert.deepEqual(
    getCanvasActiveMutationShapeIds({
      currentToolId: "select.translating",
      editingShapeId: null,
      isDragging: true,
      isPointing: true,
      selectedShapeIds: ["shape:moving"],
    }),
    ["shape:moving"],
  );
  assert.deepEqual(
    getCanvasActiveMutationShapeIds({
      currentToolId: "select.editing_shape",
      editingShapeId: "shape:text",
      isDragging: false,
      isPointing: false,
      selectedShapeIds: ["shape:text"],
    }),
    ["shape:text"],
  );
});
