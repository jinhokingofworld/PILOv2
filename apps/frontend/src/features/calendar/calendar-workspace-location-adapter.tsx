"use client";

import { useMemo, type RefObject } from "react";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import {
  createCalendarWorkspaceLocation,
  getCalendarScrollOffset,
  readCalendarWorkspaceTarget,
  waitForCalendarScrollTarget,
  type CalendarFollowSurfaceKey,
} from "./calendar-workspace-location";

type CalendarDomScrollTarget = {
  element: HTMLElement;
  eventId: string | null;
  selectedDate: string;
  surface: CalendarFollowSurfaceKey;
};

function findCalendarScrollTarget(
  gridRef: RefObject<HTMLDivElement | null>,
  selectedDate?: string,
  eventId?: string | null,
  surface?: CalendarFollowSurfaceKey,
): CalendarDomScrollTarget | null {
  if (!surface || surface !== "calendar-grid") {
    const dialogs = document.querySelectorAll<HTMLElement>(
      "[data-workspace-follow-surface][data-workspace-follow-selected-date]",
    );
    for (const element of dialogs) {
      const candidateSurface = element.dataset.workspaceFollowSurface;
      if (
        candidateSurface !== "calendar-event-detail" &&
        candidateSurface !== "calendar-events-dialog"
      ) {
        continue;
      }
      const target: CalendarDomScrollTarget = {
        element,
        eventId: element.dataset.workspaceFollowEventId ?? null,
        selectedDate: element.dataset.workspaceFollowSelectedDate ?? "",
        surface: candidateSurface,
      };
      if (
        (!surface || target.surface === surface) &&
        (!selectedDate || target.selectedDate === selectedDate) &&
        (eventId === undefined || target.eventId === eventId)
      ) {
        return target;
      }
    }
  }

  if (!surface || surface === "calendar-grid") {
    const grid = gridRef.current;
    const gridDate = grid?.dataset.workspaceFollowSelectedDate ?? "";
    if (grid && (!selectedDate || gridDate === selectedDate)) {
      return {
        element: grid,
        eventId: null,
        selectedDate: gridDate,
        surface: "calendar-grid",
      };
    }
  }

  return null;
}

function captureMetrics(element: HTMLElement) {
  return {
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
    scrollWidth: element.scrollWidth,
  };
}

export function CalendarWorkspaceLocationAdapter({
  gridRef,
  onCloseReadOnlySurfaces,
  onOpenEventById,
  onOpenEventsByDate,
  onSelectDate,
}: {
  gridRef: RefObject<HTMLDivElement | null>;
  onCloseReadOnlySurfaces: () => void;
  onOpenEventById: (eventId: string) => boolean;
  onOpenEventsByDate: (date: string) => boolean;
  onSelectDate: (date: string | null) => void;
}) {
  const adapter = useMemo(
    () => ({
      capture() {
        const target = findCalendarScrollTarget(gridRef);
        if (!target) return null;
        const location = createCalendarWorkspaceLocation(
          {
            eventId: target.eventId,
            selectedDate: target.selectedDate,
            surface: target.surface,
          },
          captureMetrics(target.element),
        );
        return location as unknown as WorkspacePresenceLocation | null;
      },
      page: "calendar" as const,
      ready: true,
      async restore(
        location: WorkspacePresenceLocation,
        { signal }: { signal: AbortSignal },
      ) {
        if (signal.aborted) return false;
        const target = readCalendarWorkspaceTarget(location);
        if (!target) return false;

        onSelectDate(target.selectedDate);
        let opened = target.surface === "calendar-grid";
        if (opened) onCloseReadOnlySurfaces();

        const scroller = await waitForCalendarScrollTarget({
          eventId: target.eventId,
          findTarget: () => {
            if (!opened) {
              opened = target.eventId
                ? onOpenEventById(target.eventId)
                : onOpenEventsByDate(target.selectedDate);
            }
            return findCalendarScrollTarget(
              gridRef,
              target.selectedDate,
              target.eventId,
              target.surface,
            );
          },
          selectedDate: target.selectedDate,
          signal,
          surface: target.surface,
          timeoutMs: 5_000,
        });
        if (!scroller || signal.aborted) return false;

        scroller.scrollTo(
          getCalendarScrollOffset(target.viewport, {
            clientHeight: scroller.clientHeight,
            clientWidth: scroller.clientWidth,
            scrollHeight: scroller.scrollHeight,
            scrollWidth: scroller.scrollWidth,
          }),
        );
        return true;
      },
    }),
    [
      gridRef,
      onCloseReadOnlySurfaces,
      onOpenEventById,
      onOpenEventsByDate,
      onSelectDate,
    ],
  );
  useWorkspaceLocationAdapter(adapter);
  return null;
}
