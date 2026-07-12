"use client";

import { useEffect, useRef } from "react";

import { createBoardRealtimeSocket } from "./board-realtime-client";
import { createBoardRealtimeLifecycle } from "./board-realtime-lifecycle";
import type {
  BoardRealtimeConfig,
  BoardRealtimeRoom
} from "./board-realtime-types";

function readUsableRoom({
  accessToken,
  boardId,
  workspaceId
}: BoardRealtimeConfig): {
  accessToken: string;
  room: BoardRealtimeRoom;
} | null {
  const normalizedAccessToken = accessToken?.trim() ?? "";
  const normalizedBoardId = boardId.trim();
  const normalizedWorkspaceId = workspaceId.trim().toLowerCase();

  if (!normalizedAccessToken || !normalizedBoardId || !normalizedWorkspaceId) {
    return null;
  }

  return {
    accessToken: normalizedAccessToken,
    room: {
      boardId: normalizedBoardId,
      workspaceId: normalizedWorkspaceId
    }
  };
}

export function useBoardRealtime(config: BoardRealtimeConfig) {
  const reloadBoardRef = useRef(config.reloadBoard);
  const usableRoom = readUsableRoom(config);

  function reloadBoard() {
    void reloadBoardRef.current();
  }

  useEffect(() => {
    reloadBoardRef.current = config.reloadBoard;
  }, [config.reloadBoard]);

  useEffect(() => {
    if (!usableRoom) {
      return;
    }

    const socket = createBoardRealtimeSocket({
      accessToken: usableRoom.accessToken
    });

    if (!socket) {
      return;
    }

    const realtimeSocket = socket;
    const room = usableRoom.room;

    const lifecycle = createBoardRealtimeLifecycle({
      reloadBoard,
      room,
      socket: realtimeSocket
    });

    lifecycle.connect();

    return () => {
      lifecycle.cleanup();
    };
  }, [usableRoom?.accessToken, usableRoom?.room.boardId, usableRoom?.room.workspaceId]);
}
