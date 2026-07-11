import type {
  ApplyPrReviewConflictsInput,
  PrReviewConflictAnalysis,
  PrReviewConflictFile,
  PrReviewConflictSuggestion
} from "@/features/pr-review/types";

type PrReviewConflictResolutionChoice = "ai" | "pr" | "target" | "both";

export type PrReviewConflictDraft = {
  sourceHeadBlobSha: string;
  resolutionChoices: Record<string, PrReviewConflictResolutionChoice>;
  suggestion: PrReviewConflictSuggestion | null;
  resolvedContent: string;
  isCustomized: boolean;
};

export type PrReviewConflictDraftMap = Record<string, PrReviewConflictDraft>;

const CONFLICT_MARKER_PATTERN = /(^|\n)(<<<<<<<|=======|>>>>>>>)(?:\s|$)/;

export function createPrReviewConflictDraft(
  file: PrReviewConflictFile
): PrReviewConflictDraft {
  return {
    sourceHeadBlobSha: file.headBlobSha,
    resolutionChoices: {},
    suggestion: null,
    resolvedContent: file.headContent,
    isCustomized: false
  };
}

export function reconcilePrReviewConflictDrafts(
  analysis: PrReviewConflictAnalysis,
  currentDrafts: PrReviewConflictDraftMap
): PrReviewConflictDraftMap {
  return Object.fromEntries(
    analysis.files.map((file) => {
      const currentDraft = currentDrafts[file.reviewFileId];
      return [
        file.reviewFileId,
        currentDraft?.sourceHeadBlobSha === file.headBlobSha
          ? currentDraft
          : createPrReviewConflictDraft(file)
      ];
    })
  );
}

export function hasPrReviewConflictMarkers(value: string): boolean {
  return CONFLICT_MARKER_PATTERN.test(
    value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  );
}

export function isPrReviewConflictDraftReady(
  file: PrReviewConflictFile,
  draft: PrReviewConflictDraft | undefined
): boolean {
  if (
    !draft ||
    draft.sourceHeadBlobSha !== file.headBlobSha ||
    !draft.resolvedContent.trim() ||
    hasPrReviewConflictMarkers(draft.resolvedContent)
  ) {
    return false;
  }

  const aiHunkIds = new Set(
    (draft.suggestion?.resolvedHunks ?? []).map((hunk) => hunk.hunkId)
  );
  return file.hunks.every((hunk) => {
    const choice = draft.resolutionChoices[hunk.id];
    return Boolean(choice && (choice !== "ai" || aiHunkIds.has(hunk.id)));
  });
}

export function getPrReviewConflictDraftProgress(
  analysis: PrReviewConflictAnalysis | null,
  drafts: PrReviewConflictDraftMap
): { ready: number; total: number; allReady: boolean } {
  if (!analysis || analysis.files.length === 0) {
    return { ready: 0, total: 0, allReady: false };
  }

  const ready = analysis.files.filter((file) =>
    isPrReviewConflictDraftReady(file, drafts[file.reviewFileId])
  ).length;

  return {
    ready,
    total: analysis.files.length,
    allReady: ready === analysis.files.length
  };
}

export function buildPrReviewConflictsApplyInput(
  analysis: PrReviewConflictAnalysis,
  drafts: PrReviewConflictDraftMap
): ApplyPrReviewConflictsInput | null {
  const progress = getPrReviewConflictDraftProgress(analysis, drafts);
  if (!progress.allReady || analysis.unsupportedFiles.length > 0) {
    return null;
  }

  return {
    expectedHeadSha: analysis.headSha,
    files: analysis.files.map((file) => {
      const draft = drafts[file.reviewFileId];
      if (!draft) {
        throw new Error("Conflict draft is missing");
      }

      return {
        reviewFileId: file.reviewFileId,
        resolvedContent: draft.resolvedContent,
        expectedHeadBlobSha: file.headBlobSha
      };
    })
  };
}
