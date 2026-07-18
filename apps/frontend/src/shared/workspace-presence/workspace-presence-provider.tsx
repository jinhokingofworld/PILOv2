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
  createWorkspaceFollowController,
  createWorkspaceFollowSession,
  isWorkspaceFollowManualKey,
  isWorkspaceFollowManualPointer,
  type WorkspaceFollowStopReason,
} from "./workspace-follow-controller";
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
  followingUserId: string | null;
  jumpError: string | null;
  jumpToUser: (userId: string) => Promise<boolean>;
  onlineUsers: WorkspacePresenceState[];
  registerAdapter: (adapter: WorkspaceLocationAdapter) => () => void;
  reportLocationChange: () => void;
  reportManualInteraction: () => void;
  reportInteraction: () => void;
  stopFollowing: (reason: WorkspaceFollowStopReason) => void;
  toggleFollow: (userId: string) => Promise<boolean>;
};

const WorkspacePresenceContext = createContext<WorkspacePresenceContextValue | null>(
  null,
);

const FOLLOW_RESTORE_ERROR_MESSAGE =
  "팀원의 최신 위치를 불러오지 못해 따라가기를 종료했어요.";
const FOLLOW_TARGET_LEFT_MESSAGE =
  "팀원이 워크스페이스를 떠나 따라가기를 종료했어요.";

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
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
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
  const followControllerRef = useRef<ReturnType<
    typeof createWorkspaceFollowController
  > | null>(null);
  if (!followControllerRef.current) {
    followControllerRef.current = createWorkspaceFollowController();
  }
  const controller = followControllerRef.current;
  const stopFollowingRef = useRef<
    (reason: WorkspaceFollowStopReason) => void
  >(() => {});
  const followScopeRef = useRef({ currentUserId, workspaceId });

  const coordinator = useMemo<WorkspaceJumpCoordinator>(
    () =>
      createWorkspaceJumpCoordinator({
        getCurrentHref: () => currentHrefRef.current,
        navigate: (href) => {
          router.push(href);
        },
        onError: setJumpError,
        onFollowError: () => {
          setJumpError(FOLLOW_RESTORE_ERROR_MESSAGE);
          stopFollowingRef.current("restore-failed");
        },
        registry,
        rollback: (href) => {
          router.replace(href);
        },
      }),
    [registry, router],
  );
  const followSession = useMemo(
    () =>
      createWorkspaceFollowSession({
        cancelFollow: coordinator.cancelFollow,
        controller,
        jump: coordinator.jump,
        onFollowingUserIdChange: setFollowingUserId,
      }),
    [controller, coordinator],
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

  const reportLocationChange = useCallback(() => {
    if (interactionTimerRef.current !== null) return;
    interactionTimerRef.current = setTimeout(() => {
      interactionTimerRef.current = null;
      sendPresenceRef.current();
    }, 100);
  }, []);

  const stopFollowing = useCallback(
    (reason: WorkspaceFollowStopReason) => {
      followSession.stop(reason);
    },
    [followSession],
  );
  stopFollowingRef.current = stopFollowing;

  const reportManualInteraction = useCallback(() => {
    stopFollowing("manual-interaction");
    reportLocationChange();
  }, [reportLocationChange, stopFollowing]);

  const reportInteraction = reportLocationChange;

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
    reportLocationChange();
    void coordinator.destinationReady();
  }, [coordinator, pathname, reportLocationChange, searchParams]);

  useEffect(() => {
    const sendImmediately = () => sendPresenceRef.current();
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const isFollowTrigger = Boolean(
        target?.closest("[data-workspace-follow-trigger]"),
      );
      if (
        event.key === "Escape" &&
        controller.getState().status !== "idle"
      ) {
        stopFollowing("escape");
        return;
      }
      const isNavigationKey = isWorkspaceFollowManualKey(event.key, {
        isFollowTrigger,
        isNavigationTarget: Boolean(target?.closest("a[href]")),
      });
      if (isNavigationKey) {
        reportManualInteraction();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        isWorkspaceFollowManualPointer("down", {
          buttons: event.buttons,
          isFollowTrigger: Boolean(
            target?.closest("[data-workspace-follow-trigger]"),
          ),
          isNavigationTarget: Boolean(target?.closest("a[href]")),
        })
      ) {
        reportManualInteraction();
      }
    };
    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        isWorkspaceFollowManualPointer("move", {
          buttons: event.buttons,
          isFollowTrigger: Boolean(
            target?.closest("[data-workspace-follow-trigger]"),
          ),
          isNavigationTarget: false,
        })
      ) {
        reportManualInteraction();
      }
    };

    window.addEventListener("focus", sendImmediately);
    window.addEventListener("blur", sendImmediately);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("scroll", reportLocationChange, true);
    window.addEventListener("touchmove", reportManualInteraction, {
      capture: true,
      passive: true,
    });
    window.addEventListener("wheel", reportManualInteraction, {
      capture: true,
      passive: true,
    });
    document.addEventListener("visibilitychange", sendImmediately);

    return () => {
      window.removeEventListener("focus", sendImmediately);
      window.removeEventListener("blur", sendImmediately);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("scroll", reportLocationChange, true);
      window.removeEventListener("touchmove", reportManualInteraction, true);
      window.removeEventListener("wheel", reportManualInteraction, true);
      document.removeEventListener("visibilitychange", sendImmediately);
    };
  }, [controller, reportLocationChange, reportManualInteraction, stopFollowing]);

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
      const followState = controller.getState();
      if (
        followState.status === "following" &&
        followState.userId === presence.userId &&
        presence.location
      ) {
        void coordinator.follow(presence.location);
      }
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
      const followState = controller.getState();
      if (
        followState.status !== "idle" &&
        followState.userId === payload.userId
      ) {
        stopFollowing("target-left");
        setJumpError(FOLLOW_TARGET_LEFT_MESSAGE);
      }
    };
    const handleDisconnect = () => {
      stopFollowing("target-left");
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
  }, [controller, coordinator, currentUserId, socket, stopFollowing, workspaceId]);

  useEffect(() => {
    const previousScope = followScopeRef.current;
    followScopeRef.current = { currentUserId, workspaceId };
    if (
      previousScope.currentUserId !== currentUserId ||
      previousScope.workspaceId !== workspaceId
    ) {
      stopFollowing("workspace-changed");
    }
  }, [currentUserId, stopFollowing, workspaceId]);

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

  const toggleFollow = useCallback(
    async (userId: string) => {
      const target = presenceState.onlineUsers.find(
        (presence) => presence.userId === userId,
      );
      return followSession.toggle(userId, target?.location ?? null);
    },
    [followSession, presenceState.onlineUsers],
  );

  const value = useMemo<WorkspacePresenceContextValue>(
    () => ({
      clearJumpError: () => setJumpError(null),
      followingUserId,
      jumpError,
      jumpToUser,
      onlineUsers: presenceState.onlineUsers,
      registerAdapter,
      reportLocationChange,
      reportManualInteraction,
      reportInteraction,
      stopFollowing,
      toggleFollow,
    }),
    [
      followingUserId,
      jumpError,
      jumpToUser,
      presenceState.onlineUsers,
      registerAdapter,
      reportLocationChange,
      reportManualInteraction,
      reportInteraction,
      stopFollowing,
      toggleFollow,
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
