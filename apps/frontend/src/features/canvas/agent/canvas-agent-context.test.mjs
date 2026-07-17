import assert from "node:assert/strict";
import {
  buildCanvasAgentShapeSummaries,
  MAX_CANVAS_AGENT_SHAPE_SUMMARIES,
} from "./canvas-agent-shape-context.ts";
import { focusCanvasAgentResult } from "./canvas-agent-camera.ts";

function shape(id, x, text) {
  return {
    id,
    type: "sticky-note",
    props: { richText: { content: [{ text }] } },
    x,
    y: 20,
  };
}

{
  const shapes = Array.from(
    { length: MAX_CANVAS_AGENT_SHAPE_SUMMARIES + 1 },
    (_, index) => shape(`shape:${index}`, index * 200, `메모 ${index}`),
  );
  const selectedId = shapes.at(-1).id;
  const editor = {
    getCurrentPageShapes: () => shapes,
    getSelectedShapeIds: () => [selectedId],
    getShapePageBounds: (id) => {
      const index = Number(String(id).split(":")[1]);
      return { x: index * 200, y: 20, w: 180, h: 180 };
    },
    getViewportPageBounds: () => ({ x: 0, y: 0, w: 800, h: 600 }),
  };

  const summaries = buildCanvasAgentShapeSummaries(editor);

  assert.equal(summaries.length, MAX_CANVAS_AGENT_SHAPE_SUMMARIES);
  assert.equal(summaries[0].id, selectedId);
  assert.equal(summaries[0].text, `메모 ${MAX_CANVAS_AGENT_SHAPE_SUMMARIES}`);
}

{
  const calls = [];
  const editor = {
    getShapePageBounds: (id) => id === "shape:a"
      ? { x: 100, y: 200, w: 180, h: 120 }
      : { x: 400, y: 500, w: 200, h: 160 },
    zoomToBounds: (bounds, options) => calls.push({ bounds, options }),
  };

  const usedLoadedBounds = focusCanvasAgentResult(
    editor,
    ["shape:a", "shape:b"],
    { x: 0, y: 0, width: 100, height: 100 },
  );

  assert.equal(usedLoadedBounds, true);
  assert.deepEqual(calls[0].bounds, { x: 100, y: 200, w: 500, h: 460 });
  assert.equal(calls[0].options.targetZoom, 1);
  assert.equal(calls[0].options.inset, 160);
}
