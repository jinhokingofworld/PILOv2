import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrReviewAnalysisService } = require(
  "../../dist/modules/pr-review/pr-review-analysis.service.js"
);
const { PrReviewService } = require(
  "../../dist/modules/pr-review/pr-review.service.js"
);

const hunks = [
  {
    id: "hunk-1",
    header: "@@ -2 +2 @@",
    baseStartLine: 2,
    baseLineCount: 1,
    currentStartLine: 2,
    currentLineCount: 1,
    incomingStartLine: 2,
    incomingLineCount: 1,
    baseText: "original",
    currentText: "target",
    incomingText: "pr"
  }
];
const currentDraft = {
  resolvedContent: "before\nmanual resolution\nafter",
  hunks: [
    {
      hunkId: "hunk-1",
      source: "manual",
      resolvedText: "manual resolution"
    }
  ]
};

const previousApiKey = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;
try {
  const result = await new PrReviewAnalysisService().suggestConflictResolution({
    filePath: "src/review.ts",
    previousFilePath: null,
    headContent: "before\npr\nafter",
    hunks,
    currentDraft
  });

  assert.deepEqual(result.resolvedHunks, [
    { hunkId: "hunk-1", resolvedText: "manual resolution" }
  ]);
  assert.equal(result.resolvedContent, currentDraft.resolvedContent);
} finally {
  if (previousApiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = previousApiKey;
  }
}

const service = new PrReviewService(null, null, null, null);
const normalized = service.normalizeConflictSuggestionCurrentDraft(
  { currentDraft },
  hunks
);
assert.deepEqual(normalized, currentDraft);

assert.throws(
  () =>
    service.normalizeConflictSuggestionCurrentDraft(
      {
        currentDraft: {
          ...currentDraft,
          hunks: [
            {
              hunkId: "unknown-hunk",
              source: "manual",
              resolvedText: "manual resolution"
            }
          ]
        }
      },
      hunks
    ),
  (error) =>
    error.response?.error?.message ===
    "currentDraft.hunks[0].hunkId is not a current conflict hunk"
);
assert.throws(
  () =>
    service.normalizeConflictSuggestionCurrentDraft(
      {
        currentDraft: {
          ...currentDraft,
          resolvedContent: "<<<<<<< head\ncode\n=======\ncode\n>>>>>>> base"
        }
      },
      hunks
    ),
  (error) =>
    error.response?.error?.message ===
    "currentDraft.resolvedContent must not contain conflict markers"
);

console.log("PR Review conflict suggestion context tests passed");
