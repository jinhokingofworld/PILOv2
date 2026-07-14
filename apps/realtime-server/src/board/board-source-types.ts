export type BoardSourceRoomRef = {
  workspaceId: string;
};

export type BoardSourceUpdatedPayload = BoardSourceRoomRef & {
  boardId: string;
  changedAt: string;
};
