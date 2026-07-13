"use client";

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

export type MeetingStateRealtimeChange =
  | "started"
  | "participant_joined"
  | "participant_left"
  | "ended"
  | "recording_started"
  | "recording_ended"
  | "recording_failed";

export type MeetingStateRealtimeEvent = {
  event: "meeting:state:updated";
  meetingId: string;
  change: MeetingStateRealtimeChange;
  updatedAt: string;
};

type UseMeetingStateRealtimeOptions = {
  accessToken: string | null;
  enabled: boolean;
  onStateInvalidated: () => void;
  workspaceId: string;
};

const stateChanges: MeetingStateRealtimeChange[] = [
  "started",
  "participant_joined",
  "participant_left",
  "ended",
  "recording_started",
  "recording_ended",
  "recording_failed"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMeetingStateRealtimeEvent(
  value: unknown
): value is MeetingStateRealtimeEvent {
  if (!isRecord(value)) return false;

  return (
    value.event === "meeting:state:updated" &&
    typeof value.meetingId === "string" &&
    value.meetingId.trim().length > 0 &&
    stateChanges.includes(value.change as MeetingStateRealtimeChange) &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt))
  );
}

export function useMeetingStateRealtime({
  accessToken,
  enabled,
  onStateInvalidated,
  workspaceId
}: UseMeetingStateRealtimeOptions) {
  const onStateInvalidatedRef = useRef(onStateInvalidated);

  useEffect(() => {
    onStateInvalidatedRef.current = onStateInvalidated;
  }, [onStateInvalidated]);

  useEffect(() => {
    const realtimeUrl = process.env.NEXT_PUBLIC_PILO_REALTIME_SERVER_URL?.trim();
    const token = accessToken?.trim();
    const normalizedWorkspaceId = workspaceId.trim();

    if (!enabled || !token || !realtimeUrl || !normalizedWorkspaceId) {
      return;
    }

    const socket = io(realtimeUrl, { auth: { token } });
    const subscribe = () => {
      socket.emit("meeting:subscribe", { workspaceId: normalizedWorkspaceId });
    };
    const invalidate = () => {
      onStateInvalidatedRef.current();
    };
    const handleStateUpdated = (event: unknown) => {
      if (!isMeetingStateRealtimeEvent(event)) return;
      invalidate();
    };

    socket.on("connect", subscribe);
    socket.on("meeting:subscribed", invalidate);
    socket.on("meeting:state:updated", handleStateUpdated);

    return () => {
      socket.off("connect", subscribe);
      socket.off("meeting:subscribed", invalidate);
      socket.off("meeting:state:updated", handleStateUpdated);
      socket.emit("meeting:unsubscribe", { workspaceId: normalizedWorkspaceId });
      socket.disconnect();
    };
  }, [accessToken, enabled, workspaceId]);
}
