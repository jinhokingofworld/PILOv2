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
  room: BoardRealtimeRoom | null;
} | null {
  const normalizedAccessToken = accessToken?.trim() ?? "";
  const normalizedBoardId = boardId.trim();
  const normalizedWorkspaceId = workspaceId.trim().toLowerCase();

  if (!normalizedAccessToken || !normalizedWorkspaceId) {
    return null;
  }

  return {
    accessToken: normalizedAccessToken,
    room: normalizedBoardId
      ? { boardId: normalizedBoardId, workspaceId: normalizedWorkspaceId }
      : null
  };
}

export function useBoardRealtime(config: BoardRealtimeConfig) {
  const reloadBoardRef = useRef(config.reloadBoard);
  const reloadActiveSourceRef = useRef(config.reloadActiveSource ?? config.reloadBoard);
  const usableRoom = readUsableRoom(config);

  function reloadBoard() {
    void reloadBoardRef.current();
  }

  function reloadActiveSource() {
    void reloadActiveSourceRef.current();
  }

  useEffect(() => {
    reloadBoardRef.current = config.reloadBoard;
  }, [config.reloadBoard]);

  useEffect(() => {
    reloadActiveSourceRef.current = config.reloadActiveSource ?? config.reloadBoard;
  }, [config.reloadActiveSource, config.reloadBoard]);

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
      reloadActiveSource,
      room,
      socket: realtimeSocket,
      workspaceId: usableRoom.room?.workspaceId ?? config.workspaceId.trim().toLowerCase()
    });

    lifecycle.connect();

    return () => {
      lifecycle.cleanup();
    };
  }, [usableRoom?.accessToken, usableRoom?.room?.boardId, usableRoom?.room?.workspaceId, config.workspaceId]);
}
