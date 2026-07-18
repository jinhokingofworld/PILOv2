export type LoadedCanvasBoardIdentity = {
  boardId: string;
  client: unknown;
  workspaceId: string;
};

export function shouldReuseLoadedCanvasBoard({
  client,
  loadedBoard,
  requestedBoardId,
  workspaceId,
}: {
  client: unknown;
  loadedBoard: LoadedCanvasBoardIdentity | null;
  requestedBoardId: string | undefined;
  workspaceId: string;
}) {
  return Boolean(
    requestedBoardId &&
      loadedBoard?.boardId === requestedBoardId &&
      loadedBoard.workspaceId === workspaceId &&
      loadedBoard.client === client,
  );
}
