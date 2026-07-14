import assert from "node:assert/strict";

const { shouldRemoveCreatedPrReviewSystemShape } = await import(
  "../../src/features/pr-review/components/review-canvas/pr-review-system-shape-policy.ts"
);

assert.equal(
  shouldRemoveCreatedPrReviewSystemShape({
    hydrating: false,
    internalShapeUpdate: false,
    isSystemShape: true,
    source: "user"
  }),
  true
);
assert.equal(
  shouldRemoveCreatedPrReviewSystemShape({
    hydrating: true,
    internalShapeUpdate: false,
    isSystemShape: true,
    source: "user"
  }),
  false
);
assert.equal(
  shouldRemoveCreatedPrReviewSystemShape({
    hydrating: false,
    internalShapeUpdate: true,
    isSystemShape: true,
    source: "user"
  }),
  false
);
assert.equal(
  shouldRemoveCreatedPrReviewSystemShape({
    hydrating: false,
    internalShapeUpdate: false,
    isSystemShape: false,
    source: "user"
  }),
  false
);
assert.equal(
  shouldRemoveCreatedPrReviewSystemShape({
    hydrating: false,
    internalShapeUpdate: false,
    isSystemShape: true,
    source: "remote"
  }),
  false
);

console.log("PR Review system shape policy tests passed");
