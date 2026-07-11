import type {
  CreatePrReviewConflictSuggestionInput,
  PrReviewConflictFile,
  PrReviewConflictHunk,
  PrReviewConflictSuggestion
} from "@/features/pr-review/types";
import type { PrReviewConflictDraft } from "./pr-review-conflict-drafts";

export type PrReviewConflictResolutionChoice =
  | "ai"
  | "pr"
  | "target"
  | "both"
  | "manual";

export function buildConflictResolutionDraft(input: {
  headContent: string;
  hunks: PrReviewConflictHunk[];
  choices: Record<string, PrReviewConflictResolutionChoice>;
  acceptedAiResolvedTexts: Record<string, string>;
  manualResolvedTexts: Record<string, string>;
}): string {
  const lines = splitContentLines(input.headContent);
  const replacements = input.hunks
    .flatMap((hunk) => {
      const choice = input.choices[hunk.id];
      const resolvedText = choice
        ? getConflictResolutionText({
            hunk,
            choice,
            acceptedAiResolvedTexts: input.acceptedAiResolvedTexts,
            manualResolvedTexts: input.manualResolvedTexts
          })
        : null;

      if (resolvedText === null) {
        return [];
      }

      return [
        {
          startIndex: Math.max(0, hunk.incomingStartLine - 1),
          deleteCount: Math.max(0, hunk.incomingLineCount),
          lines: splitContentLines(resolvedText)
        }
      ];
    })
    .sort((left, right) => right.startIndex - left.startIndex);

  for (const replacement of replacements) {
    if (replacement.startIndex > lines.length) {
      continue;
    }

    lines.splice(
      replacement.startIndex,
      replacement.deleteCount,
      ...replacement.lines
    );
  }

  return lines.join("\n");
}

export function isConflictResolutionComplete(input: {
  hunks: PrReviewConflictHunk[];
  choices: Record<string, PrReviewConflictResolutionChoice>;
  acceptedAiResolvedTexts: Record<string, string>;
  manualResolvedTexts: Record<string, string>;
}): boolean {
  return input.hunks.every((hunk) => {
    const choice = input.choices[hunk.id];
    if (!choice) {
      return false;
    }

    return choice === "ai"
      ? Object.hasOwn(input.acceptedAiResolvedTexts, hunk.id)
      : choice === "manual"
        ? Object.hasOwn(input.manualResolvedTexts, hunk.id)
        : true;
  });
}

export function getConflictResolutionText(input: {
  hunk: PrReviewConflictHunk;
  choice: PrReviewConflictResolutionChoice;
  acceptedAiResolvedTexts: Record<string, string>;
  manualResolvedTexts: Record<string, string>;
}): string | null {
  switch (input.choice) {
    case "ai":
      return input.acceptedAiResolvedTexts[input.hunk.id] ?? null;
    case "pr":
      return input.hunk.incomingText;
    case "target":
      return input.hunk.currentText;
    case "both":
      return [input.hunk.incomingText, input.hunk.currentText]
        .filter((text) => text.length > 0)
        .join("\n");
    case "manual":
      return Object.hasOwn(input.manualResolvedTexts, input.hunk.id)
        ? input.manualResolvedTexts[input.hunk.id]
        : null;
  }
}

export function buildPrReviewConflictSuggestionInput(
  file: PrReviewConflictFile,
  draft: PrReviewConflictDraft
): CreatePrReviewConflictSuggestionInput {
  return {
    currentDraft: {
      resolvedContent: draft.resolvedContent,
      hunks: file.hunks.flatMap((hunk) => {
        const source = draft.resolutionChoices[hunk.id];
        if (!source) {
          return [];
        }
        const resolvedText = getConflictResolutionText({
          hunk,
          choice: source,
          acceptedAiResolvedTexts: draft.acceptedAiResolvedTexts,
          manualResolvedTexts: draft.manualResolvedTexts
        });

        return resolvedText === null
          ? []
          : [{ hunkId: hunk.id, source, resolvedText }];
      })
    }
  };
}

export function updatePrReviewConflictSuggestion(
  draft: PrReviewConflictDraft,
  suggestion: PrReviewConflictSuggestion
): PrReviewConflictDraft {
  return {
    ...draft,
    suggestion
  };
}

export function applyAllPrReviewConflictSuggestion(
  file: PrReviewConflictFile,
  draft: PrReviewConflictDraft,
  suggestion: PrReviewConflictSuggestion
): PrReviewConflictDraft {
  const acceptedAiResolvedTexts = Object.fromEntries(
    suggestion.resolvedHunks.map((hunk) => [hunk.hunkId, hunk.resolvedText])
  );
  const resolutionChoices = Object.fromEntries(
    file.hunks.map((hunk) => [hunk.id, "ai"])
  ) as Record<string, PrReviewConflictResolutionChoice>;

  return {
    ...draft,
    suggestion,
    acceptedAiResolvedTexts,
    resolutionChoices,
    resolvedContent: buildConflictResolutionDraft({
      headContent: file.headContent,
      hunks: file.hunks,
      choices: resolutionChoices,
      acceptedAiResolvedTexts,
      manualResolvedTexts: draft.manualResolvedTexts
    }),
    isCustomized: false
  };
}

function splitContentLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.length === 0 ? [] : normalized.split("\n");
}
