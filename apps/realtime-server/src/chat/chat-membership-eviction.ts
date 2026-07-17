import { isUuid } from "./chat-identifiers";
import {
  createChatRoomName,
  createChatUserRoomName,
} from "./chat-room.service";

export type ChatMembershipSocket = {
  data: {
    auth?: {
      userId?: unknown;
    };
  };
  disconnect: (close?: boolean) => unknown;
  emit: (event: string, payload: unknown) => unknown;
  id: string;
  leave: (roomName: string) => Promise<unknown> | unknown;
};

export function readAuthenticatedChatUserId(
  socket: ChatMembershipSocket,
): string | null {
  const userId = socket.data.auth?.userId;
  return isUuid(userId) ? userId : null;
}

export async function evictChatSocket(
  socket: ChatMembershipSocket,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const leaveRoom = async (roomName: string) => {
    await socket.leave(roomName);
  };
  const results = await Promise.allSettled([
    leaveRoom(createChatRoomName(workspaceId)),
    leaveRoom(createChatUserRoomName(workspaceId, userId)),
  ]);
  const leftBothRooms = results.every(
    (result) => result.status === "fulfilled",
  );

  if (!leftBothRooms) {
    return disconnectInvalidChatSocket(socket);
  }

  return true;
}

export function disconnectInvalidChatSocket(
  socket: ChatMembershipSocket,
): boolean {
  try {
    socket.disconnect(true);
    return true;
  } catch {
    return false;
  }
}
