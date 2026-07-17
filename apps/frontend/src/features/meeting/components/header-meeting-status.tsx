"use client";

import { useSyncExternalStore } from "react";

import type {
  LiveKitConnectionQuality,
  LiveKitMeetingRoomStatus
} from "@/features/meeting/hooks/use-livekit-meeting-room";
import {
  getHeaderMeetingStatusServerSnapshot,
  getHeaderMeetingStatusSnapshot,
  subscribeHeaderMeetingStatus
} from "@/features/meeting/stores/header-meeting-status-store";
import type { RecordingStatus } from "@/features/meeting/types";
import { cn } from "@/lib/utils";

function getConnectionStatusLabel(
  status: LiveKitMeetingRoomStatus,
  quality: LiveKitConnectionQuality
) {
  switch (status) {
    case "connected":
      if (quality === "poor") {
        return "음성 품질 낮음";
      }
      if (quality === "lost") {
        return "음성 연결 불안정";
      }
      return "음성 연결됨";
    case "connecting":
      return "음성 연결 중";
    case "reconnecting":
      return "재연결 중";
    case "disconnected":
      return "음성 연결 끊김";
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

function getConnectionTone(
  status: LiveKitMeetingRoomStatus,
  quality: LiveKitConnectionQuality
) {
  if (status === "connected" && quality === "lost") {
    return "danger";
  }

  if (status === "connected" && quality === "poor") {
    return "warning";
  }

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
  const headerMeetingStatus = useSyncExternalStore(
    subscribeHeaderMeetingStatus,
    getHeaderMeetingStatusSnapshot,
    getHeaderMeetingStatusServerSnapshot
  );
  const connectionStatus = headerMeetingStatus.connectionStatus;
  const connectionQuality = headerMeetingStatus.connectionQuality;
  const recordingStatus = headerMeetingStatus.recordingStatus;

  if (!headerMeetingStatus.hasConnectionSession) {
    return null;
  }

  return (
    <div
      aria-label="회의 상태"
      className="flex min-w-0 shrink-0 flex-nowrap items-center justify-end gap-2"
    >
      <StatusIndicator
        label={getConnectionStatusLabel(connectionStatus, connectionQuality)}
        tone={getConnectionTone(connectionStatus, connectionQuality)}
      />
      <StatusIndicator
        label={getRecordingStatusLabel(recordingStatus)}
        tone={getRecordingTone(recordingStatus)}
      />
    </div>
  );
}
