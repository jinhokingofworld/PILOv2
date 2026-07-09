import { diff3Merge } from "node-diff3";

export interface PrReviewConflictHunkPayload {
  id: string;
  header: string;
  baseStartLine: number;
  baseLineCount: number;
  currentStartLine: number;
  currentLineCount: number;
  incomingStartLine: number;
  incomingLineCount: number;
  baseText: string;
  currentText: string;
  incomingText: string;
}

export interface PrReviewContentConflictInput {
  mergeBaseContent: string;
  baseContent: string;
  headContent: string;
}

export function extractContentConflictHunks(
  input: PrReviewContentConflictInput
): PrReviewConflictHunkPayload[] {
  const mergeBaseLines = splitLines(input.mergeBaseContent);
  const baseBranchLines = splitLines(input.baseContent);
  const headBranchLines = splitLines(input.headContent);
  const regions = diff3Merge<string>(
    baseBranchLines,
    mergeBaseLines,
    headBranchLines,
    { excludeFalseConflicts: true }
  );

  let conflictIndex = 0;

  return regions.flatMap((region) => {
    if (!region.conflict) {
      return [];
    }

    const conflict = region.conflict;
    conflictIndex += 1;
    const baseStartLine = conflict.oIndex + 1;
    const currentStartLine = conflict.aIndex + 1;
    const incomingStartLine = conflict.bIndex + 1;

    return [
      {
        id: `hunk_${conflictIndex}`,
        header: buildHunkHeader({
          baseStartLine,
          baseLineCount: conflict.o.length,
          incomingStartLine,
          incomingLineCount: conflict.b.length
        }),
        baseStartLine,
        baseLineCount: conflict.o.length,
        currentStartLine,
        currentLineCount: conflict.a.length,
        incomingStartLine,
        incomingLineCount: conflict.b.length,
        baseText: joinLines(conflict.o),
        currentText: joinLines(conflict.a),
        incomingText: joinLines(conflict.b)
      }
    ];
  });
}

function splitLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function joinLines(lines: string[]): string {
  return lines.join("\n");
}

function buildHunkHeader(input: {
  baseStartLine: number;
  baseLineCount: number;
  incomingStartLine: number;
  incomingLineCount: number;
}): string {
  return `@@ -${input.baseStartLine},${input.baseLineCount} +${input.incomingStartLine},${input.incomingLineCount} @@`;
}
