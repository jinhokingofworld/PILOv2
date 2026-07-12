"use client";

import { useEffect, useRef } from "react";
import { io } from "socket.io-client";

import type {
  MeetingReportFailedStep,
  MeetingReportStatus
} from "@/features/meeting/types";

export type MeetingReportRealtimeEvent = {
  event: "meeting:report:updated";
  failedStep: MeetingReportFailedStep | null;
  meetingId: string;
  recordingId: string;
  reportId: string;
  status: MeetingReportStatus;
  updatedAt: string;
};

type UseMeetingReportRealtimeOptions = {
  accessToken: string | null;
  enabled: boolean;
  onReportUpdated: (event: MeetingReportRealtimeEvent) => void;
  workspaceId: string;
};

const reportStatuses: MeetingReportStatus[] = [
  "PROCESSING",
  "QUEUED",
  "TRANSCRIBING",
  "SUMMARIZING",
  "COMPLETED",
  "FAILED"
];

const failedSteps: MeetingReportFailedStep[] = ["RECORDING", "STT", "LLM"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isMeetingReportRealtimeEvent(
  value: unknown
): value is MeetingReportRealtimeEvent {
  if (!isRecord(value)) return false;

  return (
    value.event === "meeting:report:updated" &&
    typeof value.reportId === "string" &&
    typeof value.meetingId === "string" &&
    typeof value.recordingId === "string" &&
    reportStatuses.includes(value.status as MeetingReportStatus) &&
    (value.failedStep === null ||
      failedSteps.includes(value.failedStep as MeetingReportFailedStep)) &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt))
  );
}

export function useMeetingReportRealtime({
  accessToken,
  enabled,
  onReportUpdated,
  workspaceId
}: UseMeetingReportRealtimeOptions) {
  const onReportUpdatedRef = useRef(onReportUpdated);

  useEffect(() => {
    onReportUpdatedRef.current = onReportUpdated;
  }, [onReportUpdated]);

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
    const handleReportUpdated = (event: unknown) => {
      if (!isMeetingReportRealtimeEvent(event)) return;
      onReportUpdatedRef.current(event);
    };

    socket.on("connect", subscribe);
    socket.on("meeting:report:updated", handleReportUpdated);

    return () => {
      socket.off("connect", subscribe);
      socket.off("meeting:report:updated", handleReportUpdated);
      socket.emit("meeting:unsubscribe", { workspaceId: normalizedWorkspaceId });
      socket.disconnect();
    };
  }, [accessToken, enabled, workspaceId]);
}
