import type { ErdColumn, ErdTable } from "@/features/sql-erd/types";

export const SQLTOERD_TABLE_MIN_WIDTH = 260;
export const SQLTOERD_TABLE_HEADER_HEIGHT = 54;
export const SQLTOERD_TABLE_ROW_HEIGHT = 42;
export const SQLTOERD_TABLE_BORDER_WIDTH = 1;
export const SQLTOERD_BADGE_MIN_COLUMN_WIDTH = 72;
export const SQLTOERD_BADGE_WIDTH = 30;
export const SQLTOERD_BADGE_GAP = 4;
export const SQLTOERD_ROW_SIDE_PADDING = 24;
export const SQLTOERD_ROW_COLUMN_GAP = 28;
export const SQLTOERD_ROW_CONTENT_SAFETY_PADDING = 16;
export const SQLTOERD_TABLE_NAME_CHAR_WIDTH = 13;
export const SQLTOERD_COLUMN_NAME_CHAR_WIDTH = 10.5;
export const SQLTOERD_COLUMN_TYPE_CHAR_WIDTH = 9.5;

export type SqltoerdTableCardSize = {
  badgeColumnWidth: number;
  height: number;
  width: number;
};

type SqltoerdTableCardColumn = Pick<
  ErdColumn,
  "dataType" | "foreignKey" | "name" | "nullable" | "primaryKey" | "unique"
>;

export function getSqltoerdColumnBadgeCount(column: SqltoerdTableCardColumn) {
  let count = 0;

  if (column.primaryKey) {
    count += 1;
  }

  if (column.foreignKey) {
    count += 1;
  }

  if (column.unique) {
    count += 1;
  }

  if (!column.nullable && !column.primaryKey) {
    count += 1;
  }

  return count;
}

export function getSqltoerdTableBadgeColumnWidth(
  columns: SqltoerdTableCardColumn[]
) {
  const maxBadgeCount = Math.max(
    ...columns.map((column) => getSqltoerdColumnBadgeCount(column)),
    0
  );

  if (maxBadgeCount === 0) {
    return SQLTOERD_BADGE_MIN_COLUMN_WIDTH;
  }

  return Math.max(
    SQLTOERD_BADGE_MIN_COLUMN_WIDTH,
    maxBadgeCount * SQLTOERD_BADGE_WIDTH +
      Math.max(0, maxBadgeCount - 1) * SQLTOERD_BADGE_GAP
  );
}

export function getSqltoerdTableCardSize(
  table: ErdTable,
  fallbackWidth?: number
): SqltoerdTableCardSize {
  const badgeColumnWidth = getSqltoerdTableBadgeColumnWidth(table.columns);
  const displayName = table.schemaName
    ? `${table.schemaName}.${table.name}`
    : table.name;
  const titleWidth =
    displayName.length * SQLTOERD_TABLE_NAME_CHAR_WIDTH +
    SQLTOERD_ROW_SIDE_PADDING * 2;
  const rowContentWidth = Math.max(
    ...table.columns.map(
      (column) =>
        badgeColumnWidth +
        SQLTOERD_ROW_COLUMN_GAP * 2 +
        column.name.length * SQLTOERD_COLUMN_NAME_CHAR_WIDTH +
        column.dataType.length * SQLTOERD_COLUMN_TYPE_CHAR_WIDTH +
        SQLTOERD_ROW_CONTENT_SAFETY_PADDING
    ),
    0
  );

  return {
    badgeColumnWidth,
    height:
      SQLTOERD_TABLE_HEADER_HEIGHT +
      table.columns.length * SQLTOERD_TABLE_ROW_HEIGHT +
      SQLTOERD_TABLE_BORDER_WIDTH * 2,
    width: Math.ceil(
      Math.max(
        SQLTOERD_TABLE_MIN_WIDTH,
        fallbackWidth ?? 0,
        titleWidth,
        rowContentWidth + SQLTOERD_ROW_SIDE_PADDING * 2
      )
    )
  };
}
