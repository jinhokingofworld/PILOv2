"use client";

import { io, type Socket } from "socket.io-client";

const LOCAL_REALTIME_SERVER_URL = "http://localhost:3001";

export function getRealtimeServerUrl() {
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

export function createRealtimeSocket({
  accessToken,
  displayName,
  userId
}: {
  accessToken: string;
  displayName: string;
  userId: string;
}) {
  const realtimeServerUrl = getRealtimeServerUrl();

  if (!realtimeServerUrl) {
    return null;
  }

  return io(realtimeServerUrl, {
    auth: {
      displayName,
      token: accessToken,
      userId
    },
    autoConnect: false,
    transports: ["websocket"]
  }) as Socket;
}
