"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createMeetingApiClient } from "@/features/meeting/api/client";
import type { MeetingRoom } from "@/features/meeting/types";

export type MeetingRoomsStatus = "idle" | "loading" | "success" | "error";

type UseMeetingRoomsOptions = {
  accessToken?: string | null;
  enabled?: boolean;
  workspaceId: string;
};

function errorFromUnknown(error: unknown) {
  return error instanceof Error
    ? error
    : new Error("Meeting rooms could not be loaded");
}

export function useMeetingRooms({
  accessToken = null,
  enabled = true,
  workspaceId
}: UseMeetingRoomsOptions) {
  const normalizedAccessToken = accessToken?.trim() || null;
  const normalizedWorkspaceId = workspaceId.trim();
  const canLoad = Boolean(enabled && normalizedAccessToken && normalizedWorkspaceId);
  const meetingClient = useMemo(
    () => createMeetingApiClient({ accessToken: normalizedAccessToken }),
    [normalizedAccessToken]
  );
  const [rooms, setRooms] = useState<MeetingRoom[]>([]);
  const [selectedMeetingRoomId, setSelectedMeetingRoomId] = useState<string | null>(
    null
  );
  const [status, setStatus] = useState<MeetingRoomsStatus>("idle");
  const [error, setError] = useState<Error | null>(null);

  const selectMeetingRoom = useCallback((meetingRoomId: string) => {
    setSelectedMeetingRoomId(meetingRoomId);
  }, []);

  const reloadMeetingRooms = useCallback(async () => {
    if (!canLoad) {
      setRooms([]);
      setSelectedMeetingRoomId(null);
      setStatus("idle");
      setError(null);
      return [];
    }

    setStatus("loading");
    setError(null);

    try {
      const result = await meetingClient.listMeetingRooms(normalizedWorkspaceId);
      setRooms(result.rooms);
      setSelectedMeetingRoomId((currentMeetingRoomId) => {
        if (result.rooms.some((room) => room.id === currentMeetingRoomId)) {
          return currentMeetingRoomId;
        }

        return result.rooms.find((room) => room.isDefault)?.id ?? result.rooms[0]?.id ?? null;
      });
      setStatus("success");
      return result.rooms;
    } catch (nextError) {
      setRooms([]);
      setSelectedMeetingRoomId(null);
      setStatus("error");
      setError(errorFromUnknown(nextError));
      return [];
    }
  }, [canLoad, meetingClient, normalizedWorkspaceId]);

  useEffect(() => {
    void reloadMeetingRooms();
  }, [reloadMeetingRooms]);

  return {
    error,
    reloadMeetingRooms,
    rooms,
    selectMeetingRoom,
    selectedMeetingRoomId,
    status
  };
}
