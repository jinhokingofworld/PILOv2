"use client";

import { useEffect, useMemo } from "react";
import { useEditor } from "tldraw";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import { createSqlErdWorkspaceLocation, readSqlErdCamera } from "./sql-erd-workspace-location";

export function SqlErdWorkspaceLocationAdapter({ sessionId }: { sessionId: string }) {
  const editor = useEditor();
  const adapter = useMemo(
    () => ({
      capture: () => createSqlErdWorkspaceLocation(sessionId, editor.getCamera()),
      page: "sql-erd" as const,
      ready: Boolean(sessionId),
      restore(location: WorkspacePresenceLocation) {
        const camera = readSqlErdCamera(location, sessionId);
        if (!camera) return false;
        editor.setCamera(camera);
        return true;
      },
    }),
    [editor, sessionId],
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
