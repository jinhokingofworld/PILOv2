"use client";

import { useValue } from "@tldraw/state-react";
import { useEditor, type Editor, type TLShapeId } from "tldraw";
import { useEffect, useMemo, useState } from "react";
import { isPiloFrameShape } from "../../shapes/PiloCanvasShapeGuards";

type FrameLoadingOverlayItem = {
  id: string;
  left: number;
  top: number;
};

function readFrameLoadingOverlayItems(
  editor: Editor,
  loadingFrameIds: ReadonlySet<string>,
) {
  return Array.from(loadingFrameIds).flatMap(
    (frameId): FrameLoadingOverlayItem[] => {
      const frame = editor.getShape(frameId as TLShapeId);

      if (!isPiloFrameShape(frame)) return [];

      const bounds = editor.getShapePageBounds(frame.id);

      if (!bounds) return [];

      const center = editor.pageToViewport({
        x: bounds.x + bounds.w / 2,
        y: bounds.y + bounds.h / 2,
      });

      return [
        {
          id: frameId,
          left: center.x,
          top: center.y,
        },
      ];
    },
  );
}

export function CanvasFrameLazyLoadingOverlay({
  loadingFrameIds,
}: {
  loadingFrameIds: ReadonlySet<string>;
}) {
  const editor = useEditor();
  const camera = useValue(
    "canvas-frame-lazy-loading-overlay-camera",
    () => editor.getCamera(),
    [editor],
  );
  const [documentVersion, setDocumentVersion] = useState(0);
  const loadingFrames = useMemo(
    () => readFrameLoadingOverlayItems(editor, loadingFrameIds),
    [camera.x, camera.y, camera.z, documentVersion, editor, loadingFrameIds],
  );

  useEffect(() => {
    const removeListener = editor.store.listen(
      () => {
        setDocumentVersion((version) => version + 1);
      },
      {
        source: "all",
        scope: "document",
      },
    );

    return removeListener;
  }, [editor]);

  if (!loadingFrames.length) return null;

  return (
    <div className="canvas-frame-lazy-loading-layer" aria-hidden="true">
      {loadingFrames.map((frame) => (
        <span
          key={frame.id}
          className="canvas-frame-lazy-loading-indicator"
          style={{ left: frame.left, top: frame.top }}
        >
          ⟳
        </span>
      ))}
    </div>
  );
}
