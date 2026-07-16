"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null>(
    null
  );
  const requestGenerationRef = useRef(0);

  const selectMeetingRoom = useCallback((meetingRoomId: string) => {
    setSelectedMeetingRoomId(meetingRoomId);
  }, []);

  const reloadMeetingRooms = useCallback(async () => {
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;

    if (!canLoad) {
      setRooms([]);
      setSelectedMeetingRoomId(null);
      setStatus("idle");
      setError(null);
      setLoadedWorkspaceId(null);
      return [];
    }

    setStatus("loading");
    setError(null);
    setLoadedWorkspaceId(null);

    try {
      const result = await meetingClient.listMeetingRooms(normalizedWorkspaceId);
      if (requestGenerationRef.current !== requestGeneration) {
        return [];
      }

      setRooms(result.rooms);
      setSelectedMeetingRoomId((currentMeetingRoomId) => {
        if (result.rooms.some((room) => room.id === currentMeetingRoomId)) {
          return currentMeetingRoomId;
        }

        return result.rooms.find((room) => room.isDefault)?.id ?? result.rooms[0]?.id ?? null;
      });
      setStatus("success");
      setLoadedWorkspaceId(normalizedWorkspaceId);
      return result.rooms;
    } catch (nextError) {
      if (requestGenerationRef.current !== requestGeneration) {
        return [];
      }

      setRooms([]);
      setSelectedMeetingRoomId(null);
      setStatus("error");
      setError(errorFromUnknown(nextError));
      setLoadedWorkspaceId(normalizedWorkspaceId);
      return [];
    }
  }, [canLoad, meetingClient, normalizedWorkspaceId]);

  useEffect(() => {
    void reloadMeetingRooms();

    return () => {
      requestGenerationRef.current += 1;
    };
  }, [reloadMeetingRooms]);

  const isCurrentWorkspaceResult = Boolean(
    canLoad && loadedWorkspaceId === normalizedWorkspaceId
  );

  return {
    error: isCurrentWorkspaceResult ? error : null,
    loadedWorkspaceId: isCurrentWorkspaceResult ? loadedWorkspaceId : null,
    reloadMeetingRooms,
    rooms: isCurrentWorkspaceResult ? rooms : [],
    selectMeetingRoom,
    selectedMeetingRoomId: isCurrentWorkspaceResult
      ? selectedMeetingRoomId
      : null,
    status:
      !canLoad || status === "idle"
        ? "idle"
        : isCurrentWorkspaceResult
          ? status
          : "loading"
  };
}
