import type { BoardColumnPayload } from "@/features/board/types";

function isUnmappedColumn(column: BoardColumnPayload) {
  return column.normalizedName?.trim().toLowerCase() === "unmapped";
}

export function orderBoardColumns(columns: BoardColumnPayload[]) {
  const unmappedColumns = columns.filter(isUnmappedColumn);
  const mappedColumns = columns.filter((column) => !isUnmappedColumn(column));

  return [...unmappedColumns, ...mappedColumns];
}

export function resolveMobileBoardColumnId(
  columns: BoardColumnPayload[],
  selectedColumnId: string
) {
  return columns.some(({ id }) => id === selectedColumnId)
    ? selectedColumnId
    : (columns[0]?.id ?? "");
}
