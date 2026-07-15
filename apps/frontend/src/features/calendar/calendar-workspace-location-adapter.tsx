"use client";

import { useMemo, type RefObject } from "react";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import { createCalendarWorkspaceLocation, getCalendarScrollOffset } from "./calendar-workspace-location";

export function CalendarWorkspaceLocationAdapter({
  gridRef,
  onSelectDate,
  selectedDate,
}: {
  gridRef: RefObject<HTMLDivElement | null>;
  onSelectDate: (date: string | null) => void;
  selectedDate: string | null;
}) {
  const adapter = useMemo(
    () => ({
      capture() {
        const grid = gridRef.current;
        if (!grid) return null;
        return createCalendarWorkspaceLocation(selectedDate, {
          clientHeight: grid.clientHeight,
          clientWidth: grid.clientWidth,
          scrollHeight: grid.scrollHeight,
          scrollLeft: grid.scrollLeft,
          scrollTop: grid.scrollTop,
          scrollWidth: grid.scrollWidth,
        });
      },
      page: "calendar" as const,
      ready: true,
      async restore(location: WorkspacePresenceLocation) {
        const selected = location.context.selectedDate;
        if (
          location.page !== "calendar" ||
          location.viewport.kind !== "element" ||
          location.viewport.key !== "calendar-grid" ||
          (selected !== null && !/^\d{4}-\d{2}-\d{2}$/.test(selected))
        ) {
          return false;
        }
        onSelectDate(selected);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const grid = gridRef.current;
        if (!grid) return false;
        grid.scrollTo(
          getCalendarScrollOffset(location.viewport, {
            clientHeight: grid.clientHeight,
            clientWidth: grid.clientWidth,
            scrollHeight: grid.scrollHeight,
            scrollWidth: grid.scrollWidth,
          }),
        );
        return true;
      },
    }),
    [gridRef, onSelectDate, selectedDate],
  );
  useWorkspaceLocationAdapter(adapter);
  return null;
}
