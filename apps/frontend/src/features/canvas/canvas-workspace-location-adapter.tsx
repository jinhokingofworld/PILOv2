"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useEditor } from "tldraw";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import { createCanvasWorkspaceLocation, readCanvasCamera } from "./canvas-workspace-location";

export function CanvasWorkspaceLocationAdapter({ canvasId }: { canvasId: string }) {
  const editor = useEditor();
  const searchParams = useSearchParams();
  const requestedCanvasId = searchParams.get("canvasId")?.trim() || null;
  const isTargetCanvasLoaded = !requestedCanvasId || requestedCanvasId === canvasId;
  const adapter = useMemo(
    () => ({
      capture: () => createCanvasWorkspaceLocation(canvasId, editor.getCamera()),
      page: "canvas" as const,
      ready: Boolean(canvasId && isTargetCanvasLoaded),
      restore(location: WorkspacePresenceLocation) {
        const camera = readCanvasCamera(location, canvasId);
        if (!camera) return false;
        editor.setCamera(camera);
        return true;
      },
    }),
    [canvasId, editor, isTargetCanvasLoaded],
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
