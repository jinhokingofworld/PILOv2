import assert from "node:assert/strict";

const {
  preservePrReviewFlowLabelTranslation,
  shouldRemoveCreatedPrReviewSystemShape
} = await import(
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

const previousProps = { title: "Flow 1", w: 720 };
const previous = {
  id: "shape:flow-1",
  type: "pr_review_flow_label",
  x: 40,
  y: 32,
  rotation: 0,
  props: previousProps
};
const next = {
  ...previous,
  x: 240,
  y: 180,
  rotation: 1,
  props: { title: "변조", w: 1 }
};

assert.deepEqual(
  preservePrReviewFlowLabelTranslation(previous, next),
  { ...previous, x: 240, y: 180 }
);

console.log("PR Review system shape policy tests passed");
