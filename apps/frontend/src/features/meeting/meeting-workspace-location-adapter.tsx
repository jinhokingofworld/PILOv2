"use client";

import { useEffect, useMemo } from "react";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import {
  createMeetingReportWorkspaceLocation,
  createMeetingWorkspaceLocation,
  getMeetingScrollOffset,
  readMeetingReportTarget,
  readMeetingRoomId,
  waitForMeetingContentTarget,
} from "./meeting-workspace-location";

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
        if (
          location.page !== "meeting" ||
          location.route.pathname !== "/meeting" ||
          location.context.reportId !== null ||
          location.viewport.kind !== "document"
        ) {
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

function findMeetingReportScroller(reportId: string) {
  const element = document.querySelector<HTMLElement>(
    '[data-workspace-follow-surface="meeting-content"]',
  );
  return element?.dataset.workspaceFollowReportId === reportId
    ? element
    : null;
}

export function MeetingReportWorkspaceLocationAdapter({
  closeReport,
  openReport,
  selectedReportId,
}: {
  closeReport: () => void;
  openReport: (reportId: string) => void;
  selectedReportId: string | null;
}) {
  const adapter = useMemo(
    () => ({
      capture() {
        const reportScroller = selectedReportId
          ? findMeetingReportScroller(selectedReportId)
          : null;
        if (selectedReportId && reportScroller) {
          return createMeetingReportWorkspaceLocation(selectedReportId, {
            clientHeight: reportScroller.clientHeight,
            clientWidth: reportScroller.clientWidth,
            scrollHeight: reportScroller.scrollHeight,
            scrollLeft: reportScroller.scrollLeft,
            scrollTop: reportScroller.scrollTop,
            scrollWidth: reportScroller.scrollWidth,
          });
        }
        const scroller = getDocumentScroller();
        return createMeetingReportWorkspaceLocation(null, {
          clientHeight: scroller.clientHeight,
          clientWidth: scroller.clientWidth,
          scrollHeight: scroller.scrollHeight,
          scrollLeft: scroller.scrollLeft,
          scrollTop: scroller.scrollTop,
          scrollWidth: scroller.scrollWidth,
        });
      },
      page: "meeting" as const,
      ready: true,
      async restore(
        location: WorkspacePresenceLocation,
        { signal }: { signal: AbortSignal },
      ) {
        if (
          signal.aborted ||
          location.page !== "meeting" ||
          location.route.pathname !== "/report" ||
          location.context.meetingRoomId !== null
        ) {
          return false;
        }

        const target = readMeetingReportTarget(location);
        if (target) {
          if (target.reportId !== selectedReportId) {
            openReport(target.reportId);
          }
          const scroller = await waitForMeetingContentTarget({
            findTarget: () => findMeetingReportScroller(target.reportId),
            signal,
            timeoutMs: 5_000,
          });
          if (!scroller || signal.aborted) return false;
          scroller.scrollTo(
            getMeetingScrollOffset(target.viewport, {
              clientHeight: scroller.clientHeight,
              clientWidth: scroller.clientWidth,
              scrollHeight: scroller.scrollHeight,
              scrollWidth: scroller.scrollWidth,
            }),
          );
          return true;
        }

        if (
          location.context.reportId !== null ||
          location.viewport.kind !== "document"
        ) {
          return false;
        }
        closeReport();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        if (signal.aborted) return false;
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
    [closeReport, openReport, selectedReportId],
  );
  const { reportLocationChange } = useWorkspaceLocationAdapter(adapter);

  useEffect(() => {
    if (!selectedReportId) {
      reportLocationChange();
      return;
    }
    const controller = new AbortController();
    void waitForMeetingContentTarget({
      findTarget: () => findMeetingReportScroller(selectedReportId),
      signal: controller.signal,
      timeoutMs: 5_000,
    }).then((target) => {
      if (target && !controller.signal.aborted) reportLocationChange();
    });
    return () => controller.abort();
  }, [reportLocationChange, selectedReportId]);

  return null;
}
