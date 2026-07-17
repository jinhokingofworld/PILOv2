import assert from "node:assert/strict";
import test from "node:test";

import {
  isCanvasFreehandInteractionActive,
  isCanvasFreehandToolId,
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
