import type {
  SqltoerdSourceMap,
  SqltoerdSourceRange
} from "@/features/sql-erd/utils/sql-source-map";

export type SqlErdSourceNavigationTarget = "constraint" | "from" | "to";

export type SqlErdSourceNavigationRequest = {
  id: number;
  range: SqltoerdSourceRange;
};

export function resolveSqlErdSourceNavigationTarget(
  sourceMap: SqltoerdSourceMap | null,
  relationId: string,
  target: SqlErdSourceNavigationTarget
) {
  const relationRanges = sourceMap?.relationsById[relationId];

  if (!relationRanges) {
    return null;
  }

  if (target === "from") {
    return relationRanges.fromColumnRanges[0] ?? null;
  }

  if (target === "to") {
    return relationRanges.toColumnRanges[0] ?? null;
  }

  return relationRanges.constraintRange;
}

export function clampSqlErdSourceNavigationRange(
  range: SqltoerdSourceRange,
  documentLength: number
) {
  if (
    !Number.isInteger(range.from) ||
    !Number.isInteger(range.to) ||
    !Number.isInteger(documentLength) ||
    documentLength < 0 ||
    range.to <= range.from
  ) {
    return null;
  }

  const from = Math.max(0, Math.min(range.from, documentLength));
  const to = Math.max(from, Math.min(range.to, documentLength));

  return to > from ? { from, to } : null;
}
