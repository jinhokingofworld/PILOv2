export const createChatRoomName = (workspaceId: string) =>
  `workspace:${workspaceId}:chat`;

export const createChatUserRoomName = (workspaceId: string, userId: string) =>
  `workspace:${workspaceId}:chat:user:${userId}`;
