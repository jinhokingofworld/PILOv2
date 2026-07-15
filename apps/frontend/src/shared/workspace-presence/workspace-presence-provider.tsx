"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useAuthSession } from "@/features/auth";
import { useRealtimeSocket } from "@/shared/realtime/realtime-provider";
import {
  createWorkspaceJumpCoordinator,
  createWorkspaceLocationRegistry,
  type WorkspaceJumpCoordinator,
} from "./workspace-location-registry";
import {
  createWorkspacePresenceState,
  reduceWorkspacePresence,
} from "./workspace-presence-reducer";
import {
  workspacePresenceClientEvents,
  workspacePresenceServerEvents,
} from "./workspace-presence-events";
import type {
  WorkspaceLocationAdapter,
  WorkspacePresenceJoinedPayload,
  WorkspacePresenceLeavePayload,
  WorkspacePresenceState,
  WorkspacePresenceUpdatePayload,
} from "./workspace-presence-types";

type WorkspacePresenceContextValue = {
  clearJumpError: () => void;
  jumpError: string | null;
  jumpToUser: (userId: string) => Promise<boolean>;
  onlineUsers: WorkspacePresenceState[];
  registerAdapter: (adapter: WorkspaceLocationAdapter) => () => void;
  reportInteraction: () => void;
};

const WorkspacePresenceContext = createContext<WorkspacePresenceContextValue | null>(
  null,
);

export function WorkspacePresenceProvider({ children }: { children: ReactNode }) {
  const authSession = useAuthSession();
  const socket = useRealtimeSocket();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentUserId = authSession?.user.id ?? null;
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const [presenceState, setPresenceState] = useState(
    createWorkspacePresenceState,
  );
  const [jumpError, setJumpError] = useState<string | null>(null);
  const registryRef = useRef<ReturnType<
    typeof createWorkspaceLocationRegistry
  > | null>(null);
  if (!registryRef.current) {
    registryRef.current = createWorkspaceLocationRegistry();
  }
  const registry = registryRef.current;
  const currentHrefRef = useRef("/home");
  const sendPresenceRef = useRef<() => void>(() => {});
  const interactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const coordinator = useMemo<WorkspaceJumpCoordinator>(
    () =>
      createWorkspaceJumpCoordinator({
        getCurrentHref: () => currentHrefRef.current,
        navigate: (href) => {
          router.push(href);
        },
        onError: setJumpError,
        registry,
        rollback: (href) => {
          router.replace(href);
        },
      }),
    [registry, router],
  );

  const sendPresence = useCallback(() => {
    if (!socket?.connected || !workspaceId) return;
    socket.emit(workspacePresenceClientEvents.update, {
      focused: document.hasFocus(),
      location: registry.capture(),
      visible: document.visibilityState === "visible",
      workspaceId,
    } satisfies WorkspacePresenceUpdatePayload);
  }, [registry, socket, workspaceId]);
  sendPresenceRef.current = sendPresence;

  const reportInteraction = useCallback(() => {
    if (interactionTimerRef.current !== null) return;
    interactionTimerRef.current = setTimeout(() => {
      interactionTimerRef.current = null;
      sendPresenceRef.current();
    }, 100);
  }, []);

  const registerAdapter = useCallback(
    (adapter: WorkspaceLocationAdapter) => {
      const unregister = registry.register(adapter);
      sendPresenceRef.current();
      void coordinator.destinationReady();
      return unregister;
    },
    [coordinator, registry],
  );

  useEffect(() => {
    currentHrefRef.current = `${pathname}${
      searchParams.size ? `?${searchParams.toString()}` : ""
    }`;
    sendPresenceRef.current();
    void coordinator.destinationReady();
  }, [coordinator, pathname, searchParams]);

  useEffect(() => {
    const sendImmediately = () => sendPresenceRef.current();
    const reportScroll = () => reportInteraction();

    window.addEventListener("focus", sendImmediately);
    window.addEventListener("blur", sendImmediately);
    window.addEventListener("scroll", reportScroll, true);
    document.addEventListener("visibilitychange", sendImmediately);

    return () => {
      window.removeEventListener("focus", sendImmediately);
      window.removeEventListener("blur", sendImmediately);
      window.removeEventListener("scroll", reportScroll, true);
      document.removeEventListener("visibilitychange", sendImmediately);
    };
  }, [reportInteraction]);

  useEffect(
    () => () => {
      if (interactionTimerRef.current !== null) {
        clearTimeout(interactionTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setPresenceState(createWorkspacePresenceState());
    if (!socket || !workspaceId || !currentUserId) return;

    const joinWorkspace = () => {
      socket.emit(workspacePresenceClientEvents.join, { workspaceId });
    };
    const handleJoined = (payload: WorkspacePresenceJoinedPayload) => {
      if (payload.workspaceId !== workspaceId) return;
      setPresenceState((state) =>
        reduceWorkspacePresence(
          state,
          { presence: payload.presence, type: "joined" },
          currentUserId,
        ),
      );
      sendPresenceRef.current();
    };
    const handleUpdate = (presence: WorkspacePresenceState) => {
      if (presence.workspaceId !== workspaceId) return;
      setPresenceState((state) =>
        reduceWorkspacePresence(
          state,
          { presence, type: "update" },
          currentUserId,
        ),
      );
    };
    const handleLeave = (payload: WorkspacePresenceLeavePayload) => {
      if (payload.workspaceId !== workspaceId) return;
      setPresenceState((state) =>
        reduceWorkspacePresence(
          state,
          { type: "leave", userId: payload.userId },
          currentUserId,
        ),
      );
    };
    const handleDisconnect = () => {
      setPresenceState(createWorkspacePresenceState());
    };

    socket.on("connect", joinWorkspace);
    socket.on("disconnect", handleDisconnect);
    socket.on(workspacePresenceServerEvents.joined, handleJoined);
    socket.on(workspacePresenceServerEvents.update, handleUpdate);
    socket.on(workspacePresenceServerEvents.leave, handleLeave);
    if (socket.connected) joinWorkspace();

    return () => {
      if (socket.connected) {
        socket.emit(workspacePresenceClientEvents.leave, { workspaceId });
      }
      socket.off("connect", joinWorkspace);
      socket.off("disconnect", handleDisconnect);
      socket.off(workspacePresenceServerEvents.joined, handleJoined);
      socket.off(workspacePresenceServerEvents.update, handleUpdate);
      socket.off(workspacePresenceServerEvents.leave, handleLeave);
    };
  }, [currentUserId, socket, workspaceId]);

  const jumpToUser = useCallback(
    async (userId: string) => {
      const target = presenceState.onlineUsers.find(
        (presence) => presence.userId === userId,
      );
      if (!target?.location) return false;
      return coordinator.jump(target.location);
    },
    [coordinator, presenceState.onlineUsers],
  );

  const value = useMemo<WorkspacePresenceContextValue>(
    () => ({
      clearJumpError: () => setJumpError(null),
      jumpError,
      jumpToUser,
      onlineUsers: presenceState.onlineUsers,
      registerAdapter,
      reportInteraction,
    }),
    [
      jumpError,
      jumpToUser,
      presenceState.onlineUsers,
      registerAdapter,
      reportInteraction,
    ],
  );

  return (
    <WorkspacePresenceContext.Provider value={value}>
      {children}
    </WorkspacePresenceContext.Provider>
  );
}

export function useWorkspacePresence() {
  const context = useContext(WorkspacePresenceContext);
  if (!context) {
    throw new Error(
      "useWorkspacePresence must be used within WorkspacePresenceProvider",
    );
  }
  return context;
}
