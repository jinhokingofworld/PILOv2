"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { Socket } from "socket.io-client";

import { useAuthSession } from "@/features/auth";
import { createRealtimeSocket } from "./realtime-client";

type RealtimeContextValue = {
  socket: Socket | null;
};

const RealtimeContext = createContext<RealtimeContextValue>({ socket: null });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const authSession = useAuthSession();
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const accessToken = authSession?.accessToken.trim() ?? "";
    const userId = authSession?.user.id.trim() ?? "";
    const displayName =
      authSession?.user.displayName?.trim() ||
      authSession?.user.name?.trim() ||
      "PILO";

    if (!accessToken || !userId) {
      setSocket(null);
      return;
    }

    const realtimeSocket = createRealtimeSocket({
      accessToken,
      displayName,
      userId
    });

    if (!realtimeSocket) {
      setSocket(null);
      return;
    }

    realtimeSocket.connect();
    setSocket(realtimeSocket);

    return () => {
      realtimeSocket.removeAllListeners();
      realtimeSocket.disconnect();
      setSocket((currentSocket) =>
        currentSocket === realtimeSocket ? null : currentSocket
      );
    };
  }, [
    authSession?.accessToken,
    authSession?.user.displayName,
    authSession?.user.id,
    authSession?.user.name
  ]);

  const value = useMemo<RealtimeContextValue>(() => ({ socket }), [socket]);

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtimeSocket() {
  return useContext(RealtimeContext).socket;
}
