export function hasPiloIssueDeliveryTarget(options: {
  boards: Array<{ columns: Array<{ id: string }> }>;
}): boolean {
  return options.boards.some((board) => board.columns.length > 0);
}

export function hasPiloIssueDeliverySelection(
  options: {
    boards: Array<{ id: string; columns: Array<{ id: string }> }>;
  },
  boardId: string,
  columnId: string
): boolean {
  const board = options.boards.find((option) => option.id === boardId);
  return board?.columns.some((column) => column.id === columnId) ?? false;
}

export function resolvePiloIssueDeliverySelection(
  options: {
    boards: Array<{ id: string; columns: Array<{ id: string }> }>;
  },
  preferredBoardId: string,
  preferredColumnId: string
): { boardId: string; columnId: string } {
  if (preferredBoardId || preferredColumnId) {
    return {
      boardId: preferredBoardId,
      columnId: preferredColumnId
    };
  }

  const board = options.boards[0];

  return {
    boardId: board?.id ?? "",
    columnId: board?.columns[0]?.id ?? ""
  };
}

export async function saveThenDeliverActionItem({
  deliver,
  needsSave,
  save
}: {
  deliver: () => Promise<void>;
  needsSave: boolean;
  save: () => Promise<boolean>;
}): Promise<boolean> {
  if (needsSave && !(await save())) {
    return false;
  }

  await deliver();
  return true;
}
