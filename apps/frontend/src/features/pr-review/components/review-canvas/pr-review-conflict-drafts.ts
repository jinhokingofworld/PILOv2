import type {
  ApplyPrReviewConflictsInput,
  PrReviewConflictAnalysis,
  PrReviewConflictDraftResolutionState,
  PrReviewConflictFile,
  PrReviewConflictSuggestion
} from "@/features/pr-review/types";
import type { PrReviewConflictResolutionChoice } from "./pr-review-conflict-resolution";

export type PrReviewConflictDraft = {
  sourceHeadBlobSha: string;
  draftVersion: number;
  updatedByUserId: string | null;
  updatedAt: string | null;
  resolutionChoices: Record<string, PrReviewConflictResolutionChoice>;
  acceptedAiResolvedTexts: Record<string, string>;
  manualResolvedTexts: Record<string, string>;
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
    draftVersion: 0,
    updatedByUserId: null,
    updatedAt: null,
    resolutionChoices: {},
    acceptedAiResolvedTexts: {},
    manualResolvedTexts: {},
    suggestion: null,
    resolvedContent: buildPrReviewConflictMarkerDraft(file),
    isCustomized: false
  };
}

export function toPrReviewConflictDraftResolutionState(
  draft: PrReviewConflictDraft
): PrReviewConflictDraftResolutionState {
  return {
    resolutionChoices: draft.resolutionChoices,
    acceptedAiResolvedTexts: draft.acceptedAiResolvedTexts,
    manualResolvedTexts: draft.manualResolvedTexts,
    isCustomized: draft.isCustomized
  };
}

export function applyPrReviewConflictDraftResolutionState(
  draft: PrReviewConflictDraft,
  resolutionState: PrReviewConflictDraftResolutionState
): PrReviewConflictDraft {
  return {
    ...draft,
    resolutionChoices: resolutionState.resolutionChoices,
    acceptedAiResolvedTexts: resolutionState.acceptedAiResolvedTexts,
    manualResolvedTexts: resolutionState.manualResolvedTexts,
    isCustomized: resolutionState.isCustomized
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

  return true;
}

export function buildPrReviewConflictMarkerDraft(
  file: PrReviewConflictFile,
  resolvedHunkTexts: Record<string, string> = {}
): string {
  const lines = file.headContent.replace(/\r\n/g, "\n").split("\n");
  const hunks = [...file.hunks].sort(
    (left, right) => right.incomingStartLine - left.incomingStartLine
  );

  for (const hunk of hunks) {
    const start = Math.max(0, hunk.incomingStartLine - 1);
    const resolvedText = resolvedHunkTexts[hunk.id] ?? "";
    const normalizedResolvedText = resolvedText
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const replacementLines = Object.hasOwn(resolvedHunkTexts, hunk.id)
      ? normalizedResolvedText.length === 0
        ? []
        : normalizedResolvedText.split("\n")
      : [
          "<<<<<<< PR branch",
          ...hunk.incomingText.split("\n"),
          "=======",
          ...hunk.currentText.split("\n"),
          ">>>>>>> target branch"
        ];

    lines.splice(
      start,
      Math.max(0, hunk.incomingLineCount),
      ...replacementLines
    );
  }

  return lines.join("\n");
}

export function applyPrReviewConflictMarkerChoice(input: {
  hunk: PrReviewConflictFile["hunks"][number];
  choice: "pr" | "target" | "both";
  value: string;
}): string | null {
  const markerBlock = [
    "<<<<<<< PR branch",
    input.hunk.incomingText,
    "=======",
    input.hunk.currentText,
    ">>>>>>> target branch"
  ].join("\n");
  const replacement =
    input.choice === "pr"
      ? input.hunk.incomingText
      : input.choice === "target"
        ? input.hunk.currentText
        : `${input.hunk.incomingText}\n${input.hunk.currentText}`;

  return input.value.includes(markerBlock)
    ? input.value.replace(markerBlock, replacement)
    : null;
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
