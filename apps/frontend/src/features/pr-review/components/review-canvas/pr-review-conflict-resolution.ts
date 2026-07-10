import type {
  PrReviewConflictHunk,
  PrReviewConflictResolvedHunk
} from "@/features/pr-review/types";

export type PrReviewConflictResolutionChoice =
  | "ai"
  | "pr"
  | "target"
  | "both";

export function buildConflictResolutionDraft(input: {
  headContent: string;
  hunks: PrReviewConflictHunk[];
  choices: Record<string, PrReviewConflictResolutionChoice>;
  aiResolvedHunks: PrReviewConflictResolvedHunk[];
}): string {
  const lines = splitContentLines(input.headContent);
  const aiTextByHunkId = new Map(
    input.aiResolvedHunks.map((hunk) => [hunk.hunkId, hunk.resolvedText])
  );
  const replacements = input.hunks
    .flatMap((hunk) => {
      const choice = input.choices[hunk.id];
      const resolvedText = choice
        ? getResolutionText(hunk, choice, aiTextByHunkId)
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
  aiResolvedHunks: PrReviewConflictResolvedHunk[];
}): boolean {
  const aiHunkIds = new Set(input.aiResolvedHunks.map((hunk) => hunk.hunkId));

  return input.hunks.every((hunk) => {
    const choice = input.choices[hunk.id];
    return Boolean(choice && (choice !== "ai" || aiHunkIds.has(hunk.id)));
  });
}

function getResolutionText(
  hunk: PrReviewConflictHunk,
  choice: PrReviewConflictResolutionChoice,
  aiTextByHunkId: Map<string, string>
): string | null {
  switch (choice) {
    case "ai":
      return aiTextByHunkId.get(hunk.id) ?? null;
    case "pr":
      return hunk.incomingText;
    case "target":
      return hunk.currentText;
    case "both":
      return [hunk.incomingText, hunk.currentText]
        .filter((text) => text.length > 0)
        .join("\n");
  }
}

function splitContentLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.length === 0 ? [] : normalized.split("\n");
}
