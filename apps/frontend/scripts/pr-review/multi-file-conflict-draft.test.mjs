import assert from "node:assert/strict";

import {
  buildPrReviewConflictsApplyInput,
  createPrReviewConflictDraft,
  getPrReviewConflictDraftProgress,
  reconcilePrReviewConflictDrafts
} from "../../src/features/pr-review/components/review-canvas/pr-review-conflict-drafts.ts";

function conflictFile(reviewFileId, filePath, headBlobSha) {
  return {
    reviewFileId,
    filePath,
    previousFilePath: null,
    type: "content",
    isSupported: true,
    resolutionStatus: "unresolved",
    headBlobSha,
    headContent: `const ${reviewFileId} = "head";\n`,
    hunks: [
      {
        id: `${reviewFileId}-hunk`,
        header: "@@ -1 +1 @@",
        baseStartLine: 1,
        baseLineCount: 1,
        currentStartLine: 1,
        currentLineCount: 1,
        incomingStartLine: 1,
        incomingLineCount: 1,
        baseText: "const value = 0;",
        currentText: "const value = 1;",
        incomingText: "const value = 2;"
      }
    ],
    aiSummary: null,
    aiSuggestion: null,
    resolvedContent: null
  };
}

function analysis(files, unsupportedFiles = []) {
  return {
    reviewSessionId: "session-id",
    pullRequestId: "pull-request-id",
    headSha: "head-sha",
    baseSha: "base-sha",
    conflictStatus: "conflicted",
    analysisMode: "sync",
    stored: false,
    supportedTypes: ["content"],
    files,
    unsupportedFiles
  };
}

const firstFile = conflictFile("first", "src/first.ts", "first-blob");
const secondFile = conflictFile("second", "src/second.ts", "second-blob");
const initialDrafts = reconcilePrReviewConflictDrafts(
  analysis([firstFile, secondFile]),
  {}
);

assert.equal(initialDrafts.first.resolvedContent, firstFile.headContent);
assert.equal(initialDrafts.second.resolvedContent, secondFile.headContent);

const preparedDrafts = {
  ...initialDrafts,
  first: {
    ...initialDrafts.first,
    resolutionChoices: { "first-hunk": "current" },
    resolvedContent: "const first = \"resolved\";\n"
  },
  second: {
    ...initialDrafts.second,
    resolutionChoices: { "second-hunk": "incoming" },
    resolvedContent: "const second = \"resolved\";\n"
  }
};

assert.deepEqual(
  getPrReviewConflictDraftProgress(
    analysis([firstFile, secondFile]),
    preparedDrafts
  ),
  { ready: 2, total: 2, allReady: true }
);
assert.deepEqual(
  buildPrReviewConflictsApplyInput(
    analysis([firstFile, secondFile]),
    preparedDrafts
  ),
  {
    expectedHeadSha: "head-sha",
    files: [
      {
        reviewFileId: "first",
        resolvedContent: "const first = \"resolved\";\n",
        expectedHeadBlobSha: "first-blob"
      },
      {
        reviewFileId: "second",
        resolvedContent: "const second = \"resolved\";\n",
        expectedHeadBlobSha: "second-blob"
      }
    ]
  }
);

const preservedDrafts = reconcilePrReviewConflictDrafts(
  analysis([firstFile, secondFile]),
  preparedDrafts
);
assert.equal(preservedDrafts.first, preparedDrafts.first);

const changedFirstFile = conflictFile(
  "first",
  "src/first.ts",
  "first-blob-new"
);
const refreshedDrafts = reconcilePrReviewConflictDrafts(
  analysis([changedFirstFile, secondFile]),
  preparedDrafts
);
assert.notEqual(refreshedDrafts.first, preparedDrafts.first);
assert.equal(refreshedDrafts.first.resolvedContent, changedFirstFile.headContent);
assert.equal(refreshedDrafts.second, preparedDrafts.second);

const markerDrafts = {
  ...preparedDrafts,
  first: {
    ...preparedDrafts.first,
    resolvedContent: "<<<<<<< head\nconst first = 1;\n=======\nconst first = 2;\n>>>>>>> base\n"
  }
};
assert.equal(
  getPrReviewConflictDraftProgress(
    analysis([firstFile, secondFile]),
    markerDrafts
  ).allReady,
  false
);
assert.equal(
  buildPrReviewConflictsApplyInput(
    analysis([firstFile, secondFile], [
      {
        reviewFileId: "unsupported",
        filePath: "assets/image.png",
        type: "unsupported",
        reason: "binary conflict is not supported"
      }
    ]),
    preparedDrafts
  ),
  null
);

assert.deepEqual(createPrReviewConflictDraft(firstFile).resolutionChoices, {});

console.log("PR Review multi-file conflict draft tests passed");
