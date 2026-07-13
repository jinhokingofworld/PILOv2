import assert from "node:assert/strict";

const { resolvePrReviewCanvasShapeIndexes } = await import(
  "../../src/features/pr-review/components/review-canvas/pr-review-canvas-index.ts"
);

const isValidIndex = (index) => /^a[1-9]$/.test(index);
const createIndexes = (count) =>
  Array.from({ length: count }, (_, index) => `a${index + 1}`);

assert.deepEqual(
  resolvePrReviewCanvasShapeIndexes(["a1", "a2", "a3"], {
    createIndexes,
    isValidIndex
  }),
  ["a1", "a2", "a3"]
);
assert.deepEqual(
  resolvePrReviewCanvasShapeIndexes(["a1", "a10", "a3"], {
    createIndexes,
    isValidIndex
  }),
  ["a1", "a2", "a3"]
);
assert.deepEqual(
  resolvePrReviewCanvasShapeIndexes(["a1", "a1"], {
    createIndexes,
    isValidIndex
  }),
  ["a1", "a2"]
);
assert.deepEqual(
  resolvePrReviewCanvasShapeIndexes(["a1", undefined], {
    createIndexes,
    isValidIndex
  }),
  ["a1", "a2"]
);

console.log("PR Review Canvas Shape index tests passed");
