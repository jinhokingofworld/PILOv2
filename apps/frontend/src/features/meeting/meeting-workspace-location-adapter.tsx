"use client";

import { useMemo } from "react";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import { createMeetingWorkspaceLocation, getMeetingScrollOffset, readMeetingRoomId } from "./meeting-workspace-location";

function getDocumentScroller() {
  return document.scrollingElement ?? document.documentElement;
}

export function MeetingWorkspaceLocationAdapter({
  availableRoomIds,
  roomsReady,
  selectedMeetingRoomId,
  selectMeetingRoom,
}: {
  availableRoomIds: string[];
  roomsReady: boolean;
  selectedMeetingRoomId: string | null;
  selectMeetingRoom: (meetingRoomId: string) => void;
}) {
  const adapter = useMemo(
    () => ({
      capture() {
        const scroller = getDocumentScroller();
        return createMeetingWorkspaceLocation(selectedMeetingRoomId, {
          clientHeight: scroller.clientHeight,
          clientWidth: scroller.clientWidth,
          scrollHeight: scroller.scrollHeight,
          scrollLeft: scroller.scrollLeft,
          scrollTop: scroller.scrollTop,
          scrollWidth: scroller.scrollWidth,
        });
      },
      page: "meeting" as const,
      ready: roomsReady,
      async restore(location: WorkspacePresenceLocation) {
        if (location.page !== "meeting" || location.viewport.kind !== "document") {
          return false;
        }
        const roomId = readMeetingRoomId(location, availableRoomIds);
        if (roomId === undefined) return false;
        if (roomId !== null) selectMeetingRoom(roomId);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const scroller = getDocumentScroller();
        window.scrollTo(
          getMeetingScrollOffset(location.viewport, {
            clientHeight: scroller.clientHeight,
            clientWidth: scroller.clientWidth,
            scrollHeight: scroller.scrollHeight,
            scrollWidth: scroller.scrollWidth,
          }),
        );
        return true;
      },
    }),
    [availableRoomIds, roomsReady, selectMeetingRoom, selectedMeetingRoomId],
  );
  useWorkspaceLocationAdapter(adapter);
  return null;
}
