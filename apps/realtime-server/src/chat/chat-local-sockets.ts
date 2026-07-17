import type { ChatMembershipSocket } from "./chat-membership-eviction";

export type ChatLocalSocketRegistry = {
  rooms: ReadonlyMap<string, ReadonlySet<string>>;
  sockets: ReadonlyMap<string, ChatMembershipSocket>;
};

type ChatLocalIo = {
  sockets: {
    adapter: {
      rooms: ReadonlyMap<string, ReadonlySet<string>>;
    };
    sockets: ReadonlyMap<string, ChatMembershipSocket>;
  };
};

export function readChatLocalSocketRegistry(
  io: ChatLocalIo,
): ChatLocalSocketRegistry | null {
  try {
    return {
      rooms: io.sockets.adapter.rooms,
      sockets: io.sockets.sockets,
    };
  } catch {
    return null;
  }
}

export function readLocalChatRoomSockets(
  registry: ChatLocalSocketRegistry,
  roomName: string,
): ChatMembershipSocket[] | null {
  const socketIds = registry.rooms.get(roomName);
  if (!socketIds) return [];

  const sockets: ChatMembershipSocket[] = [];
  for (const socketId of socketIds) {
    const socket = registry.sockets.get(socketId);
    if (!socket) return null;
    sockets.push(socket);
  }
  return sockets;
}

export function isLocalChatSocketInRoom(
  registry: ChatLocalSocketRegistry,
  roomName: string,
  socketId: string,
): boolean {
  return registry.rooms.get(roomName)?.has(socketId) ?? false;
}
