export type PrReviewDiffRowType = "unchanged" | "added" | "deleted";

export interface PrReviewDiffRowPayload {
  type: PrReviewDiffRowType;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  oldText: string | null;
  newText: string | null;
}

const HUNK_HEADER_PATTERN =
  /^@@ -(?<oldStart>\d+)(?:,\d+)? \+(?<newStart>\d+)(?:,\d+)? @@/;

export function parseUnifiedDiffPatch(patch: string): PrReviewDiffRowPayload[] {
  const rows: PrReviewDiffRowPayload[] = [];
  let oldLineNumber: number | null = null;
  let newLineNumber: number | null = null;

  for (const line of patch.split(/\r?\n/)) {
    const hunkMatch = HUNK_HEADER_PATTERN.exec(line);
    if (hunkMatch?.groups) {
      oldLineNumber = Number(hunkMatch.groups.oldStart);
      newLineNumber = Number(hunkMatch.groups.newStart);
      continue;
    }

    if (oldLineNumber === null || newLineNumber === null) {
      continue;
    }

    if (line.startsWith("\\ No newline at end of file")) {
      continue;
    }

    const marker = line[0];
    const text = line.slice(1);

    if (marker === " ") {
      rows.push({
        type: "unchanged",
        oldLineNumber,
        newLineNumber,
        oldText: text,
        newText: text
      });
      oldLineNumber += 1;
      newLineNumber += 1;
      continue;
    }

    if (marker === "-") {
      rows.push({
        type: "deleted",
        oldLineNumber,
        newLineNumber: null,
        oldText: text,
        newText: null
      });
      oldLineNumber += 1;
      continue;
    }

    if (marker === "+") {
      rows.push({
        type: "added",
        oldLineNumber: null,
        newLineNumber,
        oldText: null,
        newText: text
      });
      newLineNumber += 1;
    }
  }

  return rows;
}
