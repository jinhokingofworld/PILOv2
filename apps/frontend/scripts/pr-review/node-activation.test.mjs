import assert from "node:assert/strict";

const {
  createPrReviewFileNodeActivationGesture,
  shouldActivatePrReviewFileNode,
  updatePrReviewFileNodeActivationGesture
} = await import(
  "../../src/features/pr-review/components/review-canvas/pr-review-node-activation.ts"
);

const clickGesture = createPrReviewFileNodeActivationGesture({
  pointer: { x: 100, y: 120 },
  reviewFileId: "review-file-1",
  shapeId: "shape:file-1"
});

assert.equal(shouldActivatePrReviewFileNode(clickGesture), true);

const jitterGesture = updatePrReviewFileNodeActivationGesture(clickGesture, {
  x: 103,
  y: 124
});
assert.equal(shouldActivatePrReviewFileNode(jitterGesture), true);

const draggedGesture = updatePrReviewFileNodeActivationGesture(clickGesture, {
  x: 108,
  y: 120
});
assert.equal(shouldActivatePrReviewFileNode(draggedGesture), false);

console.log("PR Review file node activation tests passed");
