import assert from "node:assert/strict";

const { getPrReviewFlowDragShapeIds, getPrReviewFlowFileBounds } = await import(
  "../../src/features/pr-review/components/review-canvas/pr-review-flow-group-drag.ts"
);

assert.deepEqual(
  getPrReviewFlowDragShapeIds({
    flowId: "flow-1",
    flowLabelShapeId: "shape:flow-1",
    fileShapes: [
      { id: "shape:file-1", flowId: "flow-1", pinned: false },
      { id: "shape:file-2", flowId: "flow-1", pinned: true },
      { id: "shape:file-3", flowId: "flow-2", pinned: false }
    ]
  }),
  ["shape:flow-1", "shape:file-1", "shape:file-2"]
);

assert.deepEqual(
  getPrReviewFlowFileBounds({
    flowId: "flow-1",
    fileShapes: [
      { flowId: "flow-1", x: 120, y: 240, width: 200, height: 100 },
      { flowId: "flow-1", x: 420, y: 180, width: 240, height: 120 },
      { flowId: "flow-2", x: 20, y: 30, width: 900, height: 800 }
    ]
  }),
  { left: 120, top: 180, right: 660 }
);

console.log("PR Review Flow group drag tests passed");
