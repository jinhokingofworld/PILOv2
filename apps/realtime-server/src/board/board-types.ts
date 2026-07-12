export type BoardRoomRef = {
  boardId: string;
  workspaceId: string;
};

export type BoardJoinPayload = BoardRoomRef;

export type BoardJoinedPayload = BoardRoomRef;

export type BoardInvalidationPayload = BoardRoomRef & {
  updatedAt: string;
};
