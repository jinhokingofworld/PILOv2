import assert from "node:assert/strict";

import {
  buildPrReviewConflictsApplyInput,
  createPrReviewConflictDraft,
  getPrReviewConflictDraftProgress,
  applyPrReviewConflictMarkerChoice,
  buildPrReviewConflictMarkerDraft,
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

assert.match(initialDrafts.first.resolvedContent, /<<<<<<< PR branch/);
assert.match(initialDrafts.first.resolvedContent, />>>>>>> target branch/);
assert.match(initialDrafts.second.resolvedContent, /<<<<<<< PR branch/);
assert.equal(
  applyPrReviewConflictMarkerChoice({
    hunk: firstFile.hunks[0],
    choice: "both",
    value: initialDrafts.first.resolvedContent
  }),
  "const value = 2;\nconst value = 1;\n"
);

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
assert.match(refreshedDrafts.first.resolvedContent, /<<<<<<< PR branch/);
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

const multiHunkFile = {
  ...firstFile,
  reviewFileId: "multi",
  headContent: "before\nincomingOne\nbetween\nincomingTwo\nafter",
  hunks: [
    {
      ...firstFile.hunks[0],
      id: "multi-one",
      incomingStartLine: 2,
      incomingText: "incomingOne",
      currentText: "targetOne"
    },
    {
      ...firstFile.hunks[0],
      id: "multi-two",
      incomingStartLine: 4,
      incomingText: "incomingTwo",
      currentText: "targetTwo"
    }
  ]
};
const partiallyResolvedContent = buildPrReviewConflictMarkerDraft(multiHunkFile, {
  "multi-one": "resolvedOne"
});
assert.match(partiallyResolvedContent, /resolvedOne/);
assert.match(partiallyResolvedContent, /<<<<<<< PR branch/);
assert.equal(
  getPrReviewConflictDraftProgress(analysis([multiHunkFile]), {
    multi: {
      ...createPrReviewConflictDraft(multiHunkFile),
      resolvedContent: partiallyResolvedContent
    }
  }).allReady,
  false
);
assert.equal(
  buildPrReviewConflictsApplyInput(analysis([multiHunkFile]), {
    multi: {
      ...createPrReviewConflictDraft(multiHunkFile),
      resolvedContent: partiallyResolvedContent
    }
  }),
  null
);
assert.doesNotMatch(
  buildPrReviewConflictMarkerDraft(multiHunkFile, {
    "multi-one": "resolvedOne",
    "multi-two": "resolvedTwo"
  }),
  /<<<<<<< PR branch/
);
assert.equal(
  buildPrReviewConflictMarkerDraft(multiHunkFile, {
    "multi-one": "",
    "multi-two": "resolvedTwo"
  }),
  "before\nbetween\nresolvedTwo\nafter"
);

console.log("PR Review multi-file conflict draft tests passed");
