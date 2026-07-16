import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
  { onOpen: (reviewFileId) => activatedReviewFileIds.push(reviewFileId) }
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
  { onOpen: () => replacementActivations.push("first") }
);
const unregisterSecond = registerPrReviewFileNodeActivationHandler(
  replacementEditor,
  { onOpen: () => replacementActivations.push("second") }
);

unregisterFirst();
activatePrReviewFileNode(replacementEditor, "review-file-3");
assert.deepEqual(replacementActivations, ["second"]);

unregisterSecond();

const [fileNodeShapeUtil, canvasSurface] = await Promise.all([
  readFile(
    new URL(
      "../../src/features/pr-review/components/review-canvas/PrReviewFileNodeShapeUtil.tsx",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL(
      "../../src/features/pr-review/components/review-canvas/PrReviewCanvasSurface.tsx",
      import.meta.url
    ),
    "utf8"
  )
]);

assert.doesNotMatch(
  fileNodeShapeUtil,
  /override onClick\(shape: PrReviewFileNodeShape\)/
);
assert.match(
  fileNodeShapeUtil,
  /override onDoubleClick\(shape: PrReviewFileNodeShape\)/
);
assert.match(fileNodeShapeUtil, /aria-label="파일 보기"/);
assert.match(
  canvasSurface,
  /window\.addEventListener\("keydown", handleKeyDown\)/
);

console.log("PR Review file node activation tests passed");
