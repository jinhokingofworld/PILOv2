"use client";

import { io, type Socket } from "socket.io-client";

import type {
  CanvasClientToServerEvents,
  CanvasRealtimeUser,
  CanvasServerToClientEvents,
} from "./canvas-realtime-types";

export type CanvasRealtimeSocket = Socket<
  CanvasServerToClientEvents,
  CanvasClientToServerEvents
>;

const LOCAL_REALTIME_SERVER_URL = "http://localhost:3001";

export function getCanvasRealtimeServerUrl() {
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

export function createCanvasRealtimeSocket({
  authToken,
  currentUser,
}: {
  authToken: string;
  currentUser: CanvasRealtimeUser;
}) {
  const realtimeServerUrl = getCanvasRealtimeServerUrl();

  if (!realtimeServerUrl) {
    return null;
  }

  return io(realtimeServerUrl, {
    auth: {
      token: authToken,
      userId: currentUser.userId,
      displayName: currentUser.displayName,
      avatarUrl: currentUser.avatarUrl ?? null,
    },
    autoConnect: false,
    transports: ["websocket"],
  }) as CanvasRealtimeSocket;
}
