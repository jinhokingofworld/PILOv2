import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { classifyPrReviewConflictFile } = require(
  "../../dist/modules/pr-review/pr-review-conflict-file-classifier.js"
);

function pathInput(overrides = {}) {
  return {
    filePath: "src/example.ts",
    mergeBaseContent: "ancestor",
    baseContent: "ancestor",
    headContent: "head change",
    headBlobSha: "head-blob",
    unsupportedReason: null,
    ...overrides
  };
}

assert.deepEqual(
  classifyPrReviewConflictFile({
    fileStatus: "added",
    currentPathInput: pathInput({
      mergeBaseContent: null,
      baseContent: null,
      headContent: "new file"
    })
  }),
  { kind: "none" }
);

assert.equal(
  classifyPrReviewConflictFile({
    fileStatus: "added",
    currentPathInput: pathInput({
      mergeBaseContent: null,
      baseContent: "base addition",
      headContent: "head addition"
    })
  }).kind,
  "unsupported"
);

assert.deepEqual(
  classifyPrReviewConflictFile({
    fileStatus: "deleted",
    currentPathInput: pathInput({ headContent: null })
  }),
  { kind: "none" }
);

assert.equal(
  classifyPrReviewConflictFile({
    fileStatus: "deleted",
    currentPathInput: pathInput({
      baseContent: "base changed",
      headContent: null
    })
  }).kind,
  "unsupported"
);

assert.deepEqual(
  classifyPrReviewConflictFile({
    fileStatus: "renamed",
    currentPathInput: pathInput({
      mergeBaseContent: null,
      baseContent: null,
      headContent: "renamed content"
    }),
    previousPathInput: pathInput({ headContent: null })
  }),
  { kind: "none" }
);

assert.equal(
  classifyPrReviewConflictFile({
    fileStatus: "renamed",
    currentPathInput: pathInput({
      mergeBaseContent: null,
      baseContent: null,
      headContent: "renamed content"
    }),
    previousPathInput: pathInput({
      baseContent: "base modified old path",
      headContent: null
    })
  }).kind,
  "unsupported"
);

assert.equal(
  classifyPrReviewConflictFile({
    fileStatus: "renamed",
    currentPathInput: pathInput({
      mergeBaseContent: null,
      baseContent: null,
      headContent: "renamed content"
    })
  }).kind,
  "unsupported"
);

assert.equal(
  classifyPrReviewConflictFile({
    fileStatus: "modified",
    currentPathInput: pathInput({
      baseContent: "base change",
      headContent: "head change"
    })
  }).kind,
  "content_candidate"
);

assert.deepEqual(
  classifyPrReviewConflictFile({
    fileStatus: "modified",
    currentPathInput: pathInput({
      baseContent: "same change",
      headContent: "same change"
    })
  }),
  { kind: "none" }
);

assert.equal(
  classifyPrReviewConflictFile({
    fileStatus: "modified",
    currentPathInput: null
  }).kind,
  "unsupported"
);
