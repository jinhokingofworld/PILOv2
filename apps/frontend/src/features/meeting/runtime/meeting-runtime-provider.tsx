"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

import { useAuthSession } from "@/features/auth";
import { createMeetingApiClient } from "@/features/meeting/api/client";
import { useLiveKitMeetingRoom } from "@/features/meeting/hooks/use-livekit-meeting-room";
import { useMeetingStateRealtime } from "@/features/meeting/hooks/use-meeting-state-realtime";
import {
  setHeaderMeetingConnectionState,
  setHeaderMeetingRecordingStatus
} from "@/features/meeting/stores/header-meeting-status-store";
import { notifyMeetingStateInvalidated } from "@/features/meeting/stores/meeting-state-invalidation-store";
import type {
  LeaveMeetingPayload,
  LiveKitJoin,
  Meeting
} from "@/features/meeting/types";

type MeetingRuntimeActiveSession = {
  accessToken: string;
  meetingId: string;
  workspaceId: string;
};

type MeetingRuntimeContextValue = {
  activeMeetingId: string | null;
  activeWorkspaceId: string | null;
  clearActiveMeeting: () => void;
  connectToMeeting: (input: {
    audioDeviceId: string | null;
    livekit: LiveKitJoin;
    meeting: Meeting;
  }) => Promise<void>;
  disconnectFromMeeting: () => Promise<void>;
  leaveActiveMeeting: () => Promise<LeaveMeetingPayload | null>;
  liveKitRoom: ReturnType<typeof useLiveKitMeetingRoom>;
};

const MeetingRuntimeContext =
  createContext<MeetingRuntimeContextValue | null>(null);

export function MeetingRuntimeProvider({ children }: { children: ReactNode }) {
  const authSession = useAuthSession();
  const liveKitRoom = useLiveKitMeetingRoom();
  const {
    connect: connectLiveKitRoom,
    connectionQuality,
    disconnect: disconnectLiveKitRoom,
    hasActiveSession,
    status: liveKitRoomStatus
  } = liveKitRoom;
  const activeSessionRef = useRef<MeetingRuntimeActiveSession | null>(null);
  const [activeSession, setActiveSessionState] =
    useState<MeetingRuntimeActiveSession | null>(null);

  const setActiveSession = useCallback(
    (nextSession: MeetingRuntimeActiveSession | null) => {
      activeSessionRef.current = nextSession;
      setActiveSessionState(nextSession);
    },
    []
  );

  const refreshHeaderRecordingStatus = useCallback(() => {
    const session = activeSessionRef.current;
    if (!session) return;

    const meetingClient = createMeetingApiClient({
      accessToken: session.accessToken
    });
    void meetingClient
      .getCurrentRecording(session.workspaceId, session.meetingId)
      .then((result) => {
        const currentSession = activeSessionRef.current;
        if (
          !currentSession ||
          currentSession.workspaceId !== session.workspaceId ||
          currentSession.meetingId !== session.meetingId
        ) {
          return;
        }
        setHeaderMeetingRecordingStatus(result.recording?.status ?? null);
      })
      .catch(() => undefined);
  }, []);

  const handleMeetingStateInvalidated = useCallback(() => {
    notifyMeetingStateInvalidated();
    refreshHeaderRecordingStatus();
  }, [refreshHeaderRecordingStatus]);

  useMeetingStateRealtime({
    accessToken: authSession?.accessToken ?? null,
    enabled: Boolean(authSession?.accessToken && authSession?.activeWorkspaceId),
    onStateInvalidated: handleMeetingStateInvalidated,
    workspaceId: authSession?.activeWorkspaceId ?? ""
  });

  const clearActiveMeeting = useCallback(() => {
    setActiveSession(null);
  }, [setActiveSession]);

  const disconnectFromMeeting = useCallback(async () => {
    await disconnectLiveKitRoom();
    setActiveSession(null);
    setHeaderMeetingRecordingStatus(null);
  }, [disconnectLiveKitRoom, setActiveSession]);

  const leaveSession = useCallback(
    async (session: MeetingRuntimeActiveSession) => {
      const meetingClient = createMeetingApiClient({
        accessToken: session.accessToken
      });
      const result = await meetingClient.leaveMeeting(
        session.workspaceId,
        session.meetingId
      );

      await disconnectLiveKitRoom();
      setActiveSession(null);
      setHeaderMeetingRecordingStatus(null);

      return result;
    },
    [disconnectLiveKitRoom, setActiveSession]
  );

  const connectToMeeting = useCallback(
    async ({
      audioDeviceId,
      livekit,
      meeting
    }: {
      audioDeviceId: string | null;
      livekit: LiveKitJoin;
      meeting: Meeting;
    }) => {
      const accessToken = authSession?.accessToken.trim() ?? "";
      const workspaceId = authSession?.activeWorkspaceId ?? meeting.workspaceId;

      if (!accessToken || !workspaceId) {
        throw new Error("Meeting runtime requires an authenticated workspace");
      }

      const previousSession = activeSessionRef.current;

      if (
        previousSession &&
        (previousSession.workspaceId !== workspaceId ||
          previousSession.meetingId !== meeting.id)
      ) {
        await leaveSession(previousSession);
      }

      await connectLiveKitRoom(
        livekit,
        audioDeviceId,
        previousSession?.workspaceId === workspaceId &&
          previousSession.meetingId === meeting.id
      );
      setActiveSession({
        accessToken,
        meetingId: meeting.id,
        workspaceId
      });
      refreshHeaderRecordingStatus();
    },
    [
      authSession?.accessToken,
      authSession?.activeWorkspaceId,
      connectLiveKitRoom,
      leaveSession,
      refreshHeaderRecordingStatus,
      setActiveSession
    ]
  );

  const leaveActiveMeeting = useCallback(async () => {
    const currentSession = activeSessionRef.current;

    if (!currentSession) {
      await disconnectFromMeeting();
      return null;
    }

    return leaveSession(currentSession);
  }, [disconnectFromMeeting, leaveSession]);

  useEffect(() => {
    setHeaderMeetingConnectionState({
      connectionQuality,
      connectionStatus: liveKitRoomStatus,
      hasConnectionSession: hasActiveSession
    });
  }, [connectionQuality, hasActiveSession, liveKitRoomStatus]);

  useEffect(() => {
    return () => {
      setHeaderMeetingConnectionState({
        connectionQuality: "unknown",
        connectionStatus: "idle",
        hasConnectionSession: false
      });
      setHeaderMeetingRecordingStatus(null);
    };
  }, []);

  const contextValue = useMemo<MeetingRuntimeContextValue>(
    () => ({
      activeMeetingId: activeSession?.meetingId ?? null,
      activeWorkspaceId: activeSession?.workspaceId ?? null,
      clearActiveMeeting,
      connectToMeeting,
      disconnectFromMeeting,
      leaveActiveMeeting,
      liveKitRoom
    }),
    [
      activeSession?.meetingId,
      activeSession?.workspaceId,
      clearActiveMeeting,
      connectToMeeting,
      disconnectFromMeeting,
      leaveActiveMeeting,
      liveKitRoom
    ]
  );

  return (
    <MeetingRuntimeContext.Provider value={contextValue}>
      {children}
      <div
        ref={liveKitRoom.remoteAudioContainerRef}
        aria-hidden="true"
        className="hidden"
        data-livekit-audio-sink="true"
      />
    </MeetingRuntimeContext.Provider>
  );
}

export function useMeetingRuntime() {
  const context = useContext(MeetingRuntimeContext);

  if (!context) {
    throw new Error("useMeetingRuntime must be used inside MeetingRuntimeProvider");
  }

  return context;
}
