import { diffLines } from "diff";

export type PrReviewResolvedDiffLine = {
  oldLineNumber: number | null;
  newLineNumber: number | null;
  text: string;
  type: "added" | "deleted" | "unchanged";
};

export type PrReviewResolvedDiffSeparator = {
  type: "separator";
};

export type PrReviewResolvedChangeBlock = {
  endLine: number;
  startLine: number;
};

export type PrReviewResolvedCodeDiff = {
  changeBlocks: PrReviewResolvedChangeBlock[];
  changedLineNumbers: number[];
  rows: PrReviewResolvedDiffLine[];
};

function normalizeNewlines(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function splitChangeLines(value: string) {
  if (!value) {
    return [];
  }

  const lines = normalizeNewlines(value).split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

function buildChangeBlocks(lineNumbers: number[]) {
  const blocks: PrReviewResolvedChangeBlock[] = [];

  for (const lineNumber of lineNumbers) {
    const previous = blocks.at(-1);
    if (previous && lineNumber <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, lineNumber);
      continue;
    }

    blocks.push({
      endLine: lineNumber,
      startLine: lineNumber
    });
  }

  return blocks;
}

export function buildPrReviewResolvedCodeDiff(
  originalValue: string,
  resolvedValue: string
): PrReviewResolvedCodeDiff {
  const rows: PrReviewResolvedDiffLine[] = [];
  const deletionAnchorLineNumbers: number[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;

  for (const change of diffLines(originalValue, resolvedValue)) {
    const type = change.added
      ? "added"
      : change.removed
        ? "deleted"
        : "unchanged";

    for (const text of splitChangeLines(change.value)) {
      if (type === "deleted") {
        deletionAnchorLineNumbers.push(newLineNumber);
      }

      rows.push({
        oldLineNumber: type === "added" ? null : oldLineNumber,
        newLineNumber: type === "deleted" ? null : newLineNumber,
        text,
        type
      });

      if (type !== "added") {
        oldLineNumber += 1;
      }

      if (type !== "deleted") {
        newLineNumber += 1;
      }
    }
  }

  const finalLineCount = Math.max(1, newLineNumber - 1);
  const changedLineNumbers = new Set<number>();

  rows.forEach((row) => {
    if (row.type === "added" && row.newLineNumber !== null) {
      changedLineNumbers.add(row.newLineNumber);
    }
  });

  for (const deletionAnchorLineNumber of deletionAnchorLineNumbers) {
    changedLineNumbers.add(
      Math.min(
        finalLineCount,
        Math.max(1, deletionAnchorLineNumber)
      )
    );
  }

  const sortedChangedLineNumbers = [...changedLineNumbers].sort(
    (left, right) => left - right
  );

  return {
    changeBlocks: buildChangeBlocks(sortedChangedLineNumbers),
    changedLineNumbers: sortedChangedLineNumbers,
    rows
  };
}

export function buildPrReviewContextualDiffRows(
  rows: PrReviewResolvedDiffLine[],
  contextLineCount = 3
): Array<PrReviewResolvedDiffLine | PrReviewResolvedDiffSeparator> {
  const changedIndexes = rows.flatMap((row, index) =>
    row.type === "unchanged" ? [] : [index]
  );

  if (changedIndexes.length === 0) {
    return [];
  }

  const visibleIndexes = new Set<number>();
  for (const changedIndex of changedIndexes) {
    const startIndex = Math.max(0, changedIndex - contextLineCount);
    const endIndex = Math.min(rows.length - 1, changedIndex + contextLineCount);

    for (let index = startIndex; index <= endIndex; index += 1) {
      visibleIndexes.add(index);
    }
  }

  const result: Array<PrReviewResolvedDiffLine | PrReviewResolvedDiffSeparator> = [];
  let previousIndex: number | null = null;

  for (const index of [...visibleIndexes].sort((left, right) => left - right)) {
    if (previousIndex !== null && index > previousIndex + 1) {
      result.push({ type: "separator" });
    }

    result.push(rows[index]);
    previousIndex = index;
  }

  return result;
}
