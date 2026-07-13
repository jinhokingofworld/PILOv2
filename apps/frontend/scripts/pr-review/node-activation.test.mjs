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
  shapeId: "shape:file-1",
  shapePosition: { x: 300, y: 240 }
});

assert.equal(
  shouldActivatePrReviewFileNode(clickGesture, { x: 300, y: 240 }),
  true
);

const jitterGesture = updatePrReviewFileNodeActivationGesture(clickGesture, {
  x: 103,
  y: 124
});
assert.equal(
  shouldActivatePrReviewFileNode(jitterGesture, { x: 300, y: 240 }),
  true
);

const draggedGesture = updatePrReviewFileNodeActivationGesture(clickGesture, {
  x: 108,
  y: 120
});
assert.equal(
  shouldActivatePrReviewFileNode(draggedGesture, { x: 308, y: 240 }),
  false
);
assert.equal(
  shouldActivatePrReviewFileNode(clickGesture, { x: 308, y: 240 }),
  false
);

console.log("PR Review file node activation tests passed");
