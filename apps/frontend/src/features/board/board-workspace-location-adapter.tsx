"use client";

import { useMemo } from "react";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import {
  createBoardWorkspaceLocation,
  getBoardScrollOffset,
  readBoardWorkspaceTarget,
  waitForBoardScrollTarget,
  type BoardFollowSurfaceKey,
} from "./board-workspace-location";

type BoardDomScrollTarget = {
  boardId: string;
  element: HTMLElement;
  issueId: string | null;
  surface: BoardFollowSurfaceKey;
};

function findBoardScrollTarget(
  boardId?: string,
  issueId?: string | null,
  surface?: BoardFollowSurfaceKey,
): BoardDomScrollTarget | null {
  if (!surface || surface === "board-issue-sheet") {
    const sheets = document.querySelectorAll<HTMLElement>(
      '[data-workspace-follow-surface="board-issue-sheet"]',
    );
    for (const element of sheets) {
      const target = {
        boardId: element.dataset.workspaceFollowBoardId ?? "",
        element,
        issueId: element.dataset.workspaceFollowIssueId ?? null,
        surface: "board-issue-sheet" as const,
      };
      if (
        (!boardId || target.boardId === boardId) &&
        (issueId === undefined || target.issueId === issueId)
      ) {
        return target;
      }
    }
  }

  if (!surface || surface === "board-kanban") {
    const roots = document.querySelectorAll<HTMLElement>(
      "[data-board-main][data-workspace-follow-board-id]",
    );
    for (const root of roots) {
      const targetBoardId = root.dataset.workspaceFollowBoardId ?? "";
      const element = root.querySelector<HTMLElement>(".kanban-scroll");
      if (element && (!boardId || targetBoardId === boardId)) {
        return {
          boardId: targetBoardId,
          element,
          issueId: null,
          surface: "board-kanban",
        };
      }
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

export function BoardWorkspaceLocationAdapter({
  allowedBoardIds,
  onSelectBoard,
  onSelectIssue,
}: {
  allowedBoardIds: readonly string[];
  onSelectBoard: (boardId: string) => void;
  onSelectIssue: (issueId: string | null) => void;
}) {
  const adapter = useMemo(
    () => ({
      capture() {
        const target = findBoardScrollTarget();
        if (!target) return null;
        const location = createBoardWorkspaceLocation(
          {
            boardId: target.boardId,
            issueId: target.issueId,
            surface: target.surface,
          },
          captureMetrics(target.element),
        );
        return location as unknown as WorkspacePresenceLocation | null;
      },
      page: "board" as const,
      ready: allowedBoardIds.length > 0,
      async restore(
        location: WorkspacePresenceLocation,
        { signal }: { signal: AbortSignal },
      ) {
        if (signal.aborted) return false;
        const target = readBoardWorkspaceTarget(location, allowedBoardIds);
        if (!target) return false;

        onSelectBoard(target.boardId);
        onSelectIssue(target.issueId);
        const scroller = await waitForBoardScrollTarget({
          boardId: target.boardId,
          findTarget: () =>
            findBoardScrollTarget(
              target.boardId,
              target.issueId,
              target.surface,
            ),
          issueId: target.issueId,
          signal,
          surface: target.surface,
          timeoutMs: 5_000,
        });
        if (!scroller || signal.aborted) return false;

        scroller.scrollTo(
          getBoardScrollOffset(target.viewport, {
            clientHeight: scroller.clientHeight,
            clientWidth: scroller.clientWidth,
            scrollHeight: scroller.scrollHeight,
            scrollWidth: scroller.scrollWidth,
          }),
        );
        return true;
      },
    }),
    [allowedBoardIds, onSelectBoard, onSelectIssue],
  );
  useWorkspaceLocationAdapter(adapter);
  return null;
}
