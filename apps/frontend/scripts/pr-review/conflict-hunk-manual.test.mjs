import assert from "node:assert/strict";

import {
  applyAllPrReviewConflictSuggestion,
  buildPrReviewConflictSuggestionInput,
  buildConflictResolutionDraft,
  isConflictResolutionComplete,
  updatePrReviewConflictSuggestion
} from "../../src/features/pr-review/components/review-canvas/pr-review-conflict-resolution.ts";
import {
  createPrReviewConflictDraft
} from "../../src/features/pr-review/components/review-canvas/pr-review-conflict-drafts.ts";

const file = {
  reviewFileId: "review-file",
  filePath: "src/review.ts",
  previousFilePath: null,
  type: "content",
  isSupported: true,
  resolutionStatus: "unresolved",
  headBlobSha: "head-blob",
  headContent: "before\npr-one\nmiddle\npr-two\nafter",
  hunks: [
    {
      id: "hunk-1",
      header: "@@ -2 +2 @@",
      baseStartLine: 2,
      baseLineCount: 1,
      currentStartLine: 2,
      currentLineCount: 1,
      incomingStartLine: 2,
      incomingLineCount: 1,
      baseText: "original-one",
      currentText: "target-one",
      incomingText: "pr-one"
    },
    {
      id: "hunk-2",
      header: "@@ -4 +4 @@",
      baseStartLine: 4,
      baseLineCount: 1,
      currentStartLine: 4,
      currentLineCount: 1,
      incomingStartLine: 4,
      incomingLineCount: 1,
      baseText: "original-two",
      currentText: "target-two",
      incomingText: "pr-two"
    }
  ],
  aiSummary: null,
  aiSuggestion: null,
  resolvedContent: null
};

const baseDraft = createPrReviewConflictDraft(file);
const mixedDraft = {
  ...baseDraft,
  resolutionChoices: {
    "hunk-1": "manual",
    "hunk-2": "ai"
  },
  acceptedAiResolvedTexts: { "hunk-2": "accepted-ai-two" },
  manualResolvedTexts: { "hunk-1": "manual-one" },
  resolvedContent: buildConflictResolutionDraft({
    headContent: file.headContent,
    hunks: file.hunks,
    choices: { "hunk-1": "manual", "hunk-2": "ai" },
    acceptedAiResolvedTexts: { "hunk-2": "accepted-ai-two" },
    manualResolvedTexts: { "hunk-1": "manual-one" }
  })
};

assert.equal(
  mixedDraft.resolvedContent,
  "before\nmanual-one\nmiddle\naccepted-ai-two\nafter"
);
assert.equal(
  isConflictResolutionComplete({
    hunks: file.hunks,
    choices: mixedDraft.resolutionChoices,
    acceptedAiResolvedTexts: mixedDraft.acceptedAiResolvedTexts,
    manualResolvedTexts: mixedDraft.manualResolvedTexts
  }),
  true
);
assert.deepEqual(buildPrReviewConflictSuggestionInput(file, mixedDraft), {
  currentDraft: {
    resolvedContent: mixedDraft.resolvedContent,
    hunks: [
      { hunkId: "hunk-1", source: "manual", resolvedText: "manual-one" },
      { hunkId: "hunk-2", source: "ai", resolvedText: "accepted-ai-two" }
    ]
  }
});

const suggestion = {
  reviewFileId: file.reviewFileId,
  filePath: file.filePath,
  previousFilePath: null,
  type: "content",
  status: "suggested",
  headSha: "head-sha",
  headBlobSha: file.headBlobSha,
  aiSummary: "summary",
  aiSuggestion: "suggestion",
  resolvedHunks: [
    { hunkId: "hunk-1", resolvedText: "new-ai-one" },
    { hunkId: "hunk-2", resolvedText: "new-ai-two" }
  ],
  resolvedContent: "before\nnew-ai-one\nmiddle\nnew-ai-two\nafter",
  validationMessages: [],
  stored: false
};

const suggestionOnlyDraft = updatePrReviewConflictSuggestion(
  mixedDraft,
  suggestion
);
assert.equal(suggestionOnlyDraft.resolvedContent, mixedDraft.resolvedContent);
assert.deepEqual(
  suggestionOnlyDraft.resolutionChoices,
  mixedDraft.resolutionChoices
);
assert.deepEqual(
  suggestionOnlyDraft.acceptedAiResolvedTexts,
  mixedDraft.acceptedAiResolvedTexts
);

const appliedDraft = applyAllPrReviewConflictSuggestion(
  file,
  suggestionOnlyDraft,
  suggestion
);
assert.deepEqual(appliedDraft.resolutionChoices, {
  "hunk-1": "ai",
  "hunk-2": "ai"
});
assert.deepEqual(appliedDraft.acceptedAiResolvedTexts, {
  "hunk-1": "new-ai-one",
  "hunk-2": "new-ai-two"
});
assert.equal(
  appliedDraft.resolvedContent,
  "before\nnew-ai-one\nmiddle\nnew-ai-two\nafter"
);
assert.equal(appliedDraft.manualResolvedTexts["hunk-1"], "manual-one");

console.log("PR Review hunk manual resolution tests passed");
