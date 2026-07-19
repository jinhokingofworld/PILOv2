"use client";

import { useCanvasRemoteShapePreviewStore } from "@/features/canvas/collaboration/CanvasRemoteShapePreviewContext";
import { CanvasRemoteConnectionPreviewOverlay } from "./CanvasRemoteConnectionPreviewOverlay";
import { CanvasRemoteFreehandPreviewOverlay } from "./CanvasRemoteFreehandPreviewOverlay";

export function CanvasRemoteWorldPreviewLayer() {
  const previewStore = useCanvasRemoteShapePreviewStore();

  if (!previewStore) return null;

  return (
    <div className="canvas-remote-world-preview-layer" aria-hidden="true">
      <CanvasRemoteConnectionPreviewOverlay previewStore={previewStore} />
      <CanvasRemoteFreehandPreviewOverlay previewStore={previewStore} />
    </div>
  );
}
