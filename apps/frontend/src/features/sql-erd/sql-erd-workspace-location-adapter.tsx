"use client";

import { useEffect, useMemo } from "react";
import { useEditor } from "tldraw";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import type { SqlErdSelection } from "./types";
import {
  createSqlErdInspectorWorkspaceLocation,
  createSqlErdWorkspaceLocation,
  getSqlErdInspectorScrollOffset,
  readSqlErdWorkspaceTarget,
  SQL_ERD_INSPECTOR_SURFACE_KEY,
  waitForSqlErdInspectorTarget,
} from "./sql-erd-workspace-location";

function findInspectorScroller() {
  return document.querySelector<HTMLElement>(
    `[data-workspace-follow-surface="${SQL_ERD_INSPECTOR_SURFACE_KEY}"]`,
  );
}

export function SqlErdWorkspaceLocationAdapter({
  isInspectorOpen,
  onInspectorOpenChange,
  onSelectionChange,
  selectedSqlErdObject,
  sessionId,
}: {
  isInspectorOpen: boolean;
  onInspectorOpenChange: (isOpen: boolean) => void;
  onSelectionChange: (selection: SqlErdSelection) => void;
  selectedSqlErdObject: SqlErdSelection;
  sessionId: string;
}) {
  const editor = useEditor();
  const adapter = useMemo(
    () => ({
      capture() {
        const inspector = isInspectorOpen ? findInspectorScroller() : null;
        const location = inspector
          ? createSqlErdInspectorWorkspaceLocation({
              metrics: {
                clientHeight: inspector.clientHeight,
                scrollHeight: inspector.scrollHeight,
                scrollTop: inspector.scrollTop,
              },
              selection: selectedSqlErdObject,
              sessionId,
            })
          : createSqlErdWorkspaceLocation(
              sessionId,
              editor.getCamera(),
              selectedSqlErdObject,
            );
        return location as WorkspacePresenceLocation;
      },
      page: "sql-erd" as const,
      ready: Boolean(sessionId),
      async restore(
        location: WorkspacePresenceLocation,
        { signal }: { signal: AbortSignal },
      ) {
        if (signal.aborted) return false;
        const target = readSqlErdWorkspaceTarget(location, sessionId);
        if (!target) return false;
        onSelectionChange(target.selection);
        onInspectorOpenChange(target.inspectorOpen);
        if (target.surface === "canvas") {
          if (signal.aborted) return false;
          editor.setCamera(target.camera);
          return true;
        }

        const inspector = await waitForSqlErdInspectorTarget({
          findTarget: findInspectorScroller,
          signal,
          timeoutMs: 5_000,
        });
        if (!inspector || signal.aborted) return false;
        inspector.scrollTo(
          getSqlErdInspectorScrollOffset(target.viewport, {
            clientHeight: inspector.clientHeight,
            scrollHeight: inspector.scrollHeight,
          }),
        );
        return true;
      },
    }),
    [
      editor,
      isInspectorOpen,
      onInspectorOpenChange,
      onSelectionChange,
      selectedSqlErdObject,
      sessionId,
    ],
  );
  const { reportInteraction } = useWorkspaceLocationAdapter(adapter);
  useEffect(() => {
    window.addEventListener("pointerup", reportInteraction);
    window.addEventListener("wheel", reportInteraction, { passive: true });
    return () => {
      window.removeEventListener("pointerup", reportInteraction);
      window.removeEventListener("wheel", reportInteraction);
    };
  }, [reportInteraction]);
  return null;
}
