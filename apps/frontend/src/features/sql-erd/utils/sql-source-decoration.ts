import type { Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

import type { SqltoerdSourceRange } from "@/features/sql-erd/utils/sql-source-map";

export const SQLTOERD_RELATION_SOURCE_DECORATION_CLASS =
  "cm-sqltoerd-relation-source";

export function createSqlErdRelationSourceDecorations(
  ranges: SqltoerdSourceRange[],
  documentLength: number
) {
  const uniqueRanges = new Map<string, SqltoerdSourceRange>();

  for (const range of ranges) {
    if (
      !Number.isInteger(range.from) ||
      !Number.isInteger(range.to) ||
      range.from < 0 ||
      range.to <= range.from ||
      range.to > documentLength
    ) {
      continue;
    }

    uniqueRanges.set(`${range.from}:${range.to}`, range);
  }

  return Decoration.set(
    [...uniqueRanges.values()]
      .sort((left, right) => left.from - right.from || left.to - right.to)
      .map((range) =>
        Decoration.mark({
          class: SQLTOERD_RELATION_SOURCE_DECORATION_CLASS
        }).range(range.from, range.to)
      )
  );
}

export function createSqlErdRelationSourceDecorationExtension(
  ranges: SqltoerdSourceRange[],
  documentLength: number
): Extension {
  return EditorView.decorations.of(
    createSqlErdRelationSourceDecorations(ranges, documentLength)
  );
}
