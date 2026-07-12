export type BoardRoomNameInput = {
  boardId: string;
  workspaceId: string;
};

export function createBoardRoomName({
  boardId,
  workspaceId,
}: BoardRoomNameInput) {
  return `workspace:${workspaceId}:board:${boardId}`;
}
