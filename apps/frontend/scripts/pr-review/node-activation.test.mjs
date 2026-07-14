import assert from "node:assert/strict";

const {
  activatePrReviewFileNode,
  registerPrReviewFileNodeActivationHandler
} = await import(
  "../../src/features/pr-review/components/review-canvas/pr-review-node-activation.ts"
);

const editor = {};
const activatedReviewFileIds = [];
const unregister = registerPrReviewFileNodeActivationHandler(
  editor,
  (reviewFileId) => activatedReviewFileIds.push(reviewFileId)
);

activatePrReviewFileNode(editor, "review-file-1");
assert.deepEqual(activatedReviewFileIds, ["review-file-1"]);

unregister();
activatePrReviewFileNode(editor, "review-file-2");
assert.deepEqual(activatedReviewFileIds, ["review-file-1"]);

const replacementEditor = {};
const replacementActivations = [];
const unregisterFirst = registerPrReviewFileNodeActivationHandler(
  replacementEditor,
  () => replacementActivations.push("first")
);
const unregisterSecond = registerPrReviewFileNodeActivationHandler(
  replacementEditor,
  () => replacementActivations.push("second")
);

unregisterFirst();
activatePrReviewFileNode(replacementEditor, "review-file-3");
assert.deepEqual(replacementActivations, ["second"]);

unregisterSecond();

console.log("PR Review file node activation tests passed");
