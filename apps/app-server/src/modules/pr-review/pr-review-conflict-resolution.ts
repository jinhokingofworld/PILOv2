import type { PrReviewConflictHunkPayload } from "./pr-review-conflict-analyzer";

export interface PrReviewResolvedHunkPayload {
  hunkId: string;
  resolvedText: string;
}

export function buildResolvedFileContent(input: {
  headContent: string;
  hunks: PrReviewConflictHunkPayload[];
  resolvedHunks: PrReviewResolvedHunkPayload[];
}): string {
  const lines = splitContentLines(input.headContent);
  const resolvedTextByHunkId = new Map(
    input.resolvedHunks.map((hunk) => [hunk.hunkId, hunk.resolvedText])
  );
  const replacements = input.hunks
    .map((hunk) => ({
      startIndex: Math.max(0, hunk.incomingStartLine - 1),
      deleteCount: Math.max(0, hunk.incomingLineCount),
      lines: splitContentLines(
        resolvedTextByHunkId.get(hunk.id) ?? hunk.incomingText
      )
    }))
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

export function normalizeConflictContent(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function splitContentLines(content: string): string[] {
  const normalized = normalizeConflictContent(content);
  return normalized.length === 0 ? [] : normalized.split("\n");
}
