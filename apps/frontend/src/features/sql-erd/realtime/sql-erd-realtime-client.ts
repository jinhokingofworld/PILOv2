"use client";

import { io, type Socket } from "socket.io-client";

import type {
  SqlErdClientToServerEvents,
  SqlErdRealtimeUser,
  SqlErdServerToClientEvents,
} from "./sql-erd-realtime-types";

export type SqlErdRealtimeSocket = Socket<
  SqlErdServerToClientEvents,
  SqlErdClientToServerEvents
>;

const LOCAL_REALTIME_SERVER_URL = "http://localhost:3001";

export function getSqlErdRealtimeServerUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_PILO_REALTIME_SERVER_URL?.trim();

  if (configuredUrl) return configuredUrl;
  if (process.env.NODE_ENV === "production") return null;

  return LOCAL_REALTIME_SERVER_URL;
}

export function createSqlErdRealtimeSocket({
  authToken,
  currentUser,
}: {
  authToken: string;
  currentUser: SqlErdRealtimeUser;
}) {
  const realtimeServerUrl = getSqlErdRealtimeServerUrl();

  if (!realtimeServerUrl) return null;

  return io(realtimeServerUrl, {
    auth: {
      displayName: currentUser.displayName,
      token: authToken,
      userId: currentUser.userId,
    },
    autoConnect: false,
    transports: ["websocket"],
  }) as SqlErdRealtimeSocket;
}
