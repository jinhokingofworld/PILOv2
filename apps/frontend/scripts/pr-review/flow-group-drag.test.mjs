import assert from "node:assert/strict";

const { getPrReviewFlowDragShapeIds } = await import(
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

console.log("PR Review Flow group drag tests passed");
