import assert from "node:assert/strict";
import test from "node:test";

import {
  getCanvasActiveMutationShapeIds,
  getCanvasInteractionToolPath,
  isCanvasFreehandInteractionActive,
  isCanvasFreehandToolId,
  isCanvasShapeMutationInteractionActive,
} from "./canvas-local-interaction-policy.ts";
import { findPiloCanvasEmptyPlacement } from "./pilo-canvas-empty-placement.ts";

test("tldraw root tool ID 대신 현재 interaction path를 읽는다", () => {
  const source = {
    getCurrentTool: () => ({
      getPath: () => "select.translating",
    }),
  };

  assert.equal(getCanvasInteractionToolPath(source), "select.translating");
});

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

test("화면 중앙이 비어 있으면 중앙에 shape를 배치한다", () => {
  assert.deepEqual(
    findPiloCanvasEmptyPlacement({
      gap: 20,
      occupiedBounds: [],
      size: { height: 100, width: 120 },
      viewport: { height: 600, width: 800, x: 0, y: 0 },
    }),
    { x: 400, y: 300 },
  );
});

test("화면 중앙이 차 있으면 가까운 빈 위치를 선택한다", () => {
  const point = findPiloCanvasEmptyPlacement({
    gap: 20,
    occupiedBounds: [{ height: 120, width: 140, x: 330, y: 240 }],
    size: { height: 100, width: 120 },
    viewport: { height: 600, width: 800, x: 0, y: 0 },
  });

  assert.notDeepEqual(point, { x: 400, y: 300 });
  assert.equal(point.x >= 60 && point.x <= 740, true);
  assert.equal(point.y >= 50 && point.y <= 550, true);
});

test("화면이 가득 차면 겹침이 가장 적은 후보를 반환한다", () => {
  const point = findPiloCanvasEmptyPlacement({
    gap: 20,
    occupiedBounds: [{ height: 600, width: 400, x: 0, y: 0 }],
    size: { height: 100, width: 120 },
    viewport: { height: 600, width: 800, x: 0, y: 0 },
  });

  assert.equal(point.x > 400, true);
});
