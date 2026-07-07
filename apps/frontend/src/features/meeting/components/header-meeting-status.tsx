"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

import { useAuthSession } from "@/features/auth";
import type { LiveKitMeetingRoomStatus } from "@/features/meeting/hooks/use-livekit-meeting-room";
import { useMeetingWorkspaceData } from "@/features/meeting/hooks/use-meeting-workspace-data";
import {
  getHeaderMeetingStatusServerSnapshot,
  getHeaderMeetingStatusSnapshot,
  subscribeHeaderMeetingStatus
} from "@/features/meeting/stores/header-meeting-status-store";
import type { RecordingStatus } from "@/features/meeting/types";
import { cn } from "@/lib/utils";

const HEADER_MEETING_STATUS_POLL_INTERVAL_MS = 5000;

function getConnectionStatusLabel(status: LiveKitMeetingRoomStatus) {
  switch (status) {
    case "connected":
      return "음성 연결중";
    case "connecting":
      return "연결중";
    case "reconnecting":
      return "재연결중";
    case "disconnected":
      return "연결 끊김";
    case "error":
      return "연결 실패";
    case "idle":
      return "음성 미연결";
  }
}

function getRecordingStatusLabel(status: RecordingStatus | null | undefined) {
  switch (status) {
    case "RUNNING":
      return "녹음중";
    case "COMPLETED":
      return "녹음 완료";
    case "FAILED":
      return "녹음 실패";
    default:
      return "녹음 대기";
  }
}

function getConnectionTone(status: LiveKitMeetingRoomStatus) {
  if (status === "connected") {
    return "success";
  }

  if (status === "error" || status === "disconnected") {
    return "danger";
  }

  if (status === "connecting" || status === "reconnecting") {
    return "warning";
  }

  return "default";
}

function getRecordingTone(status: RecordingStatus | null | undefined) {
  if (status === "RUNNING") {
    return "danger";
  }

  if (status === "FAILED") {
    return "warning";
  }

  return "default";
}

function StatusIndicator({
  label,
  tone
}: {
  label: string;
  tone: "default" | "success" | "warning" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium",
        tone === "default" && "border-border bg-background text-muted-foreground",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive"
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          tone === "default" && "bg-muted-foreground",
          tone === "success" && "bg-emerald-500",
          tone === "warning" && "bg-amber-500",
          tone === "danger" && "bg-destructive"
        )}
      />
      {label}
    </span>
  );
}

export function HeaderMeetingStatus() {
  const pathname = usePathname();
  const authSession = useAuthSession();
  const workspaceId = authSession?.activeWorkspaceId ?? "";
  const accessToken = authSession?.accessToken.trim() ?? "";
  const isMeetingRoute = pathname === "/meeting" || pathname.startsWith("/meeting/");
  const headerMeetingStatus = useSyncExternalStore(
    subscribeHeaderMeetingStatus,
    getHeaderMeetingStatusSnapshot,
    getHeaderMeetingStatusServerSnapshot
  );
  const { canLoad, currentRecording, reloadCurrentMeeting } =
    useMeetingWorkspaceData({
      accessToken,
      enabled: Boolean(workspaceId && accessToken && !isMeetingRoute),
      reportsEnabled: false,
      workspaceId
    });
  const connectionStatus = headerMeetingStatus.connectionStatus;
  const recordingStatus = isMeetingRoute
    ? headerMeetingStatus.recordingStatus
    : currentRecording?.status;

  useEffect(() => {
    if (!canLoad) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void reloadCurrentMeeting();
    }, HEADER_MEETING_STATUS_POLL_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [canLoad, reloadCurrentMeeting]);

  return (
    <div
      aria-label="회의 상태"
      className="flex min-w-0 shrink-0 flex-nowrap items-center justify-end gap-2"
    >
      <StatusIndicator
        label={getConnectionStatusLabel(connectionStatus)}
        tone={getConnectionTone(connectionStatus)}
      />
      <StatusIndicator
        label={getRecordingStatusLabel(recordingStatus)}
        tone={getRecordingTone(recordingStatus)}
      />
    </div>
  );
}
