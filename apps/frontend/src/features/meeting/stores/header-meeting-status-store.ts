"use client";

import type { LiveKitMeetingRoomStatus } from "@/features/meeting/hooks/use-livekit-meeting-room";
import type { RecordingStatus } from "@/features/meeting/types";

export type HeaderMeetingStatusSnapshot = {
  connectionStatus: LiveKitMeetingRoomStatus;
  recordingStatus: RecordingStatus | null;
};

const emptyHeaderMeetingStatus: HeaderMeetingStatusSnapshot = {
  connectionStatus: "idle",
  recordingStatus: null
};

let headerMeetingStatusSnapshot = emptyHeaderMeetingStatus;
const listeners = new Set<() => void>();

function updateHeaderMeetingStatus(
  nextSnapshot: Partial<HeaderMeetingStatusSnapshot>
) {
  const updatedSnapshot = {
    ...headerMeetingStatusSnapshot,
    ...nextSnapshot
  };

  if (
    updatedSnapshot.connectionStatus ===
      headerMeetingStatusSnapshot.connectionStatus &&
    updatedSnapshot.recordingStatus === headerMeetingStatusSnapshot.recordingStatus
  ) {
    return;
  }

  headerMeetingStatusSnapshot = updatedSnapshot;
  listeners.forEach((listener) => listener());
}

export function getHeaderMeetingStatusSnapshot() {
  return headerMeetingStatusSnapshot;
}

export function getHeaderMeetingStatusServerSnapshot() {
  return emptyHeaderMeetingStatus;
}

export function subscribeHeaderMeetingStatus(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setHeaderMeetingConnectionStatus(
  connectionStatus: LiveKitMeetingRoomStatus
) {
  updateHeaderMeetingStatus({ connectionStatus });
}

export function setHeaderMeetingRecordingStatus(
  recordingStatus: RecordingStatus | null
) {
  updateHeaderMeetingStatus({ recordingStatus });
}
