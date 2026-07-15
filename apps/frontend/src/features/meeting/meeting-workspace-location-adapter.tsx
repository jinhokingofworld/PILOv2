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
  selectedMeetingRoomId,
  selectMeetingRoom,
}: {
  availableRoomIds: string[];
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
      ready: availableRoomIds.length > 0,
      async restore(location: WorkspacePresenceLocation) {
        if (location.page !== "meeting" || location.viewport.kind !== "document") {
          return false;
        }
        const roomId = readMeetingRoomId(location, availableRoomIds);
        if (!roomId) return false;
        selectMeetingRoom(roomId);
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
    [availableRoomIds, selectMeetingRoom, selectedMeetingRoomId],
  );
  useWorkspaceLocationAdapter(adapter);
  return null;
}
