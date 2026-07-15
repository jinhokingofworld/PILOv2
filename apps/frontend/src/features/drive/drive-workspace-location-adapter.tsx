"use client";

import { useMemo, type RefObject } from "react";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import { createDriveWorkspaceLocation, getDriveScrollOffset, readDriveFolderId } from "./drive-workspace-location";

export function DriveWorkspaceLocationAdapter({
  folderId,
  listRef,
  loadFolder,
  workspaceId,
}: {
  folderId: string | null;
  listRef: RefObject<HTMLDivElement | null>;
  loadFolder: (folderId: string | null) => Promise<boolean>;
  workspaceId: string;
}) {
  const adapter = useMemo(
    () => ({
      capture() {
        const list = listRef.current;
        if (!list) return null;
        return createDriveWorkspaceLocation(folderId, {
          clientHeight: list.clientHeight,
          clientWidth: list.clientWidth,
          scrollHeight: list.scrollHeight,
          scrollLeft: list.scrollLeft,
          scrollTop: list.scrollTop,
          scrollWidth: list.scrollWidth,
        });
      },
      page: "drive" as const,
      ready: Boolean(workspaceId),
      async restore(location: WorkspacePresenceLocation) {
        if (
          location.page !== "drive" ||
          location.viewport.kind !== "element" ||
          location.viewport.key !== "drive-list"
        ) {
          return false;
        }
        const targetFolderId = readDriveFolderId(location);
        if (!(await loadFolder(targetFolderId))) {
          return false;
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const list = listRef.current;
        if (!list) return false;
        list.scrollTo(
          getDriveScrollOffset(location.viewport, {
            clientHeight: list.clientHeight,
            clientWidth: list.clientWidth,
            scrollHeight: list.scrollHeight,
            scrollWidth: list.scrollWidth,
          }),
        );
        return true;
      },
    }),
    [folderId, listRef, loadFolder, workspaceId],
  );
  useWorkspaceLocationAdapter(adapter);
  return null;
}
