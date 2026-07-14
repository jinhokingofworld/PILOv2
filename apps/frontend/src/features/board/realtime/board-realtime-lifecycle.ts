"use client";

import type {
  BoardInvalidatedEvent,
  BoardSourceRealtimeRoom,
  BoardSourceUpdatedEvent,
  BoardRealtimeRoom,
} from "./board-realtime-types";

export type BoardRealtimeLifecycleSocket = {
  connected: boolean;
  connect: () => unknown;
  disconnect: () => unknown;
  emit: {
    (event: "board:join", payload: BoardRealtimeRoom): unknown;
    (event: "board:leave", payload: BoardRealtimeRoom): unknown;
    (event: "board:source:join", payload: BoardSourceRealtimeRoom): unknown;
    (event: "board:source:leave", payload: BoardSourceRealtimeRoom): unknown;
  };
  on: {
    (event: "connect", listener: () => void): unknown;
    (
      event: "board:invalidated",
      listener: (event: BoardInvalidatedEvent) => void,
    ): unknown;
    (
      event: "board:source:updated",
      listener: (event: BoardSourceUpdatedEvent) => void,
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
  reloadActiveSource = reloadBoard,
  room,
  socket,
  workspaceId,
}: {
  reloadBoard: () => void | Promise<unknown>;
  reloadActiveSource?: () => void | Promise<unknown>;
  room: BoardRealtimeRoom | null;
  socket: BoardRealtimeLifecycleSocket;
  workspaceId: string;
}): BoardRealtimeLifecycle {
  function handleConnect() {
    if (room) {
      socket.emit("board:join", room);
      void reloadBoard();
    }
    socket.emit("board:source:join", { workspaceId });
    void reloadActiveSource();
  }

  function handleSourceUpdated(event: BoardSourceUpdatedEvent) {
    if (event.workspaceId === workspaceId) {
      void reloadActiveSource();
    }
  }

  function handleInvalidation(event: BoardInvalidatedEvent) {
    if (
      event.workspaceId === workspaceId &&
      event.boardId === room?.boardId
    ) {
      void reloadBoard();
    }
  }

  return {
    connect() {
      socket.on("connect", handleConnect);
      socket.on("board:invalidated", handleInvalidation);
      socket.on("board:source:updated", handleSourceUpdated);
      socket.connect();
    },
    cleanup() {
      if (socket.connected && room) {
        socket.emit("board:leave", room);
      }
      if (socket.connected) socket.emit("board:source:leave", { workspaceId });

      socket.removeAllListeners();
      socket.disconnect();
    },
  };
}
