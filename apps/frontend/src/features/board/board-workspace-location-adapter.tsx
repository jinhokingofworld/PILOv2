"use client";

import { useMemo } from "react";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import { createBoardWorkspaceLocation, getBoardScrollOffset, isBoardWorkspaceLocationRestorable } from "./board-workspace-location";

function getKanbanScroller() {
  return document.querySelector<HTMLElement>(".kanban-scroll");
}

export function BoardWorkspaceLocationAdapter({ boardId }: { boardId: string }) {
  const adapter = useMemo(
    () => ({
      capture() {
        const scroller = getKanbanScroller();
        if (!boardId || !scroller) return null;
        return createBoardWorkspaceLocation(boardId, {
          clientHeight: scroller.clientHeight,
          clientWidth: scroller.clientWidth,
          scrollHeight: scroller.scrollHeight,
          scrollLeft: scroller.scrollLeft,
          scrollTop: scroller.scrollTop,
          scrollWidth: scroller.scrollWidth,
        });
      },
      page: "board" as const,
      ready: Boolean(boardId),
      restore(location: WorkspacePresenceLocation) {
        const scroller = getKanbanScroller();
        if (
          !scroller ||
          location.page !== "board" ||
          location.viewport.kind !== "element" ||
          location.viewport.key !== "board-kanban" ||
          !isBoardWorkspaceLocationRestorable(location, boardId)
        ) {
          return false;
        }
        scroller.scrollTo(
          getBoardScrollOffset(location.viewport, {
            clientHeight: scroller.clientHeight,
            clientWidth: scroller.clientWidth,
            scrollHeight: scroller.scrollHeight,
            scrollWidth: scroller.scrollWidth,
          }),
        );
        return true;
      },
    }),
    [boardId],
  );
  useWorkspaceLocationAdapter(adapter);
  return null;
}
