"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  Room,
  createLocalScreenTracks,
  type RemoteTrack
} from "livekit-client";
import { toast } from "sonner";

import { useAuthSession } from "@/features/auth";
import {
  createScreenShareApiClient,
  ScreenShareApiError
} from "@/features/screen-share/api/client";
import {
  createPublisherSession,
  createViewerSession,
  type PublisherSession,
  type ViewerSession
} from "@/features/screen-share/runtime/livekit-screen-share-session";
import { ScreenShareCurrentSessionCoordinator } from "@/features/screen-share/runtime/screen-share-current-session-coordinator";
import {
  initialScreenShareState,
  reduceScreenShareState,
  type PublisherStatus,
  type ScreenShareState,
  type ViewerMode
} from "@/features/screen-share/runtime/screen-share-reducer";
import type { PublicScreenShareSession } from "@/features/screen-share/types";
import { useRealtimeSocket } from "@/shared/realtime/realtime-provider";
import { workspacePresenceServerEvents } from "@/shared/workspace-presence/workspace-presence-events";

// <screen-share-runtime-pure>
type RuntimePolicySession = {
  id: string;
  sharer: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
  };
  startedAt: string;
};

type WorkspacePresenceJoinedPayload = { workspaceId: string };

export function reconcileStartedScreenShare({
  currentUserId,
  notifiedSessionIds,
  session
}: {
  currentUserId: string | null;
  notifiedSessionIds: Set<string>;
  session: RuntimePolicySession;
}) {
  const shouldToast =
    session.sharer.userId !== currentUserId && !notifiedSessionIds.has(session.id);
  const nextNotifiedSessionIds = new Set(notifiedSessionIds);
  nextNotifiedSessionIds.add(session.id);
  return {
    activeSession: session,
    notifiedSessionIds: nextNotifiedSessionIds,
    shouldToast
  };
}

export function reconcileCurrentScreenShare({
  currentUserId,
  notifiedSessionIds,
  session
}: {
  currentUserId: string | null;
  notifiedSessionIds: Set<string>;
  session: RuntimePolicySession | null;
}) {
  if (!session) {
    return {
      activeSession: null,
      notifiedSessionIds,
      shouldToast: false
    };
  }
  return reconcileStartedScreenShare({
    currentUserId,
    notifiedSessionIds,
    session
  });
}

export function reconcileEndedScreenShare({
  activeSession,
  sessionId,
  viewerSessionId
}: {
  activeSession: RuntimePolicySession | null;
  sessionId: string;
  viewerSessionId: string | null;
}) {
  return {
    activeSession: activeSession?.id === sessionId ? null : activeSession,
    shouldDisconnectViewer: viewerSessionId === sessionId
  };
}

export function canStartViewingScreenShare({
  activeSession,
  currentUserId,
  sessionId
}: {
  activeSession: RuntimePolicySession | null;
  currentUserId: string | null;
  sessionId: string;
}) {
  return !(
    activeSession?.id === sessionId &&
    activeSession.sharer.userId === currentUserId
  );
}

export function getWorkspaceScreenShareCleanup({
  nextWorkspaceId,
  previousWorkspaceId,
  publisherSessionId,
  viewerSessionId
}: {
  nextWorkspaceId: string;
  previousWorkspaceId: string;
  publisherSessionId: string | null;
  viewerSessionId: string | null;
}) {
  const workspaceChanged = nextWorkspaceId !== previousWorkspaceId;
  return {
    stopPublisher: workspaceChanged && publisherSessionId !== null,
    stopViewer: workspaceChanged && viewerSessionId !== null
  };
}

export function isCurrentScreenShareRequest({
  attempt,
  currentAttempt,
  currentWorkspaceId,
  requestWorkspaceId
}: {
  attempt: number;
  currentAttempt: number;
  currentWorkspaceId: string;
  requestWorkspaceId: string;
}) {
  return (
    attempt === currentAttempt && requestWorkspaceId === currentWorkspaceId
  );
}
// </screen-share-runtime-pure>

type ScreenShareRuntimeContextValue = {
  activeSession: PublicScreenShareSession | null;
  currentUserId: string | null;
  publisherStatus: PublisherStatus;
  setViewerMode: (mode: ViewerMode) => void;
  startSharing: () => void;
  startViewing: (sessionId: string) => void;
  stopSharing: () => void;
  stopViewing: () => void;
  viewer: ScreenShareState["viewer"];
  viewerMediaElement: HTMLVideoElement | null;
};

const ScreenShareRuntimeContext =
  createContext<ScreenShareRuntimeContextValue | null>(null);

function isPickerCancellation(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "NotAllowedError")
  );
}

function createViewerVideoElement() {
  const element = document.createElement("video");
  element.autoplay = true;
  element.playsInline = true;
  element.className = "size-full bg-black object-contain";
  return element;
}

type ScreenShareRoom = ReturnType<
  Parameters<typeof createPublisherSession>[0]["createRoom"]
>;

function createScreenShareRoom() {
  return new Room() as unknown as ScreenShareRoom;
}

export function ScreenShareRuntimeProvider({
  children
}: {
  children: ReactNode;
}) {
  const authSession = useAuthSession();
  const socket = useRealtimeSocket();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const currentUserId = authSession?.user.id ?? null;
  const api = useMemo(
    () =>
      createScreenShareApiClient({
        accessToken: authSession?.accessToken ?? null
      }),
    [authSession?.accessToken]
  );
  const [state, dispatch] = useReducer(
    reduceScreenShareState,
    initialScreenShareState
  );
  const [activeSession, setActiveSession] =
    useState<PublicScreenShareSession | null>(null);
  const [viewerMediaElement, setViewerMediaElement] =
    useState<HTMLVideoElement | null>(null);
  const stateRef = useRef(state);
  const activeSessionRef = useRef(activeSession);
  const publisherSessionRef = useRef<PublisherSession | null>(null);
  const viewerSessionRef = useRef<ViewerSession<HTMLVideoElement> | null>(null);
  const viewerTargetSessionIdRef = useRef<string | null>(null);
  const publisherAttemptRef = useRef(0);
  const viewerAttemptRef = useRef(0);
  const requestCurrentRef = useRef<() => void>(() => undefined);
  const notifiedSessionIdsRef = useRef(new Set<string>());
  const workspaceIdRef = useRef(workspaceId);
  const previousWorkspaceIdRef = useRef(workspaceId);
  const startViewingRef = useRef<(sessionId: string) => void>(() => undefined);
  stateRef.current = state;
  activeSessionRef.current = activeSession;
  workspaceIdRef.current = workspaceId;

  const stopViewerResource = useCallback(
    async (sessionId: string, reason: "closed" | "ended") => {
      viewerAttemptRef.current += 1;
      const viewerSession = viewerSessionRef.current;
      viewerSessionRef.current = null;
      viewerTargetSessionIdRef.current = null;
      setViewerMediaElement(null);
      if (reason === "ended") {
        dispatch({ type: "viewer/ended", sessionId });
      } else {
        dispatch({ type: "viewer/closed", sessionId });
      }
      if (viewerSession?.sessionId === sessionId) {
        await viewerSession.stop();
      }
    },
    []
  );

  const beginViewing = useCallback(
    (sessionId: string) => {
      if (!workspaceId || !sessionId) return;
      const mediaElement = createViewerVideoElement();
      const attempt = ++viewerAttemptRef.current;
      const requestWorkspaceId = workspaceId;
      viewerTargetSessionIdRef.current = sessionId;
      setViewerMediaElement(mediaElement);
      dispatch({ type: "viewer/connecting", sessionId });

      void createViewerSession<HTMLVideoElement>({
        api,
        createRoom: createScreenShareRoom,
        mediaElements: {
          attach(track) {
            (track as RemoteTrack).attach(mediaElement);
            return mediaElement;
          },
          detach(track, element) {
            (track as RemoteTrack).detach(element);
          }
        },
        sessionId,
        workspaceId: requestWorkspaceId
      })
        .then(async (viewerSession) => {
          if (!isCurrentScreenShareRequest({
            attempt,
            currentAttempt: viewerAttemptRef.current,
            currentWorkspaceId: workspaceIdRef.current,
            requestWorkspaceId
          })) {
            await viewerSession.stop();
            return;
          }
          viewerSessionRef.current = viewerSession;
          dispatch({ type: "viewer/connected", sessionId });
        })
        .catch(() => {
          if (attempt !== viewerAttemptRef.current) return;
          viewerTargetSessionIdRef.current = null;
          setViewerMediaElement(null);
          dispatch({
            type: "viewer/failed",
            error: "화면 공유를 불러오지 못했어요.",
            sessionId
          });
        });
    },
    [api, workspaceId]
  );

  const startViewing = useCallback(
    (sessionId: string) => {
      if (
        !canStartViewingScreenShare({
          activeSession: activeSessionRef.current,
          currentUserId,
          sessionId
        })
      ) {
        return;
      }
      const currentSessionId = viewerTargetSessionIdRef.current;
      if (currentSessionId === sessionId) return;
      if (currentSessionId) {
        void stopViewerResource(currentSessionId, "closed").then(() => {
          beginViewing(sessionId);
        });
        return;
      }
      beginViewing(sessionId);
    },
    [beginViewing, currentUserId, stopViewerResource]
  );
  startViewingRef.current = startViewing;

  const stopViewing = useCallback(() => {
    const sessionId = viewerTargetSessionIdRef.current;
    if (sessionId) void stopViewerResource(sessionId, "closed");
  }, [stopViewerResource]);

  const stopSharing = useCallback(() => {
    const publisherSession = publisherSessionRef.current;
    if (publisherSession) {
      publisherSessionRef.current = null;
      dispatch({
        type: "publisher/stopping",
        sessionId: publisherSession.sessionId
      });
      void publisherSession.stop().finally(() => {
        dispatch({
          type: "publisher/stopped",
          sessionId: publisherSession.sessionId
        });
        setActiveSession((session) =>
          session?.id === publisherSession.sessionId ? null : session
        );
      });
      return;
    }

    const session = activeSessionRef.current;
    if (session?.sharer.userId !== currentUserId || !workspaceId) return;
    void api
      .end(workspaceId, session.id)
      .then(() => {
        setActiveSession((current) =>
          current?.id === session.id ? null : current
        );
      })
      .catch(() => {
        toast.error("화면 공유를 종료하지 못했어요.");
      });
  }, [api, currentUserId, workspaceId]);

  const startSharing = useCallback(() => {
    if (!workspaceId || stateRef.current.publisher.status !== "idle") return;
    const attempt = ++publisherAttemptRef.current;
    const requestWorkspaceId = workspaceId;
    let publisherSessionId: string | null = null;
    dispatch({ type: "publisher/selecting" });

    void createPublisherSession({
      api,
      createLocalScreenTracks,
      createRoom: createScreenShareRoom,
      onReserving: () => {
        if (
          isCurrentScreenShareRequest({
            attempt,
            currentAttempt: publisherAttemptRef.current,
            currentWorkspaceId: workspaceIdRef.current,
            requestWorkspaceId
          })
        ) {
          dispatch({ type: "publisher/reserving" });
        }
      },
      onConnecting: (sessionId) => {
        publisherSessionId = sessionId;
        if (
          isCurrentScreenShareRequest({
            attempt,
            currentAttempt: publisherAttemptRef.current,
            currentWorkspaceId: workspaceIdRef.current,
            requestWorkspaceId
          })
        ) {
          dispatch({ type: "publisher/connecting", sessionId });
        }
      },
      onSharing: (publisherSession) => {
        if (
          isCurrentScreenShareRequest({
            attempt,
            currentAttempt: publisherAttemptRef.current,
            currentWorkspaceId: workspaceIdRef.current,
            requestWorkspaceId
          })
        ) {
          publisherSessionRef.current = publisherSession;
          dispatch({
            type: "publisher/sharing",
            sessionId: publisherSession.sessionId
          });
        }
      },
      onNativeStop: () => {
        const publisherSession = publisherSessionRef.current;
        if (!publisherSession) return;
        publisherSessionRef.current = null;
        dispatch({
          type: "publisher/stopping",
          sessionId: publisherSession.sessionId
        });
        dispatch({
          type: "publisher/stopped",
          sessionId: publisherSession.sessionId
        });
        setActiveSession((session) =>
          session?.id === publisherSession.sessionId ? null : session
        );
      },
      workspaceId: requestWorkspaceId
    })
      .then(async (publisherSession) => {
        if (!isCurrentScreenShareRequest({
          attempt,
          currentAttempt: publisherAttemptRef.current,
          currentWorkspaceId: workspaceIdRef.current,
          requestWorkspaceId
        })) {
          await publisherSession.stop();
          return;
        }
      })
      .catch((error: unknown) => {
        if (attempt !== publisherAttemptRef.current) return;
        if (isPickerCancellation(error)) {
          dispatch({ type: "publisher/picker-cancelled" });
          return;
        }
        if (error instanceof ScreenShareApiError && error.details?.session) {
          setActiveSession(error.details.session);
        }
        dispatch({
          type: "publisher/failed",
          error: "화면 공유를 시작하지 못했어요.",
          sessionId: publisherSessionId
        });
        toast.error("화면 공유를 시작하지 못했어요.");
      });
  }, [api, workspaceId]);

  const setViewerMode = useCallback((mode: ViewerMode) => {
    if (stateRef.current.viewer.status !== "viewing") return;
    const type =
      mode === "floating"
        ? "viewer/floating-entered"
        : mode === "focus"
          ? "viewer/focus-entered"
          : "viewer/fullscreen-entered";
    dispatch({ type });
  }, []);

  const reconcileCurrentSession = useCallback(
    (session: PublicScreenShareSession | null) => {
      const result = reconcileCurrentScreenShare({
        currentUserId,
        notifiedSessionIds: notifiedSessionIdsRef.current,
        session
      });
      notifiedSessionIdsRef.current = result.notifiedSessionIds;
      setActiveSession(result.activeSession);
      return result;
    },
    [currentUserId]
  );

  useEffect(() => {
    if (!workspaceId) return;

    const requestWorkspaceId = workspaceId;
    const coordinator = new ScreenShareCurrentSessionCoordinator({
      getCurrent: (id) => api.getCurrent(id),
      isCurrentWorkspace: (id) => workspaceIdRef.current === id,
      onSnapshot: ({ session }) => {
        const result = reconcileCurrentSession(session);
        if (result.shouldToast && session) {
          toast(`${session.sharer.displayName}님이 화면 공유를 시작했어요`, {
            action: {
              label: "시청하기",
              onClick: () => startViewingRef.current(session.id)
            }
          });
        }
        const staleViewerSessionId = !session
          ? viewerTargetSessionIdRef.current
          : null;
        if (staleViewerSessionId) {
          void stopViewerResource(staleViewerSessionId, "ended");
        }
      },
      workspaceId: requestWorkspaceId
    });

    const invalidateCurrent = () => coordinator.invalidate();
    requestCurrentRef.current = invalidateCurrent;
    invalidateCurrent();
    return () => {
      coordinator.dispose();
      requestCurrentRef.current = () => undefined;
    };
  }, [api, reconcileCurrentSession, stopViewerResource, workspaceId]);

  useEffect(() => {
    if (!socket || !workspaceId) return;

    const handleJoined = (payload: WorkspacePresenceJoinedPayload) => {
      if (payload.workspaceId !== workspaceId) return;
      requestCurrentRef.current();
    };
    const handleScreenShareInvalidated = () => requestCurrentRef.current();

    socket.on(workspacePresenceServerEvents.joined, handleJoined);
    socket.on("workspace-screen-share:started", handleScreenShareInvalidated);
    socket.on("workspace-screen-share:ended", handleScreenShareInvalidated);
    return () => {
      socket.off(workspacePresenceServerEvents.joined, handleJoined);
      socket.off("workspace-screen-share:started", handleScreenShareInvalidated);
      socket.off("workspace-screen-share:ended", handleScreenShareInvalidated);
    };
  }, [socket, workspaceId]);

  useEffect(() => {
    const previousWorkspaceId = previousWorkspaceIdRef.current;
    const cleanup = getWorkspaceScreenShareCleanup({
      nextWorkspaceId: workspaceId,
      previousWorkspaceId,
      publisherSessionId: publisherSessionRef.current?.sessionId ?? null,
      viewerSessionId: viewerTargetSessionIdRef.current
    });
    previousWorkspaceIdRef.current = workspaceId;
    if (previousWorkspaceId === workspaceId) return;

    publisherAttemptRef.current += 1;
    viewerAttemptRef.current += 1;
    notifiedSessionIdsRef.current = new Set();
    setActiveSession(null);
    if (cleanup.stopPublisher) {
      const publisherSession = publisherSessionRef.current;
      publisherSessionRef.current = null;
      if (publisherSession) {
        dispatch({
          type: "publisher/stopping",
          sessionId: publisherSession.sessionId
        });
        void publisherSession.stop().finally(() => {
          dispatch({
            type: "publisher/stopped",
            sessionId: publisherSession.sessionId
          });
        });
      }
    } else if (
      stateRef.current.publisher.status === "selecting" ||
      stateRef.current.publisher.status === "reserving"
    ) {
      dispatch({
        type: "publisher/failed",
        error: "",
        sessionId: null
      });
    }
    if (cleanup.stopViewer) {
      const viewerSession = viewerSessionRef.current;
      viewerSessionRef.current = null;
      viewerTargetSessionIdRef.current = null;
      setViewerMediaElement(null);
      if (viewerSession) void viewerSession.stop();
      const sessionId = stateRef.current.viewer.sessionId;
      if (sessionId) dispatch({ type: "viewer/closed", sessionId });
    }
  }, [workspaceId]);

  useEffect(
    () => () => {
      publisherAttemptRef.current += 1;
      viewerAttemptRef.current += 1;
      const publisherSession = publisherSessionRef.current;
      const viewerSession = viewerSessionRef.current;
      publisherSessionRef.current = null;
      viewerSessionRef.current = null;
      viewerTargetSessionIdRef.current = null;
      if (publisherSession) void publisherSession.stop();
      if (viewerSession) void viewerSession.stop();
    },
    []
  );

  const value = useMemo<ScreenShareRuntimeContextValue>(
    () => ({
      activeSession,
      currentUserId,
      publisherStatus: state.publisher.status,
      setViewerMode,
      startSharing,
      startViewing,
      stopSharing,
      stopViewing,
      viewer: state.viewer,
      viewerMediaElement
    }),
    [
      activeSession,
      currentUserId,
      setViewerMode,
      startSharing,
      startViewing,
      state.publisher.status,
      state.viewer,
      stopSharing,
      stopViewing,
      viewerMediaElement
    ]
  );

  return (
    <ScreenShareRuntimeContext.Provider value={value}>
      {children}
    </ScreenShareRuntimeContext.Provider>
  );
}

export function useScreenShareRuntime() {
  const context = useContext(ScreenShareRuntimeContext);
  if (!context) {
    throw new Error(
      "useScreenShareRuntime must be used inside ScreenShareRuntimeProvider"
    );
  }
  return context;
}
