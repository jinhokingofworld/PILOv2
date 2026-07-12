"use client";

import { io, type Socket } from "socket.io-client";

import type {
  BoardClientToServerEvents,
  BoardRealtimeRoom,
  BoardServerToClientEvents
} from "./board-realtime-types";

export type BoardRealtimeSocket = Socket<
  BoardServerToClientEvents,
  BoardClientToServerEvents
>;

const LOCAL_REALTIME_SERVER_URL = "http://localhost:3001";

export function getBoardRealtimeServerUrl() {
  const configuredUrl =
    process.env.NEXT_PUBLIC_PILO_REALTIME_SERVER_URL?.trim();

  if (configuredUrl) {
    return configuredUrl;
  }

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return LOCAL_REALTIME_SERVER_URL;
}

export function createBoardRealtimeSocket({
  accessToken
}: {
  accessToken: string;
}) {
  const realtimeServerUrl = getBoardRealtimeServerUrl();

  if (!realtimeServerUrl) {
    return null;
  }

  return io(realtimeServerUrl, {
    auth: {
      token: accessToken
    },
    autoConnect: false,
    transports: ["websocket"]
  }) as BoardRealtimeSocket;
}

export function joinBoardRealtimeRoom(
  socket: BoardRealtimeSocket,
  room: BoardRealtimeRoom
) {
  socket.emit("board:join", room);
}

export function leaveBoardRealtimeRoom(
  socket: BoardRealtimeSocket,
  room: BoardRealtimeRoom
) {
  socket.emit("board:leave", room);
}
