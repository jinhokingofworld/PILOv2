"use client";

import type {
  BoardInvalidatedEvent,
  BoardRealtimeRoom,
} from "./board-realtime-types";

export type BoardRealtimeLifecycleSocket = {
  connected: boolean;
  connect: () => unknown;
  disconnect: () => unknown;
  emit: {
    (event: "board:join", payload: BoardRealtimeRoom): unknown;
    (event: "board:leave", payload: BoardRealtimeRoom): unknown;
  };
  on: {
    (event: "connect", listener: () => void): unknown;
    (
      event: "board:invalidated",
      listener: (event: BoardInvalidatedEvent) => void,
    ): unknown;
  };
  removeAllListeners: () => unknown;
};

export type BoardRealtimeLifecycle = {
  cleanup: () => void;
  connect: () => void;
};

export function createBoardRealtimeLifecycle({
  reloadBoard,
  room,
  socket,
}: {
  reloadBoard: () => void | Promise<unknown>;
  room: BoardRealtimeRoom;
  socket: BoardRealtimeLifecycleSocket;
}): BoardRealtimeLifecycle {
  function handleConnect() {
    socket.emit("board:join", room);
    void reloadBoard();
  }

  function handleInvalidation(event: BoardInvalidatedEvent) {
    if (
      event.workspaceId === room.workspaceId &&
      event.boardId === room.boardId
    ) {
      void reloadBoard();
    }
  }

  return {
    connect() {
      socket.on("connect", handleConnect);
      socket.on("board:invalidated", handleInvalidation);
      socket.connect();
    },
    cleanup() {
      if (socket.connected) {
        socket.emit("board:leave", room);
      }

      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}
