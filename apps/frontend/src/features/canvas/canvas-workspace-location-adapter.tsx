"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useEditor, type TLShapeId } from "tldraw";

import { useWorkspaceLocationAdapter } from "@/shared/workspace-presence/use-workspace-location-adapter";
import type { WorkspacePresenceLocation } from "@/shared/workspace-presence/workspace-presence-types";
import {
  createCanvasWorkspaceLocation,
  readCanvasWorkspaceTarget,
} from "./canvas-workspace-location";

export function CanvasWorkspaceLocationAdapter({ canvasId }: { canvasId: string }) {
  const editor = useEditor();
  const searchParams = useSearchParams();
  const requestedCanvasId = searchParams.get("canvasId")?.trim() || null;
  const isTargetCanvasLoaded = !requestedCanvasId || requestedCanvasId === canvasId;
  const adapter = useMemo(
    () => ({
      capture: () =>
        createCanvasWorkspaceLocation(
          canvasId,
          editor.getCamera(),
          editor.getSelectedShapeIds().map(String),
        ),
      page: "canvas" as const,
      ready: Boolean(canvasId && isTargetCanvasLoaded),
      restore(location: WorkspacePresenceLocation) {
        const target = readCanvasWorkspaceTarget(location, canvasId);
        if (!target) return false;
        editor.setCamera(target.camera);
        editor.setSelectedShapes(
          target.selectedShapeIds.filter((shapeId) =>
            editor.getShape(shapeId as TLShapeId),
          ) as TLShapeId[],
        );
        return true;
      },
    }),
    [canvasId, editor, isTargetCanvasLoaded],
  );
  const { reportManualInteraction } = useWorkspaceLocationAdapter(adapter);
  useEffect(() => {
    const container = editor.getContainer();
    container.addEventListener("pointerup", reportManualInteraction);
    container.addEventListener("wheel", reportManualInteraction, {
      passive: true,
    });
    return () => {
      container.removeEventListener("pointerup", reportManualInteraction);
      container.removeEventListener("wheel", reportManualInteraction);
    };
  }, [editor, reportManualInteraction]);
  return null;
}
